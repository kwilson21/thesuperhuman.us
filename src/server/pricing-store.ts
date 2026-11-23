// Where the owner's pricing reference is kept (docs/plans/2026-11-offer-board.md, section 4): one JSON record under
// PRICING_KEY in the RESUME_STORE KV namespace, which already holds the owner's private records (approval tokens, resume
// PDFs). Not in MUSIC_DB: a new table would change the digest every golden case records. A read decides nothing; the
// rule in src/server/rules/pricing.ts decides. Any KV failure is a PricingStoreFailed, which the route answers with its
// fixed sentence.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
	type PricingReference,
	readPricingReference,
} from "../lib/pricing-reference";
import { ResumeStore } from "./services";

/** The key the reference is stored under. */
export const PRICING_KEY = "owner:pricing";

/** KV failed. The error carries no text. */
export class PricingStoreFailed extends Data.TaggedError(
	"PricingStoreFailed",
) {}

/** The stored reference, for an owner page that renders it (not an Effect program). Unreadable reads as never saved. */
export async function loadPricing(kv: KVNamespace): Promise<PricingReference> {
	const text = await kv.get(PRICING_KEY);

	if (text === null) return readPricingReference(null);

	try {
		return readPricingReference(JSON.parse(text));
	} catch {
		return readPricingReference(null);
	}
}

/** The stored reference, read defensively: a missing or unreadable record reads as never saved. */
export const readPricing = Effect.gen(function* () {
	const kv = yield* ResumeStore;

	return yield* Effect.tryPromise({
		try: () => loadPricing(kv),
		catch: () => new PricingStoreFailed(),
	});
});

/** Stores the reference the rule answered. */
export const writePricing = (reference: PricingReference) =>
	Effect.gen(function* () {
		const kv = yield* ResumeStore;

		yield* Effect.tryPromise({
			try: () => kv.put(PRICING_KEY, JSON.stringify(reference)),
			catch: () => new PricingStoreFailed(),
		});
	});
