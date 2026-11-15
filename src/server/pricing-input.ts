// What the owner's pricing route reads before anything runs (docs/plans/2026-11-offer-board.md, section 4): a change to
// the day value and contingency, or to the market research, with the version the owner's page read. Decoded with Effect
// Schema; the research itself is read by readMarketReference, which says what is wrong with it.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { RawValue } from "../lib/fields";
import { readMarketReference } from "../lib/pricing-reference";
import type { PricingSave } from "./rules/pricing";

const version = Schema.Number.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);

const PricingRequestSchema = Schema.Union([
	Schema.Struct({
		action: Schema.Literal("values"),
		/** Whole dollars a day, or null to clear it. */
		dayValue: Schema.NullOr(
			Schema.Number.check(
				Schema.isInt(),
				Schema.isGreaterThanOrEqualTo(1),
				Schema.isLessThanOrEqualTo(10_000),
			),
		),
		contingencyPercent: Schema.Number.check(
			Schema.isInt(),
			Schema.isGreaterThanOrEqualTo(0),
			Schema.isLessThanOrEqualTo(100),
		),
		expectedVersion: version,
	}),
	Schema.Struct({
		action: Schema.Literal("market"),
		/** The research as imported or edited, or null to clear it. */
		market: Schema.Unknown,
		expectedVersion: version,
	}),
]);

const decodeRequest = Schema.decodeUnknownResult(PricingRequestSchema);

/** The save the owner asked for, without its time, or the sentence to answer with. */
export function readPricingInput(
	body: RawValue,
):
	| { ok: true; value: Omit<PricingSave, "now"> }
	| { ok: false; error: string } {
	const read = decodeRequest(body);

	if (Result.isFailure(read))
		return {
			ok: false,
			error:
				"Check the day value (whole dollars, 1 to 10,000) and the contingency (0 to 100%).",
		};
	const request = read.success;

	if (request.action === "values")
		return {
			ok: true,
			value: {
				expectedVersion: request.expectedVersion,
				change: {
					part: "values",
					dayValueCents:
						request.dayValue === null ? null : request.dayValue * 100,
					contingencyPercent: request.contingencyPercent,
				},
			},
		};

	if (request.market === null)
		return {
			ok: true,
			value: {
				expectedVersion: request.expectedVersion,
				change: { part: "market", market: null },
			},
		};
	const market = readMarketReference(request.market);

	return market.ok
		? {
				ok: true,
				value: {
					expectedVersion: request.expectedVersion,
					change: { part: "market", market: market.value },
				},
			}
		: { ok: false, error: market.error };
}
