// The owner's private pricing reference for the offer board (docs/plans/2026-11-offer-board.md, section 4): the day value
// that turns the AI's day estimates into money, the contingency added to the high end, and market research the AI's
// figure is held inside. It is set on /owner/pricing, stored in KV (src/server/pricing-store.ts) and never shown to a
// client. No figure lives in the repository, which is public. Pure and browser-safe: every object is read field by
// field with ./fields, as the brief board's readers are.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	type RawValue,
	choiceField,
	fieldOf,
	readFields,
	stringField,
} from "./fields";
import { DAY_VALUE_MAX_CENTS, DAY_VALUE_MIN_CENTS } from "./offer-pricing";

/** The kinds of work the reference prices: the brief's paths, without the retired idea path. */
export const PRICING_KINDS = ["website", "webapp", "workflow"] as const;

export type PricingKind = (typeof PRICING_KINDS)[number];

/** The sizes a project is placed in. */
export const PRICING_SIZES = ["small", "medium", "large"] as const;

export type PricingSize = (typeof PRICING_SIZES)[number];

/** The largest whole-dollar amount a range may hold. */
export const MARKET_USD_MAX = 10_000_000;

export type MarketRange = {
	readonly kind: PricingKind;
	readonly size: PricingSize;
	readonly definition: string;
	readonly lowUsd: number;
	readonly highUsd: number;
	readonly sourceIds: readonly number[];
};

export type MarketSource = {
	readonly id: number;
	readonly title: string;
	readonly url: string;
	readonly published: string;
	readonly kind: string;
};

export type MarketReference = {
	/** The day the research was done, YYYY-MM-DD. */
	readonly researchedOn: string;
	readonly ranges: readonly MarketRange[];
	/** What senior independent developers charge a day, for the owner's information; null when the research has none. */
	readonly dayRate: {
		readonly lowUsd: number;
		readonly highUsd: number;
	} | null;
	readonly caveats: readonly string[];
	readonly sources: readonly MarketSource[];
};

export type PricingReference = {
	/** Saves so far; a save names the version its page read, and a different one is refused. 0: never saved. */
	readonly version: number;
	readonly dayValueCents: number | null;
	readonly contingencyPercent: number;
	readonly market: MarketReference | null;
	readonly updatedAt: string;
};

export const emptyPricing = (): PricingReference => ({
	version: 0,
	dayValueCents: null,
	contingencyPercent: 0,
	market: null,
	updatedAt: "",
});

export type Read<A> =
	| { readonly ok: true; readonly value: A }
	| { readonly ok: false; readonly error: string };

const unreadable = { missing: "Missing.", wrongType: () => "Not text." };

const text = (max: number) =>
	stringField(unreadable, Schema.isMaxLength(max, { message: "Too long." }));

/** A whole number from `min` to `max`. */
const whole = (min: number, max: number) =>
	fieldOf<number>((raw) =>
		Predicate.isNumber(raw) && Number.isInteger(raw) && raw >= min && raw <= max
			? { value: raw }
			: { say: `A whole number from ${min} to ${max}.` },
	);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The items of `raw` when it is a list of at most `max`; null otherwise. */
const listOf = (raw: RawValue, max: number): readonly RawValue[] | null =>
	Array.isArray(raw) && raw.length <= max ? raw : null;

/** What `raw` holds under its own key `name`; undefined when it is not an object or has no such key. */
const own = (raw: RawValue, name: string): RawValue =>
	Predicate.isObject(raw) && !Array.isArray(raw) && Object.hasOwn(raw, name)
		? raw[name]
		: undefined;

const rangeFields = {
	kind: choiceField(PRICING_KINDS, {
		...unreadable,
		notOneOf: () => "Not a kind of work.",
	}),
	size: choiceField(PRICING_SIZES, {
		...unreadable,
		notOneOf: () => "Not a size.",
	}),
	definition: text(600),
	lowUsd: whole(0, MARKET_USD_MAX),
	highUsd: whole(0, MARKET_USD_MAX),
};

const sourceFields = {
	id: whole(1, 999),
	title: text(300),
	url: text(600),
	published: text(60),
	kind: text(60),
};

const dayRateFields = {
	lowUsd: whole(0, 100_000),
	highUsd: whole(0, 100_000),
};

/** The ids a range cites: whole numbers, at most 20; anything else is left out. */
function sourceIdsOf(raw: RawValue): number[] {
	return (listOf(raw, 20) ?? []).filter(
		(id): id is number => Predicate.isNumber(id) && Number.isInteger(id),
	);
}

/**
 * The market research as the owner imports it (the research workflow's file, or the page's own copy). Fields it does
 * not know are ignored. Refused, with the reason, when a range is not a kind and size the board prices, its low end is
 * above its high end, a kind and size appears twice, or a source's link is not https.
 */
