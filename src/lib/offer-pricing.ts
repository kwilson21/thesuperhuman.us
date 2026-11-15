// The offer board's money rules (docs/plans/2026-11-offer-board.md, section 1, "What to charge"). Pure and browser-safe:
// the owner page renders the owner's own numbers into itself and works the prices out here, so the model never sees
// them. LemmaScript and Dafny check the contracts below (LemmaScript-files.txt, docs/verification.md).
//
// The rule in one sentence: an estimate from the owner's day value is the AI's days times that value, the high end plus
// the owner's contingency, each rounded up to whole $50 (never below the exact amount and less than $50 above it); and a
// market figure always lies in the researched range, unchanged when it is already inside.
//
// Days are counted in half days and money in cents, so the arithmetic is whole numbers. A day value is whole dollars,
// so half a day of it is whole cents. Each exact amount is its own function, so a contract names the product once and
// the prover never has to multiply.

/** Every estimate is rounded up to this many cents: whole $50. */
export const ROUNDING_CENTS = 5000;

/** The day value's bounds, in cents: $1 to $10,000, whole dollars. */
export const DAY_VALUE_MIN_CENTS = 100;
export const DAY_VALUE_MAX_CENTS = 1_000_000;

/** The AI's estimate for one milestone, in half days: half a day to 60 days. */
export const HALF_DAYS_MIN = 1;
export const HALF_DAYS_MAX = 120;

/** An estimate covers at most three milestones, as an offer does. */
export const MILESTONES_MAX = 3;

/** Rounds a non-negative amount of cents up to the next whole $50. */
export function upToRounding(cents: number): number {
	//@ verify
	//@ requires cents >= 0
	//@ ensures \result % 5000 === 0
	//@ ensures \result >= cents && \result - cents < 5000
	const rest = cents % ROUNDING_CENTS;

	if (rest === 0) return cents;

	return cents + (ROUNDING_CENTS - rest);
}

/** The exact low amount in cents: half days times half the day value. */
export function exactLow(halfDays: number, dayValueCents: number): number {
	//@ verify
	//@ requires halfDays >= 0 && dayValueCents >= 0
	//@ ensures \result >= 0
	return halfDays * Math.floor(dayValueCents / 2);
}

/** Twice the exact high amount in cents: half days times the day value in dollars times (100 + contingency). */
export function twiceExactHigh(
	halfDays: number,
	dayValueCents: number,
	contingencyPercent: number,
): number {
	//@ verify
	//@ requires halfDays >= 0 && dayValueCents >= 0 && contingencyPercent >= 0
	//@ ensures \result >= 0
	return halfDays * Math.floor(dayValueCents / 100) * (100 + contingencyPercent);
}

/** The low end of an estimate: the exact low amount, rounded up to whole $50. */
export function estimateLow(halfDays: number, dayValueCents: number): number {
	//@ verify
	//@ requires halfDays >= 0 && dayValueCents >= 0
	//@ ensures \result % 5000 === 0
	//@ ensures \result >= exactLow(halfDays, dayValueCents)
	//@ ensures \result - exactLow(halfDays, dayValueCents) < 5000
	return upToRounding(exactLow(halfDays, dayValueCents));
}

/**
 * The high end of an estimate: the exact high amount, which can end in half a cent, rounded up to the cent and then up
 * to whole $50.
 */
export function estimateHigh(
	halfDays: number,
	dayValueCents: number,
	contingencyPercent: number,
): number {
	//@ verify
	//@ requires halfDays >= 0 && dayValueCents >= 0 && contingencyPercent >= 0
	//@ ensures \result % 5000 === 0
	//@ ensures 2 * \result >= twiceExactHigh(halfDays, dayValueCents, contingencyPercent)
	//@ ensures 2 * (\result - 5000) < twiceExactHigh(halfDays, dayValueCents, contingencyPercent)
	const twice = twiceExactHigh(halfDays, dayValueCents, contingencyPercent);

	return upToRounding(Math.floor((twice + 1) / 2));
}

/**
 * A market figure held inside the researched range: a figure below it becomes the low end, one above it the high end,
 * and one inside it is unchanged.
 */
export function withinRange(figure: number, low: number, high: number): number {
	//@ verify
	//@ requires low <= high
	//@ ensures low <= \result && \result <= high
	//@ ensures (low <= figure && figure <= high) ==> \result === figure
	//@ ensures figure < low ==> \result === low
	//@ ensures figure > high ==> \result === high
	if (figure < low) return low;

	if (figure > high) return high;

	return figure;
}

/** An estimate range in cents, for the pricing panel. */
export type CentsRange = {
	readonly lowCents: number;
	readonly highCents: number;
};

/** The AI's days for one milestone, low and high. */
export type MilestoneDays = {
	readonly daysLow: number;
	readonly daysHigh: number;
};

/**
 * The estimate from the owner's day value for milestones whose days the AI estimated, or null when there is no day
 * value, no milestone, more than three, or a number outside the bounds above.
 */
export function dayValueEstimate(
	milestones: readonly MilestoneDays[],
	dayValueCents: number | null,
	contingencyPercent: number,
): CentsRange | null {
	if (
		dayValueCents === null ||
		milestones.length === 0 ||
		milestones.length > MILESTONES_MAX ||
		!Number.isInteger(dayValueCents) ||
		dayValueCents < DAY_VALUE_MIN_CENTS ||
		dayValueCents > DAY_VALUE_MAX_CENTS ||
		dayValueCents % 100 !== 0 ||
		!Number.isInteger(contingencyPercent) ||
		contingencyPercent < 0 ||
		contingencyPercent > 100
	)
		return null;

	let low = 0,
		high = 0;

	for (const { daysLow, daysHigh } of milestones) {
		const halfLow = Math.round(daysLow * 2),
			halfHigh = Math.round(daysHigh * 2);

		if (
			halfLow < HALF_DAYS_MIN ||
			halfHigh > HALF_DAYS_MAX ||
			halfLow > halfHigh
		)
			return null;
		low += halfLow;
		high += halfHigh;
	}

	return {
		lowCents: estimateLow(low, dayValueCents),
		highCents: estimateHigh(high, dayValueCents, contingencyPercent),
	};
}

/** An offer's total: the sum of its milestone fees, in cents. */
export function offerTotal(feesCents: readonly number[]): number {
	let total = 0;

	for (const fee of feesCents) total += fee;

	return total;
}

/** The lowest, middle and highest of some totals (the middle of an even count is the lower of the two), or null. */
export function spread(totals: readonly number[]): {
	readonly low: number;
	readonly middle: number;
	readonly high: number;
} | null {
	if (totals.length === 0) return null;
	const sorted = [...totals].sort((a, b) => a - b);

	return {
		low: sorted[0],
		middle: sorted[Math.floor((sorted.length - 1) / 2)],
		high: sorted[sorted.length - 1],
	};
}
