// The owner pricing reference lives in one MUSIC_DB row. The rule decides what to save; SQL only guards
// the expected version atomically. Missing migrations and corrupt records fail closed, never reset a saved value.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
	type PricingReference,
	readPricingReference,
} from "../lib/pricing-reference";
import { PricingChanged } from "./rules/pricing";
import { MusicDb } from "./services";

/** A storage failure, without database text in the response. */
export class PricingStoreFailed extends Data.TaggedError(
	"PricingStoreFailed",
) {}

/** Reads the singleton; a missing row is the unsaved version, not a missing table. */
export async function loadPricing(db: D1Database): Promise<PricingReference> {
	const row = await db
		.prepare("SELECT version, reference_json FROM owner_pricing WHERE id = 1")
		.first<{ version: number; reference_json: string }>();

	if (!row) return readPricingReference(null);
	const reference = readPricingReference(JSON.parse(row.reference_json));

	if (reference.version !== row.version || row.version < 1)
		throw new Error("Invalid pricing record");

	return reference;
}

/** Reads the facts the pricing rule uses. */
export const readPricing = Effect.gen(function* () {
	const db = yield* MusicDb;

	return yield* Effect.tryPromise({
		try: () => loadPricing(db),
		catch: () => new PricingStoreFailed(),
	});
});

/** One guarded statement: a stale read, including two first saves, cannot overwrite the winner. */
export const writePricing = (
	reference: PricingReference,
	expectedVersion: number,
) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		const result = yield* Effect.tryPromise({
			try: () =>
				expectedVersion === 0
					? db
							.prepare(
								"INSERT INTO owner_pricing (id, version, reference_json) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING",
							)
							.bind(reference.version, JSON.stringify(reference))
							.run()
					: db
							.prepare(
								"UPDATE owner_pricing SET version = ?, reference_json = ? WHERE id = 1 AND version = ?",
							)
							.bind(
								reference.version,
								JSON.stringify(reference),
								expectedVersion,
							)
							.run(),
			catch: () => new PricingStoreFailed(),
		});

		if (result.meta.changes !== 1) return yield* new PricingChanged();
	});
