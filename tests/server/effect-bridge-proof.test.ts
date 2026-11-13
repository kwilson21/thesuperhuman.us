import {
	createEffectActor,
	createEffectLogic,
	send,
	setupEffect,
	waitFor,
} from "@xstate/effect";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vitest";
import { failureOf } from "../../src/server/machines/failure";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The proof that the XState and Effect bridge works under this repository's vitest and TypeScript: a machine is
// restored from a stored state value (a status column, not the bridge's own snapshot), takes one event, waits on one
// piece of outside work, and the state it lands on is saved to D1 (a sqlite-backed fake) and restored from there. A
// typed failure lands in the refusal state; a defect or an interruption does not, so a bug is never saved as a state.
// The machine is a stand-in written for this test; no route uses the bridge yet.

class StripeRefused extends Data.TaggedError("StripeRefused") {}

/** The outside work: asking Stripe to void an invoice. */
class Billing extends Context.Service<
	Billing,
	{ readonly voidInvoice: (id: number) => Effect.Effect<void, StripeRefused> }
>()("test/Billing") {}

const voidAtStripe = createEffectLogic({
	schemas: { input: Schema.Struct({ id: Schema.Number }) },
	effect: ({ input }) =>
		Billing.use((billing) => billing.voidInvoice(input.id)),
});

const invoice = setupEffect({
	schemas: { input: Schema.Struct({ id: Schema.Number }) },
	actors: { voidAtStripe },
}).createMachine({
	id: "invoiceProof",
	context: ({ input }) => ({ id: input.id, refused: false }),
	initial: "open",
	states: {
		open: { on: { VOID: { target: "voiding" } } },
		void_failed: { on: { VOID: { target: "voiding" } } },
		voiding: {
			invoke: {
				src: "voidAtStripe",
				input: ({ context }) => ({ id: context.id }),
				onDone: { target: "voided" },
				// failureOf rethrows a defect or an interruption, so only a typed refusal reaches the target.
				onError: ({ context, event }) =>
					Predicate.isTagged(failureOf(event), "StripeRefused")
						? { target: "void_failed", context: { ...context, refused: true } }
						: undefined,
			},
		},
		voided: { type: "final" },
	},
});

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

const stored = async () =>
	(
		await db
			.prepare("SELECT value FROM invoice_state WHERE id = 7")
			.first<{ value: string }>()
	)?.value;

/** One request: read the stored state, restore the machine at it, send the event, wait, and save where it landed. */
const voidInvoice = (id: number) =>
	Effect.gen(function* () {
		const row = yield* Effect.promise(() =>
			db
				.prepare("SELECT value FROM invoice_state WHERE id = ?")
				.bind(id)
				.first<{ value: string }>(),
		);

		const actor = yield* createEffectActor(invoice, {
			input: { id },
			snapshot: invoice.getPersistedSnapshot(
				invoice.resolveState({
					value: row?.value ?? "open",
					context: { id, refused: false },
				}),
			),
		});

		yield* send(actor, { type: "VOID" });

		const landed = yield* waitFor(
			actor,
			(s) => s.matches("voided") || s.context.refused,
			{ timeout: "5 seconds" },
		);

		yield* Effect.promise(() =>
			db
				.prepare("UPDATE invoice_state SET value = ? WHERE id = ?")
				.bind(String(landed.value), id)
				.run(),
		);

		return String(landed.value);
	}).pipe(Effect.scoped);

const withBilling = (
	voidIt: (id: number) => Effect.Effect<void, StripeRefused>,
) => Effect.provideService(Billing, { voidInvoice: voidIt });

beforeEach(() => {
	database.exec(
		"DROP TABLE IF EXISTS invoice_state; CREATE TABLE invoice_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO invoice_state VALUES (7, 'open')",
	);
});

describe("the XState and Effect bridge", () => {
	it("restores a machine from the stored state, waits on outside work, lands on success and saves it", async () => {
		await db.prepare("UPDATE invoice_state SET value = 'void_failed'").run();

		const voided: number[] = [];

		const landed = await Effect.runPromise(
			voidInvoice(7).pipe(
				withBilling((id) => Effect.sync(() => void voided.push(id))),
			),
		);

		expect(landed).toBe("voided");
		expect(voided).toEqual([7]);
		expect(await stored()).toBe("voided");
	});

	it("lands on the refusal state, saved, when the outside work fails with a typed error", async () => {
		const landed = await Effect.runPromise(
			voidInvoice(7).pipe(withBilling(() => Effect.fail(new StripeRefused()))),
		);

		expect(landed).toBe("void_failed");
		expect(await stored()).toBe("void_failed");
	});

	it("restores from what the refusal saved and retries from there", async () => {
		await Effect.runPromise(
			voidInvoice(7).pipe(withBilling(() => Effect.fail(new StripeRefused()))),
		);

		const landed = await Effect.runPromise(
			voidInvoice(7).pipe(withBilling(() => Effect.void)),
		);

		expect(landed).toBe("voided");
		expect(await stored()).toBe("voided");
	});

	it("does not land a defect in the refusal state: the program rejects and nothing is saved", async () => {
		await expect(
			Effect.runPromise(
				voidInvoice(7).pipe(
					withBilling(() => Effect.die(new Error("bug in the billing code"))),
				),
			),
		).rejects.toThrow();
		expect(await stored()).toBe("open");
	});

	it("does not land a thrown error in the refusal state: the program rejects and nothing is saved", async () => {
		await expect(
			Effect.runPromise(
				voidInvoice(7).pipe(
					withBilling(() =>
						Effect.sync(() => {
							throw new Error("thrown by the billing code");
						}),
					),
				),
			),
		).rejects.toThrow();
		expect(await stored()).toBe("open");
	});

	it("does not land an interruption in the refusal state", async () => {
		await expect(
			Effect.runPromise(
				voidInvoice(7).pipe(withBilling(() => Effect.interrupt)),
			),
		).rejects.toThrow();
		expect(await stored()).toBe("open");
	});

	it("does not start the work when it restores into a state that invokes it", async () => {
		let calls = 0;

		const actor = await Effect.runPromise(
			Effect.gen(function* () {
				const restored = yield* createEffectActor(invoice, {
					input: { id: 7 },
					snapshot: invoice.getPersistedSnapshot(
						invoice.resolveState({
							value: "voiding",
							context: { id: 7, refused: false },
						}),
					),
				});

				yield* Effect.sleep("50 millis");

				return restored.getSnapshot().value;
			}).pipe(
				Effect.scoped,
				withBilling(() => Effect.sync(() => void (calls += 1))),
			),
		);

		expect(actor).toBe("voiding");
		expect(calls).toBe(0);
	});
});
