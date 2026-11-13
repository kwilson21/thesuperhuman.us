import {
	createEffectActor,
	createEffectLogic,
	send,
	setupEffect,
} from "@xstate/effect";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vitest";
import { failureOf } from "../../src/server/machines/failure";
import { settled } from "../../src/server/machines/settled";
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

// A second machine with two steps in a row, to prove a defect after a successful first step is still the program's
// failure: nothing is saved and the bug is not turned into a refusal.
const twoStepMachine = (second: Effect.Effect<void, StripeRefused>) =>
	setupEffect({
		actors: {
			first: createEffectLogic(() => Effect.void),
			second: createEffectLogic(() => second),
		},
	}).createMachine({
		id: "twoStepProof",
		initial: "open",
		states: {
			open: { on: { GO: { target: "one" } } },
			one: { invoke: { src: "first", onDone: { target: "two" } } },
			two: {
				invoke: {
					src: "second",
					onDone: { target: "done" },
					onError: ({ event }) =>
						Predicate.isTagged(failureOf(event), "StripeRefused")
							? { target: "refused" }
							: undefined,
				},
			},
			refused: {},
			done: { type: "final" },
		},
	});

const twoSteps = (second: Effect.Effect<void, StripeRefused>) =>
	Effect.gen(function* () {
		const actor = yield* createEffectActor(twoStepMachine(second), {});

		yield* send(actor, { type: "GO" });

		const landed = yield* settled(
			actor,
			(s) => s.matches("done") || s.matches("refused"),
			{ timeout: "5 seconds" },
		);

		yield* Effect.promise(() =>
			db
				.prepare("UPDATE invoice_state SET value = ? WHERE id = 7")
				.bind(String(landed.value))
				.run(),
		);

		return String(landed.value);
	}).pipe(Effect.scoped);

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

		const landed = yield* settled(
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

	it("rejects with the original error object when the work dies, and saves nothing", async () => {
		const bug = new Error("bug in the billing code");

		await expect(
			Effect.runPromise(voidInvoice(7).pipe(withBilling(() => Effect.die(bug)))),
		).rejects.toBe(bug);
		expect(await stored()).toBe("open");
	});

	it("rejects with the original error object when the work throws, and saves nothing", async () => {
		const thrown = new Error("thrown by the billing code");

		await expect(
			Effect.runPromise(
				voidInvoice(7).pipe(
					withBilling(() =>
						Effect.sync(() => {
							throw thrown;
						}),
					),
				),
			),
		).rejects.toBe(thrown);
		expect(await stored()).toBe("open");
	});

	it("rejects with the original error object when a later step dies after an earlier one succeeded", async () => {
		const bug = new Error("bug in the second step");

		await expect(
			Effect.runPromise(twoSteps(Effect.die(bug))),
		).rejects.toBe(bug);
		expect(await stored()).toBe("open");
	});

	it("does not land an interruption in the refusal state", async () => {
		await expect(
			Effect.runPromise(
				voidInvoice(7).pipe(withBilling(() => Effect.interrupt)),
			),
		).rejects.toThrow("All fibers interrupted without error");
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
