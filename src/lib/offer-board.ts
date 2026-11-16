// The offer board (docs/plans/2026-11-offer-board.md): its lanes, their limits, the request the owner page sends and the
// model's reply as the route and the page read it. Pure and browser-safe, read field by field with ./fields like the
// brief board. The model never sets a price: it estimates days per milestone and names a market figure, and ordinary
// code (./offer-pricing) turns those into ranges with the owner's own numbers.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	type LaneConfig,
	hasLink,
	oneLine,
	ownField,
	pricesOrLinks,
} from "./brief-board";
import {
	type RawValue,
	choiceField,
	fieldOf,
	readFields,
	stringField,
} from "./fields";
import { HALF_DAYS_MAX, HALF_DAYS_MIN } from "./offer-pricing";
import {
	MARKET_USD_MAX,
	PRICING_SIZES,
	type PricingKind,
	type PricingSize,
} from "./pricing-reference";

export const OFFER_LANES = [
	"outcome",
	"summary",
	"milestones",
	"inputs",
	"exclusions",
	"timing",
	"questions",
	"drivers",
] as const;

export type OfferLane = (typeof OFFER_LANES)[number];

export const offerLaneLabels: Record<OfferLane, string> = {
	outcome: "Outcome",
	summary: "Summary",
	milestones: "Milestones",
	inputs: "What you need from them",
	exclusions: "Outside this offer",
	timing: "Timing",
	questions: "Questions to ask",
	drivers: "What drives the cost",
};

/** The cards a lane holds at most. An offer has at most three milestones. */
export const offerLaneLimits: Record<OfferLane, number> = {
	outcome: 3,
	summary: 2,
	milestones: 3,
	inputs: 6,
	exclusions: 6,
	timing: 2,
	questions: 4,
	drivers: 4,
};

/** Each lane's text limit: the offer editor's own field limits. */
export const offerTextLimits: Record<OfferLane, number> = {
	outcome: 120,
	summary: 300,
	milestones: 80,
	inputs: 120,
	exclusions: 120,
	timing: 200,
	questions: 200,
	drivers: 120,
};

/**
 * The offer board's lanes for the board's rules (src/lib/brief-board.ts `applyReplyIn` and the `...In` actions): no lane
 * takes an answer, and a card stands while it names no price, cost or link (durations and promises belong in an offer).
 */
export const OFFER_LANE_CONFIG: LaneConfig<OfferLane> = {
	lanes: OFFER_LANES,
	limits: offerLaneLimits,
	textLimits: offerTextLimits,
	answerLane: null,
	stands: (card) => !pricesOrLinks(card.text),
};

export const OFFER_REASON_MAX = 160;
export const DELIVERABLES_MAX = 8;
export const ACCEPTANCE_MAX = 5;
export const ITEM_MAX = 200;

/** The most characters of draft and card text one request may carry; the page fits its request to it. */
export const OFFER_CONTENT_MAX = 24000;

/** The most cards a request shows the model: the whole board (its lanes hold 30) and the cards set aside. */
export const OFFER_CONTEXT_MAX = 60;

/** The most cards one reply may carry. */
export const OFFER_REPLY_MAX = 24;

/** Whether a value is a card ref as the board gives them. */
const isRef = (ref: RawValue): ref is string =>
	Predicate.isString(ref) && /^c\d{1,6}$/.test(ref);

/** Up to the request's limit of a list's items, the rest ignored; [] when it is not a list. */
const firstOf = (raw: RawValue): readonly RawValue[] =>
	Array.isArray(raw) ? raw.slice(0, OFFER_CONTEXT_MAX) : [];

/** The refs a reply keeps as they are without repeating them (its `keep` list). */
export function keptRefs(raw: RawValue): string[] {
	return firstOf(ownField(raw, "keep")).filter(isRef);
}

/** The refs on a reply's cards, read or not (a card the reader drops still names a card the reply keeps). */
export function cardRefs(raw: RawValue): string[] {
	return firstOf(ownField(raw, "cards"))
		.map((item) => ownField(item, "ref"))
		.filter(isRef);
}

