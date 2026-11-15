// The owner's pricing reference (docs/plans/2026-11-offer-board.md, section 4): whether a save from the owner's page may
// replace what is stored. It decides from the reference as read and the version the page read it at, and answers the
// new reference, with the next version and the time, or refuses when another save came in since the page was loaded
// (another tab, say). KV has no compare-and-set, so nothing re-checks it at write time: one owner writes this record, and
// the read just before the write is the guard. That guard is not complete: verification/pricing-save.qnt (the TodayKv
// mutant) shows a save from a second tab can put back the research another tab just saved, and a cached read can refuse
// a save that should pass. Moving the record to D1 removes both; it is the owner's decision (docs/verification.md).
// Time is an input; the rule reads no clock.
import * as Data from "effect/Data";
import type {
	MarketReference,
	PricingReference,
} from "../../lib/pricing-reference";
import { alwaysWrites, term, unless } from "../terms";

export class PricingChanged extends Data.TaggedError("PricingChanged") {
	readonly say =
		"Your pricing was saved from another page since this one loaded. Reload to see it, then save again.";
}

/** What the owner's page asks to change: the day value and contingency, or the market research. */
export type PricingChange =
	| {
			readonly part: "values";
			readonly dayValueCents: number | null;
			readonly contingencyPercent: number;
	  }
	| { readonly part: "market"; readonly market: MarketReference | null };

export type PricingSave = {
	/** The version the page read, 0 when nothing had been saved. */
	readonly expectedVersion: number;
	readonly change: PricingChange;
	/** When the save is made, ISO 8601. */
	readonly now: string;
};

type Given = PricingSave & { readonly stored: PricingReference };

const sameVersion = term<Given>(
	"the reference is still at the version the owner's page read",
	(g) => g.stored.version === g.expectedVersion,
);

export const savePricing = alwaysWrites({
	name: "Save the owner's pricing reference",
	given: (request: PricingSave, stored: PricingReference): Given => ({
		...request,
		stored,
	}),
	refusals: [unless(sameVersion, () => new PricingChanged())],
	writes: (g): PricingReference => ({
		...g.stored,
		...(g.change.part === "values"
			? {
					dayValueCents: g.change.dayValueCents,
					contingencyPercent: g.change.contingencyPercent,
				}
			: { market: g.change.market }),
		version: g.stored.version + 1,
		updatedAt: g.now,
	}),
	writesText:
		"the owner's day value and contingency, or their market research, as the next version",
});