export function readMarketReference(raw: RawValue): Read<MarketReference> {
	const researchedOn = own(raw, "researchedOn");

	if (!Predicate.isString(researchedOn) || !ISO_DAY.test(researchedOn))
		return { ok: false, error: "researchedOn must be a date, YYYY-MM-DD." };

	const rangeItems = listOf(own(raw, "ranges"), 9);

	if (!rangeItems)
		return { ok: false, error: "ranges must be a list of at most 9." };

	if (rangeItems.length === 0)
		return {
			ok: false,
			error: "The research has no ranges. Use Clear research to remove it.",
		};

	const ranges: MarketRange[] = [];

	for (const [index, item] of rangeItems.entries()) {
		const read = readFields(rangeFields, item);

		if (!read.ok)
			return { ok: false, error: `Range ${index + 1} is not readable.` };
		const range = read.value;

		if (range.lowUsd > range.highUsd)
			return {
				ok: false,
				error: `Range ${index + 1}: the low end is above the high end.`,
			};

		if (
			ranges.some(
				(other) => other.kind === range.kind && other.size === range.size,
			)
		)
			return {
				ok: false,
				error: `Range ${index + 1}: ${range.kind} ${range.size} appears twice.`,
			};

		ranges.push({ ...range, sourceIds: sourceIdsOf(own(item, "sourceIds")) });
	}

	const sourceItems = listOf(own(raw, "sources") ?? [], 60);

	if (!sourceItems)
		return { ok: false, error: "sources must be a list of at most 60." };

	const sources: MarketSource[] = [];

	for (const [index, item] of sourceItems.entries()) {
		const read = readFields(sourceFields, item, {
			defaults: { published: "", kind: "" },
		});

		if (!read.ok || !read.value.url.startsWith("https://"))
			return {
				ok: false,
				error: `Source ${index + 1} is not readable, or its link is not https.`,
			};
		sources.push(read.value);
	}

	const caveatItems = listOf(own(raw, "caveats") ?? [], 20);

	if (
		!caveatItems ||
		!caveatItems.every(
			(caveat) => Predicate.isString(caveat) && caveat.length <= 2000,
		)
	)
		return {
			ok: false,
			error: "caveats must be at most 20 texts of 2,000 characters.",
		};

	// No day rate is null when stored, and absent from a research file without one: either reads as none.
	const dayRateRaw = own(raw, "dayRate");

	const dayRate =
		dayRateRaw === undefined || dayRateRaw === null
			? null
			: readFields(dayRateFields, dayRateRaw);

	if (dayRate && (!dayRate.ok || dayRate.value.lowUsd > dayRate.value.highUsd))
		return { ok: false, error: "dayRate is not readable." };

	return {
		ok: true,
		value: {
			researchedOn,
			ranges,
			dayRate: dayRate?.ok ? dayRate.value : null,
			caveats: caveatItems.filter(Predicate.isString),
			sources,
		},
	};
}

/** The stored reference, read back defensively: anything unreadable is left out, never trusted. */
export function readPricingReference(raw: RawValue): PricingReference {
	const version = own(raw, "version");
	const day = own(raw, "dayValueCents");
	const contingency = own(raw, "contingencyPercent");
	const updatedAt = own(raw, "updatedAt");
	const market = readMarketReference(own(raw, "market"));

	return {
		version:
			Predicate.isNumber(version) && Number.isInteger(version) && version > 0
				? version
				: 0,
		dayValueCents: validDayValue(day) ? day : null,
		contingencyPercent:
			Predicate.isNumber(contingency) &&
			Number.isInteger(contingency) &&
			contingency >= 0 &&
			contingency <= 100
				? contingency
				: 0,
		market: market.ok ? market.value : null,
		updatedAt: Predicate.isString(updatedAt) ? updatedAt : "",
	};
}

/** Whether `cents` is a day value the board can use: whole dollars, $1 to $10,000. */
export function validDayValue(cents: RawValue): cents is number {
	return (
		Predicate.isNumber(cents) &&
		Number.isInteger(cents) &&
		cents >= DAY_VALUE_MIN_CENTS &&
		cents <= DAY_VALUE_MAX_CENTS &&
		cents % 100 === 0
	);
}

/** The researched range for a kind and size, or null when the research has none (or holds zeros for it). */
export function marketRange(
	market: MarketReference | null,
	kind: PricingKind,
	size: PricingSize,
): MarketRange | null {
	const range = market?.ranges.find(
		(item) => item.kind === kind && item.size === size,
	);

	return range && range.highUsd > 0 ? range : null;
}