/** A list of refs as the route answers it. */
export function refList(raw: RawValue): string[] {
	return firstOf(raw).filter(isRef);
}

/** A milestone's detail: what it delivers, how the client checks it, and the model's days for it (low and high). */
export type MilestoneDetail = {
	readonly deliverables: readonly string[];
	readonly acceptance: readonly string[];
	readonly daysLow: number;
	readonly daysHigh: number;
};

export type OfferReplyCard = {
	readonly ref: string;
	readonly lane: OfferLane;
	readonly text: string;
	readonly reason: string;
	/** For a milestone; null in every other lane. */
	readonly detail: MilestoneDetail | null;
};

/** The model's reading of the project's size and its market figure, both checked again by ordinary code. */
export type OfferSizing = {
	readonly size: PricingSize | null;
	readonly sizeReason: string;
	/** A whole-dollar figure for the whole project, held inside the researched range by `withinRange` before use. */
	readonly figureUsd: number | null;
	readonly figureReason: string;
};

export type OfferReply = OfferSizing & {
	readonly cards: readonly OfferReplyCard[];
};

/** What the page shows the model of the board: each card's ref, lane, text and whether it is open, the owner's or set aside. */
export type OfferContextCard = {
	readonly ref: string;
	readonly lane: OfferLane;
	readonly text: string;
	readonly state: "open" | "yours" | "avoid";
};

/** The offer as drafted in the page, without any fee: what the model may build on. */
export type OfferDraft = {
	readonly outcome: string;
	readonly summary: string;
	readonly milestones: readonly {
		readonly name: string;
		readonly deliverables: readonly string[];
		readonly acceptance: readonly string[];
	}[];
	readonly clientInputs: string;
	readonly exclusions: string;
	readonly timing: string;
};

/** A request from the owner page: the board's cards and the draft. The brief itself is read from the database. */
export type OfferBoardRequest = {
	readonly cards: readonly OfferContextCard[];
	readonly draft: OfferDraft;
};

/**
 * The cards a request shows the model, within OFFER_CONTENT_MAX characters with the draft (the route's limit): set-aside
 * cards are left out first, then the owner's, from the last. Open cards are always shown, as in the living brief.
 */
export function fitOfferCards(
	cards: readonly OfferContextCard[],
	draftLength: number,
): OfferContextCard[] {
	const fitted = [...cards];

	let size =
		draftLength + fitted.reduce((sum, card) => sum + card.text.length, 0);

	for (const state of ["avoid", "yours"] as const)
		for (let at = fitted.length - 1; size > OFFER_CONTENT_MAX && at >= 0; at--)
			if (fitted[at].state === state) {
				size -= fitted[at].text.length;
				fitted.splice(at, 1);
			}

	return fitted;
}

const unreadable = { missing: "Missing.", wrongType: () => "Not text." };

const text = (max: number) =>
	stringField(unreadable, Schema.isMaxLength(max, { message: "Too long." }));

/** A number of days: half a day to 60, in halves. */
const days = fieldOf<number>((raw) =>
	Predicate.isNumber(raw) &&
	Number.isInteger(raw * 2) &&
	raw * 2 >= HALF_DAYS_MIN &&
	raw * 2 <= HALF_DAYS_MAX
		? { value: raw }
		: { say: "Half a day to 60 days, in halves." },
);

const replyCardFields = {
	ref: text(12),
	lane: choiceField(OFFER_LANES, {
		...unreadable,
		notOneOf: () => "Not a lane.",
	}),
	text: text(400),
	reason: text(400),
};

const detailFields = { daysLow: days, daysHigh: days };

/** What `raw` holds under its own key `name`, unread. */
const own = (raw: RawValue, name: string): RawValue =>
	Predicate.isObject(raw) && !Array.isArray(raw) && Object.hasOwn(raw, name)
		? raw[name]
		: undefined;

