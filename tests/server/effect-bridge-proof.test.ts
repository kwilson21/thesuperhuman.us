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
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

// The proof that the XState and Effect bridge works under this repository's vitest and TypeScript: a machine is
// restored from a stored state value (a status column, not the bridge's own snapshot), takes one event, waits on one
// piece of outside work, and the state it lands on is the one to save. The machine is a stand-in written for this
// test; no route uses the bridge yet.

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
				onError: ({ context }) => ({
					target: "void_failed",
					context: { ...context, refused: true },
				}),
			},
		},
		voided: { type: "final" },
	},
});

/** One request: restore the machine at the stored state, send the event, wait, and say where it landed. */
const voidInvoice = (stored: string, id: number) =>
	Effect.gen(function* () {
		const actor = yield* createEffectActor(invoice, {
			input: { id },
			snapshot: invoice.getPersistedSnapshot(
				invoice.resolveState({
					value: stored,
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

		return String(landed.value);
	}).pipe(Effect.scoped);

describe("the XState and Effect bridge", () => {
	it("restores a machine from a stored state, waits on outside work and lands on success", async () => {
		const voided: number[] = [];

		const landed = await Effect.runPromise(
			voidInvoice("void_failed", 7).pipe(
				Effect.provideService(Billing, {
					voidInvoice: (id) => Effect.sync(() => void voided.push(id)),
				}),
			),
		);

		expect(landed).toBe("voided");
		expect(voided).toEqual([7]);
	});

	it("lands on the state the machine names when the outside work fails with a typed error", async () => {
		const landed = await Effect.runPromise(
			voidInvoice("open", 7).pipe(
				Effect.provideService(Billing, {
					voidInvoice: () => Effect.fail(new StripeRefused()),
				}),
			),
		);

		expect(landed).toBe("void_failed");
	});
});
