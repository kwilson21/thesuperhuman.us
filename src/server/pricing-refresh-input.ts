// What the owner's market refresh route reads before anything runs (docs/plans/2026-11-market-refresh.md, section 1):
// ask for a search, or use or discard a proposal by its id, with the version the page read for a use. Decoded with
// Effect Schema.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { RawValue } from "../lib/fields";

const proposalIdField = Schema.String.check(Schema.isPattern(/^\d{15}$/));

const RefreshRequestSchema = Schema.Union([
	Schema.Struct({ action: Schema.Literal("ask") }),
	Schema.Struct({
		action: Schema.Literal("use"),
		proposalId: proposalIdField,
		expectedVersion: Schema.Number.check(
			Schema.isInt(),
			Schema.isGreaterThanOrEqualTo(0),
		),
	}),
	Schema.Struct({
		action: Schema.Literal("discard"),
		proposalId: proposalIdField,
	}),
]);

export type RefreshRequest = typeof RefreshRequestSchema.Type;

const decodeRequest = Schema.decodeUnknownResult(RefreshRequestSchema);

/** The action the owner asked for, or null when the request is not one the page sends. */
export function readRefreshInput(body: RawValue): RefreshRequest | null {
	const read = decodeRequest(body);

	return Result.isFailure(read) ? null : read.success;
}