/** A line as the offer editor compares lines for repeats (src/lib/software-offers.ts). */
const sameLine = (line: string) =>
	line.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A list of short lines, each cleaned. A line that is empty, too long, names money or a link, or repeats an earlier one
 * (the offer editor refuses a milestone whose deliverables repeat) is left out on its own; null when it is not a list,
 * is too long, or no line is left.
 */
function lines(raw: RawValue, max: number): string[] | null {
	if (!Array.isArray(raw) || raw.length > max) return null;

	const seen = new Set<string>();

	const read = raw
		.map((item) => (Predicate.isString(item) ? oneLine(item) : ""))
		.filter((item) => {
			if (!item || item.length > ITEM_MAX || pricesOrLinks(item)) return false;

			const key = sameLine(item);

			if (seen.has(key)) return false;
			seen.add(key);

			return true;
		});

	return read.length > 0 ? read : null;
}

/** A milestone's detail from the model, or null when any part is missing or out of bounds. */
function readDetail(raw: RawValue): MilestoneDetail | null {
	const deliverables = lines(own(raw, "deliverables"), DELIVERABLES_MAX);
	const acceptance = lines(own(raw, "acceptance"), ACCEPTANCE_MAX);
	const read = readFields(detailFields, raw);

	if (
		!deliverables ||
		!acceptance ||
		!read.ok ||
		read.value.daysLow > read.value.daysHigh
	)
		return null;

	return { deliverables, acceptance, ...read.value };
}

/**
 * The reply, read from anything (the model's JSON on the server, the route's JSON in the page): each card cleaned and
 * within its lane's text limit, with no price, cost or link in it (money belongs to the pricing panel), and a milestone
 * only with its full detail. Anything else is left out; null when the reply has no list of cards. The size and the
 * figure are kept only when they are one of the sizes and a whole number of dollars.
 */
export function readOfferReply(raw: RawValue): OfferReply | null {
	const items = own(raw, "cards");

	if (!Array.isArray(items) || items.length > 60) return null;
	const cards: OfferReplyCard[] = [];

	for (const item of items) {
		const read = readFields(replyCardFields, item, {
			defaults: { ref: "", reason: "" },
		});

		if (!read.ok) continue;
		const card = read.value;
		const words = oneLine(card.text);
		const reason = oneLine(card.reason);

		// The model puts a milestone's detail on the card; the route's answer nests it under `detail`.
		const detail =
			card.lane === "milestones"
				? readDetail(own(item, "detail") ?? item)
				: null;

		if (
			!words ||
			words.length > offerTextLimits[card.lane] ||
			pricesOrLinks(words) ||
			reason.length > OFFER_REASON_MAX ||
			pricesOrLinks(reason) ||
			(card.lane === "milestones" && !detail)
		)
			continue;

		cards.push({ ref: card.ref, lane: card.lane, text: words, reason, detail });

		if (cards.length === OFFER_REPLY_MAX) break;
	}

	const size = own(raw, "size");
	const figure = own(raw, "figureUsd");
	const sizeReason = own(raw, "sizeReason");
	const figureReason = own(raw, "figureReason");

	return {
		cards,
		size: PRICING_SIZES.find((known) => known === size) ?? null,
		sizeReason:
			Predicate.isString(sizeReason) && !pricesOrLinks(sizeReason)
				? oneLine(sizeReason).slice(0, OFFER_REASON_MAX)
				: "",
		figureUsd:
			Predicate.isNumber(figure) &&
			Number.isInteger(figure) &&
			figure >= 1 &&
			figure <= MARKET_USD_MAX
				? figure
				: null,
		// The reason may name the figure, but never a link (a bare domain included, as in every other text).
		figureReason:
			Predicate.isString(figureReason) && !hasLink(figureReason)
				? oneLine(figureReason).slice(0, OFFER_REASON_MAX * 2)
				: "",
	};
}

/** The kind of work a software brief's path is priced as; null for the retired idea path or anything else. */
export function pricingKind(path: RawValue): PricingKind | null {
	return path === "website" || path === "webapp" || path === "workflow"
		? path
		: null;
}
