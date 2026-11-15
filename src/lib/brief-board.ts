// The living brief's board (docs/plans/2026-11-living-brief.md): the outline a visitor and the interpreting model shape at
// the same time beside the brief's written answers. This module is the board's rules, shared by the browser and the
// server: what a card is, the reply and outline schemas, how a passage is checked against the answers, how a reply is
// applied (`applyReply`, modelled in verification/brief-board.qnt) and what the visitor's own actions do. Pure and
// synchronous: Effect Schema only, decoded with `decodeUnknownResult`; no Effect runtime, service or storage.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
	type Mutable,
	type RawValue,
	choiceField,
	readFields,
	stringField,
} from "./fields";
import type { SoftwarePath } from "./software-inquiry";

export const LANES = ["purpose", "audience", "parts", "questions"] as const;

export type Lane = (typeof LANES)[number];

/** Each lane's heading, by path. */
export const laneLabels: Record<SoftwarePath, Record<Lane, string>> = {
	website: {
		purpose: "What it’s for",
		audience: "Who it’s for",
		parts: "Pages",
		questions: "Open questions",
	},
	webapp: {
		purpose: "What it’s for",
		audience: "Who uses it",
		parts: "What people can do",
		questions: "Open questions",
	},
	workflow: {
		purpose: "What should change",
		audience: "Who does the work",
		parts: "Steps today",
		questions: "Open questions",
	},
};

/** What "Add" asks for in each lane, by path: the label of the visitor's own note. */
export const addLabels: Record<SoftwarePath, Record<Lane, string>> = {
	website: {
		purpose: "Add what it’s for",
		audience: "Add who it’s for",
		parts: "Add a page",
		questions: "Add a question",
	},
	webapp: {
		purpose: "Add what it’s for",
		audience: "Add who uses it",
		parts: "Add something people can do",
		questions: "Add a question",
	},
	workflow: {
		purpose: "Add what should change",
		audience: "Add who does the work",
		parts: "Add a step",
		questions: "Add a question",
	},
};

/** The most cards a lane holds, set-aside cards not counted. */
export const laneLimits: Record<Lane, number> = {
	purpose: 2,
	audience: 3,
	parts: 8,
	questions: 4,
};

/** The longest text a card in each lane may have. */
export const textLimits: Record<Lane, number> = {
	purpose: 140,
	audience: 80,
	parts: 60,
	questions: 140,
};

export const QUOTE_MAX = 160;
export const REASON_MAX = 100;
export const ANSWER_MAX = 240;

/** The most items an outline sent with a brief may have: every lane full. */
export const OUTLINE_MAX = LANES.reduce(
	(sum, lane) => sum + laneLimits[lane],
	0,
);

/** The most cards a reply may carry. */
export const REPLY_MAX = 12;

/** The most cards a request shows the model as context. */
export const CONTEXT_MAX = 30;

/** The most characters of answers and card text one request may carry (the server refuses more). */
export const CONTENT_MAX = 7000;

/** The most requests one page makes. */
export const REQUESTS_PER_PAGE = 24;

/** The most visitor actions Undo remembers. */
export const HISTORY_MAX = 40;

/** The written answers each path sends for interpretation: the same boxes the autocomplete reads, never contact details. */
export const boardAnswerKeys: Record<SoftwarePath, readonly string[]> = {
	website: ["purpose"],
	webapp: ["appGoal", "firstVersion"],
	workflow: ["today", "firstResult"],
};

// ---- Cards --------------------------------------------------------------------------------------------------------

/**
 * proposed: the model's, not yet the visitor's. kept, edited, dismissed (set aside) and wrote (the visitor's own note) are
 * owned: no reply changes them.
 */
export type CardStatus = "proposed" | "kept" | "edited" | "dismissed" | "wrote";

/** said: read from the visitor's answers, with the passage quoted. suggested: an inference. none: the visitor's note. */
export type Basis = "said" | "suggested" | "none";

export type BoardCard<L extends string = Lane> = {
	readonly id: string;
	readonly lane: L;
	readonly text: string;
	readonly status: CardStatus;
	readonly basis: Basis;
	/** The visitor's own words the card was read from, for basis "said"; otherwise "". */
	readonly quote: string;
	/** Why the model suggested it, for basis "suggested"; otherwise "". */
	readonly reason: string;
	/** The visitor's answer to a question card; otherwise "". */
	readonly answer: string;
	/** How many requests had been sent when the card last became unowned. Only a later request's reply may change it. */
	readonly since: number;
	/** Whether the visitor's words replaced the model's, so a card set aside and brought back is still theirs as edited. */
	readonly edited: boolean;
};

/** One visitor action, for Undo: each card it changed as it was before (null: the action added it), and where it was. */
export type HistoryStep<L extends string = Lane> = {
	readonly label: string;
	readonly before: readonly {
		readonly id: string;
		readonly card: BoardCard<L> | null;
		readonly index: number;
	}[];
};

/** A note the visitor removed: its lane and words, so a reply does not offer the idea back in that lane. */
export type RemovedNote<L extends string = Lane> = {
	readonly lane: L;
	readonly text: string;
};

/**
 * What the board's rules need to know about a set of lanes: the lanes, how many cards and how many characters each
 * holds, the lane whose cards take an answer (if any), and whether a card still stands. The living brief's are BRIEF_LANES;
 * the offer board (src/lib/offer-board.ts) has its own, and the same rules.
 */
export type LaneConfig<L extends string> = {
	readonly lanes: readonly L[];
	readonly limits: Readonly<Record<L, number>>;
	readonly textLimits: Readonly<Record<L, number>>;
	readonly answerLane: L | null;
	readonly stands: (card: BoardCard<L>, answers: string) => boolean;
};

export type Board<L extends string = Lane> = {
	readonly cards: readonly BoardCard<L>[];
	readonly nextId: number;
	/** Requests sent so far: each request's number is the count after it was sent. */
	readonly sent: number;
	/** The number of the newest reply applied (0: none). */
	readonly applied: number;
	readonly history: readonly HistoryStep<L>[];
	/**
	 * The words of notes the visitor removed, so a reply does not offer them back. Kept in memory only: never saved with
	 * the board and never sent to the model, because a removed note is gone as far as the visitor is concerned.
	 */
	readonly removed?: readonly RemovedNote<L>[];
};

export const emptyBoard = <L extends string = Lane>(): Board<L> => ({
	cards: [],
	nextId: 1,
	sent: 0,
	applied: 0,
	history: [],
});

export const isOwned = (card: Pick<BoardCard, "status">) =>
	card.status !== "proposed";

/** The cards that count toward a lane's limit: everything but set-aside cards. */
export const laneCount = <L extends string>(board: Board<L>, lane: L) =>
	board.cards.filter(
		(card) => card.lane === lane && card.status !== "dismissed",
	).length;

// ---- Text ---------------------------------------------------------------------------------------------------------

const CONTROLS = new RegExp(
	"[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]",
	"g",
);

/** One line of plain text: control characters removed, spaces collapsed, trimmed. */
export const oneLine = (text: string) =>
	text.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();

/** Text for comparing a passage with the answers: case, spacing, quote marks and dashes ignored. */
export const comparable = (text: string) =>
	text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[‘’‚‛′`´]/g, "'")
		.replace(/[“”„‟″]/g, '"')
		.replace(/[‐-―]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'.,;:!?()-]+|["'.,;:!?()-]+$/g, "")
		.trim();

/** The fewest words a passage needs: a word or two of the answers ("and", "shop") would ground anything. */
export const PASSAGE_MIN_WORDS = 3;

// A word is letters, combining marks (Devanagari's vowel signs, Thai's tone marks), digits and apostrophes. Scripts
// written without spaces between words count each character as a word of its own, weighted so that a passage needs
// about as much text as three words: four Chinese or Japanese characters, eight Thai, Lao, Khmer or Myanmar letters.
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}'‘’`´′]/u;
const MARK = /\p{M}/u;

const IDEOGRAPHIC =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fc]/u;

const UNSPACED_LETTERS =
	/[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

type Token = {
	readonly word: string;
	readonly start: number;
	readonly end: number;
	readonly weight: number;
};

function wordWeight(character: string) {
	if (IDEOGRAPHIC.test(character)) return 0.75;

	if (UNSPACED_LETTERS.test(character)) return 0.375;

	return 1;
}

/** The words of `text` with where each starts and ends in it, compared case, width and apostrophe style aside. */
function tokensOf(text: string): Token[] {
	const tokens: Token[] = [];

	let start = -1,
		end = -1,
		weight = 1,
		at = 0;

	const close = () => {
		const word = text
			.slice(start, end)
			.normalize("NFKC")
			.toLowerCase()
			.replace(/[‘’`´′]/g, "'")
			.replace(/^'+|'+$/g, "");

		if (start >= 0 && word) tokens.push({ word, start, end, weight });
		start = -1;
	};

	for (const character of text) {
		const next = at + character.length;

		if (!WORD_CHARACTER.test(character)) close();
		else if (MARK.test(character) && start >= 0) end = next;
		else {
			const own = wordWeight(character);

			// A character of an unspaced script is a word of its own, and so ends the word before it.
			if (start >= 0 && (own < 1 || weight < 1)) close();

			if (start < 0) {
				start = at;
				weight = own;
			}

			end = next;
		}

		at = next;
	}

	close();

	return tokens;
}

// A passage right after one of these says the opposite of what it seems to ("we do not want online payments").
const NEGATIONS = new Set([
	"not",
	"no",
	"never",
	"without",
	"nor",
	"neither",
	"don't",
	"dont",
	"doesn't",
	"doesnt",
	"didn't",
	"won't",
	"wont",
	"can't",
	"cant",
	"cannot",
	"isn't",
	"aren't",
	"wasn't",
	"shouldn't",
]);

// Words that may stand between a negation and what it negates ("we don't really want online payments").
const SOFTENERS = new Set([
	"really",
	"actually",
	"even",
	"necessarily",
	"currently",
	"ever",
	"yet",
	"truly",
	"need",
	"to",
]);

/** Whether the words before token `at` negate it: a negation in the same sentence, at most two softening words back. */
function negatedAt(have: readonly Token[], at: number, answers: string) {
	for (let back = at - 1; back >= 0 && back >= at - 3; back--) {
		// A sentence ends between them: "No. Customers call us to book."
		if (/[.!?;:]/.test(answers.slice(have[back].end, have[back + 1].start)))
			return false;

		if (NEGATIONS.has(have[back].word)) return true;

		if (!SOFTENERS.has(have[back].word)) return false;
	}

	return false;
}

/**
 * The passage of the answers that `quote` repeats, exactly as the answers have it, or null when there is none: at least
 * PASSAGE_MIN_WORDS words, found in the answers in order (case, spacing, punctuation and quote marks aside), starting
 * and ending on word boundaries, and not negated in its sentence.
 */
export function groundedPassage(quote: string, answers: string): string | null {
	const wanted = tokensOf(quote);

	if (wanted.reduce((sum, token) => sum + token.weight, 0) < PASSAGE_MIN_WORDS)
		return null;
	const have = tokensOf(answers);

	for (let at = 0; at + wanted.length <= have.length; at++) {
		if (!wanted.every((token, offset) => have[at + offset].word === token.word))
			continue;

		if (negatedAt(have, at, answers)) continue;

		return answers.slice(have[at].start, have[at + wanted.length - 1].end);
	}

	return null;
}

/** Whether `quote` is a passage of the answers (see groundedPassage). */
export const quotedFrom = (quote: string, answers: string) =>
	groundedPassage(quote, answers) !== null;

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"of",
	"for",
	"to",
	"in",
	"on",
	"at",
	"with",
	"my",
	"our",
	"your",
	"their",
	"its",
	"is",
	"are",
	"be",
	"page",
	"pages",
	"section",
	"area",
]);

const singular = (word: string) =>
	word.length <= 3
		? word
		: word.endsWith("ies")
			? `${word.slice(0, -3)}y`
			: /(ss|ch|sh|x)es$/.test(word)
				? word.slice(0, -2)
				: word.endsWith("s") && !word.endsWith("ss")
					? word.slice(0, -1)
					: word;

/** The words that identify an idea: lower case, no accents or punctuation, singular, common small words left out. */
export function ideaWords(text: string): Set<string> {
	const words = text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word && !STOP_WORDS.has(word))
		.map(singular);

	return new Set(words);
}

/** Whether two cards say the same idea: the same words, one inside the other, or mostly the same words. */
export function sameIdea(a: string, b: string): boolean {
	const x = ideaWords(a),
		y = ideaWords(b);

	if (x.size === 0 || y.size === 0)
		return oneLine(a).toLowerCase() === oneLine(b).toLowerCase();

	const shared = [...x].filter((word) => y.has(word)).length;

	return (
		shared === Math.min(x.size, y.size) ||
		shared / (x.size + y.size - shared) >= 0.6
	);
}

// Rule 7 of the plan: a card never carries a price, a time estimate, a promise or a link. Text is compared after NFKC,
// so full-width forms (＄, ５) read as their plain ones. These are a net under the model's instructions, not a proof: the
// common forms in English and the most common duration and currency forms in a few other languages.
const MONEY_WORDS =
	"budget(?:ed)?|estimate[ds]?|quote[ds]?|prices?|priced|fees?|costs?|around|about|roughly|approximately|under|over|below|above|up to|less than|more than";

const MONEY = new RegExp(
	[
		"[$€£¥₹₩]\\s?\\d[\\d,.]*(?:\\s?(?:k|m|million|thousand)\\b)?",
		"\\d[\\d,.]*\\s?(?:usd|eur|gbp|cad|aud|dollars?|euros?|pounds?|bucks)\\b",
		"\\d[\\d,.]*\\s?(?:円|元|万円|万元|千円|원|만원)",
		`\\b(?:${MONEY_WORDS})\\s*(?:of|is|at|around|about|:)?\\s*\\d[\\d,.]*\\s?k\\b`,
		"\\b(?:budget(?:ed)?|estimate[ds]?|quote[ds]?|prices?|priced|fees?|costs?)\\s*(?:of|is|at|around|about|under|over|roughly|:)?\\s*\\d[\\d,.]*",
		"\\b(?:under|over|below|above|up to|less than|more than)\\s+\\d{1,3}(?:,\\d{3})+\\b",
	].join("|"),
	"iu",
);

const NUMBER_WORDS =
	"a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple of|several";

const DURATION = new RegExp(
	[
		"\\b\\d+(?:\\.\\d+)?\\s*(?:-|to)?\\s*\\d*\\s*(?:hours?|hrs?|days?|weeks?|wks?|months?|years?|sprints?)\\b",
		`\\b(?:${NUMBER_WORDS})[- ](?:hours?|days?|weeks?|months?|years?)\\b`,
		"\\b(?:fortnights?|overnight|same[- ]day|asap)\\b",
		"(?<![\\p{N}])\\d+\\s*(?:semanas?|meses|mes|d[ií]as?|wochen?|monate?n?|tagen?|semaines?|mois|jours?|settimane?|mesi|giorni)(?![\\p{L}])",
		"\\d+\\s*(?:週間|か月|ヶ月|カ月|日間|天|周|個月|个月|星期|주|개월|일간)",
	].join("|"),
	"iu",
);

const PROMISE =
	/\b(?:i will|i'll|we will|we'll|kazon will|guarantee[sd]?|promise[sd]?|deadline|delivered by|ready by|done by)\b/i;

const MONTHS =
	"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const DATE = new RegExp(
	[
		"\\b\\d{4}-\\d{2}-\\d{2}\\b",
		"\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b",
		`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
		`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b`,
		`\\b(?:by|before|until|in time for)\\s+(?:the\\s+)?(?:${MONTHS}|christmas|holidays|spring|summer|fall|autumn|winter|launch|next|end of|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b`,
		"\\b(?:next|this|end of the)\\s+(?:week|month|quarter|year|season)\\b",
		"\\b(?:today|tonight|tomorrow)\\b",
		"\\bq[1-4]\\b",
		"\\b(?:19|20)\\d{2}\\b",
	].join("|"),
	"iu",
);

// What the project costs is the owner's to say, after reading the brief. A page named "Pricing" or "Request a quote"
// is about the visitor's own business and is allowed.
const COST =
	/\b(?:costs?|costing)\s+(?:about|around|roughly|under|less|no more|at most|only|just|\$|\d)|\b(?:affordable|cheap|inexpensive|low[- ]cost|fixed[- ]price)\b|\b(?:a|one|two|three|four|five|six|seven|eight|nine|ten|few|several)\s+(?:hundred|thousand)\b/i;

// Cards are about the visitor's project; a card never speaks for the owner or says what will be delivered when.
const ON_BEHALF =
	/\bkazon\b|\b(?:can|could|will|would)\s+(?:deliver|build|launch|ship|finish|have it)\b|\bdeliver(?:ed|s)?\s+(?:it|by|in|within|on)\b/i;

// A domain name with a common top-level domain, or any name followed by a path. A file name ("orders.csv"), a degree
// ("B.Sc") or a framework ("Next.js") is not a link.
const LINK =
	/https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|dev|app|co|us|uk|ai|shop|store|site|online|info|biz|me|tv|xyz|de|fr|es|it|nl|eu|ca|au|in)\b|\b[\w-]+\.[a-z]{2,24}\/|[\w.+-]+@[\w-]+\./i;

const COMMITMENTS = [MONEY, DURATION, DATE, COST, ON_BEHALF, PROMISE, LINK];

/** Text as commitments are looked for in it and compared: NFKC, lower case, one apostrophe style, single spaces. */
const plainText = (text: string) =>
	text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[‘’`´′]/g, "'")
		.replace(/\s+/g, " ");

/**
 * Whether text names a price, a cost or a link: the offer board's filter, where durations and promises belong to the
 * offer the owner writes, but money belongs to the pricing panel and links to nobody.
 */
export const pricesOrLinks = (text: string) =>
	[MONEY, COST, LINK].some((pattern) => pattern.test(plainText(text)));

/**
 * Whether text makes a commitment or points somewhere: a price, a time estimate, a date, a promise, a link or an
 * address. Fixed, whatever the answers say: a card that repeats the visitor's "classes run for 4 weeks" is left out too,
 * and the visitor's words stay in their answers. (Allowing a phrase the visitor wrote was tried and reviewed twice: every
 * way of matching "their phrase" let a different amount or duration through, and an allowance that lapsed when the
 * visitor edited their answers left cards on the board that the server then refused.)
 */
export function commits(text: string): boolean {
	const plain = plainText(text);

	return COMMITMENTS.some((pattern) => pattern.test(plain));
}

/**
 * Whether a card stands: its words commit to nothing, and, for a card read from the answers, its passage is still in
 * them. A card that does not is not sent as read from the answers, and a reply that names it does not keep it.
 */
export const standsOn = (
	card: Pick<BoardCard, "basis" | "quote" | "text">,
	answers: string,
) =>
	!commits(card.text) &&
	(card.basis !== "said" || quotedFrom(card.quote, answers));

/** The living brief's lanes for the board's rules. */
export const BRIEF_LANES: LaneConfig<Lane> = {
	lanes: LANES,
	limits: laneLimits,
	textLimits,
	answerLane: "questions",
	stands: standsOn,
};

// ---- Lists --------------------------------------------------------------------------------------------------------

/**
 * The items of a list of at most `max`, unread, or null when `raw` is not one. Each item is then read field by field (see
 * the note under "The reply"), never with a `Schema.Array`, `Schema.Record` or `Schema.Struct` decoder.
 */
export function listOf(raw: RawValue, max: number): readonly RawValue[] | null {
	return Array.isArray(raw) && raw.length <= max ? raw : null;
}

// ---- The reply ----------------------------------------------------------------------------------------------------

// The browser reads every object here field by field, with the shared helpers in ./fields (`readFields`, `stringField`,
// `choiceField`), as the site's other browser readers do. A `Schema.Struct`, `Schema.Array` or `Schema.Record` decoder
// brings Effect's concurrent parsing into the browser bundle, which tests/architecture/client-bundle.test.ts refuses.

const unreadable = { missing: "Missing.", wrongType: () => "Not text." };

/** Text of at most `max` characters, trimmed. */
const text = (max: number) =>
	stringField(unreadable, Schema.isMaxLength(max, { message: "Too long." }));

/** One of `values`. */
const oneOf = <const V extends readonly [string, ...string[]]>(values: V) =>
	choiceField(values, { ...unreadable, notOneOf: () => "Not one of them." });

/** What `raw` holds under its own key `name`, unread; undefined when it is not an object or has no such key. */
export const ownField = (raw: RawValue, name: string): RawValue =>
	Predicate.isObject(raw) && !Array.isArray(raw) && Object.hasOwn(raw, name)
		? raw[name]
		: undefined;

/** Whether `raw` is an object with its own key `name`. */
const has = (raw: RawValue, name: string) =>
	Predicate.isObject(raw) && !Array.isArray(raw) && Object.hasOwn(raw, name);

/** One card as the model answers it. Each card is read on its own, so one bad card does not lose the rest. */
const replyCardFields = {
	ref: text(12),
	lane: oneOf(LANES),
	text: text(200),
	basis: oneOf(["said", "suggested"]),
	quote: text(400),
	reason: text(300),
};

const replyCardDefaults = { ref: "", quote: "", reason: "" };

export type ReplyCard<L extends string = Lane> = {
	readonly ref: string;
	readonly lane: L;
	readonly text: string;
	readonly basis: "said" | "suggested";
	readonly quote: string;
	readonly reason: string;
};

/**
 * The cards of a reply that are fit to show, read from anything (the model's JSON on the server, the route's JSON in the
 * browser): each card's text cleaned and within its lane's limit, a passage for one read from the answers, a short reason
 * for an inference, nothing that makes a commitment or links anywhere, and a passage that is in `answers`. Anything else
 * is left out; null when the reply itself is not a list of cards. At most REPLY_MAX cards.
 */
export function readReply(raw: RawValue, answers: string): ReplyCard[] | null {
	const items = listOf(ownField(raw, "cards"), 40);

	if (!items) return null;

	const cards: ReplyCard[] = [];

	for (const item of items) {
		const read = readFields(replyCardFields, item, {
			defaults: replyCardDefaults,
		});

		if (!read.ok) continue;
		const card = read.value;
		const words = oneLine(card.text);
		const reason = oneLine(card.reason);

		// The passage as the visitor wrote it, so a quote never shows words or symbols the model added.
		const quote =
			card.basis === "said"
				? oneLine(groundedPassage(oneLine(card.quote), answers) ?? "")
				: "";

		if (
			!words ||
			words.length > textLimits[card.lane] ||
			commits(words) ||
			(card.basis === "said" && (!quote || quote.length > QUOTE_MAX)) ||
			reason.length > REASON_MAX ||
			commits(reason)
		)
			continue;

		cards.push({
			ref: card.ref,
			lane: card.lane,
			text: words,
			basis: card.basis,
			quote,
			reason: card.basis === "suggested" ? reason : "",
		});

		if (cards.length === REPLY_MAX) break;
	}

	return cards;
}

/**
 * Every card a reply names by its ref, whether or not the card it gave is fit to show. A card the reply named but whose
 * new version was left out (a passage that is not there, a commitment, a card past REPLY_MAX) stays as it is: leaving a
 * card out of a reply withdraws it, and naming it badly is not leaving it out.
 */
export function replyRefs(raw: RawValue): string[] {
	const items = listOf(ownField(raw, "cards"), 40) ?? [];

	return items
		.map((item) => ownField(item, "ref"))
		.filter(
			(ref): ref is string => Predicate.isString(ref) && /^c\d{1,6}$/.test(ref),
		);
}

/** Why the route did not interpret: "pass" (renew the pass), "limit", "off", "busy" or "" when it did not say. */
export type BoardRefusal = "pass" | "limit" | "off" | "busy" | "";

/** The route's answer, as the browser reads it. */
export type BoardAnswer = {
	/** The reply's cards, still to be read with `readReply`, when the route sent some. */
	readonly cards: RawValue | undefined;
	/** The cards the reply named (see replyRefs), which it does not withdraw. */
	readonly refs: readonly string[];
	readonly reason: BoardRefusal;
};

const refusals: readonly BoardRefusal[] = ["pass", "limit", "off", "busy"];

/** The route's answer, read in the browser: its cards when it sent some, and the reason it gave when it refused. */
export function readBoardAnswer(raw: RawValue): BoardAnswer {
	const reason = refusals.find((known) => known === ownField(raw, "reason"));

	return {
		cards: has(raw, "cards") ? { cards: ownField(raw, "cards") } : undefined,
		refs: replyRefs({
			cards: (listOf(ownField(raw, "refs"), 40) ?? []).map((ref) => ({ ref })),
		}),
		reason: reason ?? "",
	};
}

/** Whether reply number `n` may change `card`: only an unowned card that was unowned when request `n` was sent. */
/** Whether a reply card says the idea of a note the visitor removed from that lane. */
const removedIdea = <L extends string>(board: Board<L>, item: ReplyCard<L>) =>
	(board.removed ?? []).some(
		(note) => note.lane === item.lane && sameIdea(note.text, item.text),
	);

const mayChange = (card: Pick<BoardCard, "status" | "since">, n: number) =>
	card.status === "proposed" && n > card.since;

export type Applied<L extends string = Lane> = {
	readonly board: Board<L>;
	readonly added: number;
	readonly updated: number;
	readonly withdrawn: number;
};

/**
 * Applies reply number `n` to the board as it is now. Nothing changes when the reply is older than one already applied
 * or the board is paused. Otherwise each reply card that names an unowned card (by its id, or by saying the same idea)
 * updates it, if the reply's request was sent after the card last became unowned; one that names an owned card, or a
 * set-aside idea, is left out. An unowned card the reply leaves out is withdrawn, again only if the request was sent
 * after it last became unowned; a card the reply names in `refs` (or by a card left out below) is not left out. Then each
 * new idea is added at the end of its lane, within the lane's limit as it is after the withdrawals. A card read from the
 * answers is checked against the answers as they are now (`answers`), not as they were sent.
 */
export function applyReply(
	board: Board,
	reply: readonly ReplyCard[],
	n: number,
	answers: string,
	paused: boolean,
	refs: readonly string[] = [],
): Applied {
	return applyReplyIn(BRIEF_LANES, board, reply, n, answers, paused, refs);
}

/** applyReply for any set of lanes: the same rules, with the lanes' limits and their own test of whether a card stands. */
export function applyReplyIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	reply: readonly ReplyCard<L>[],
	n: number,
	answers: string,
	paused: boolean,
	refs: readonly string[] = [],
): Applied<L> {
	if (paused || n <= board.applied)
		return { board, added: 0, updated: 0, withdrawn: 0 };

	const cards = [...board.cards];

	// A card named by a reply card that was left out stays, while what it says is still supported: a suggestion, or a
	// card read from the answers whose passage is still in them. One whose passage the visitor deleted is withdrawn.
	const supported = (card: BoardCard<L>) => config.stands(card, answers);

	const named = new Set<string>(
		cards.flatMap((card) =>
			refs.includes(card.id) && supported(card) ? [card.id] : [],
		),
	);

	const fresh: ReplyCard<L>[] = [];

	let updated = 0;

	for (const item of reply) {
		// The card the item names: by its ref first, then by saying the same idea.
		const byRef = cards.findIndex(
			(card) =>
				card.lane === item.lane && item.ref !== "" && card.id === item.ref,
		);

		if (item.basis === "said" && !quotedFrom(item.quote, answers)) {
			if (byRef >= 0 && supported(cards[byRef])) named.add(cards[byRef].id);

			continue;
		}

		const index =
			byRef >= 0
				? byRef
				: cards.findIndex(
						(card) => card.lane === item.lane && sameIdea(card.text, item.text),
					);

		if (index < 0) {
			if (
				!fresh.some(
					(other) =>
						other.lane === item.lane && sameIdea(other.text, item.text),
				) &&
				!removedIdea(board, item)
			)
				fresh.push(item);

			continue;
		}

		const card = cards[index];
		named.add(card.id);

		if (!mayChange(card, n)) continue;

		// A rewording never turns a card into another card's idea: one set aside, one the visitor owns, a duplicate, or a
		// new idea earlier in this reply.
		if (
			cards.some(
				(other, at) =>
					at !== index &&
					other.lane === item.lane &&
					sameIdea(other.text, item.text),
			) ||
			fresh.some(
				(other) => other.lane === item.lane && sameIdea(other.text, item.text),
			) ||
			removedIdea(board, item)
		)
			continue;

		const next: BoardCard<L> = {
			...card,
			text: item.text,
			basis: item.basis,
			quote: item.quote,
			reason: item.reason,
		};

		if (
			next.text !== card.text ||
			next.basis !== card.basis ||
			next.quote !== card.quote ||
			next.reason !== card.reason
		) {
			cards[index] = next;
			updated++;
		}
	}

	// A new idea that names, by its ref, an open card in another lane moves that card. The card stays where it is until
	// the new idea is placed, so a move into a full lane leaves it where it was.
	const movedFrom = (item: ReplyCard<L>) =>
		item.ref === ""
			? undefined
			: cards.find(
					(card) =>
						card.id === item.ref &&
						card.lane !== item.lane &&
						mayChange(card, n),
				);

	for (const item of fresh) {
		const from = movedFrom(item);

		if (from) named.add(from.id);
	}

	const kept = cards.filter(
		(card) => named.has(card.id) || !mayChange(card, n),
	);

	const moved = new Set<string>();

	let nextId = board.nextId,
		added = 0;

	for (const item of fresh) {
		// A card reworded later in this reply may now say the new idea.
		if (
			kept.some(
				(card) => card.lane === item.lane && sameIdea(card.text, item.text),
			) ||
			kept.filter(
				(card) => card.lane === item.lane && card.status !== "dismissed",
			).length >= config.limits[item.lane]
		)
			continue;

		kept.push({
			id: `c${nextId++}`,
			lane: item.lane,
			text: item.text,
			status: "proposed",
			basis: item.basis,
			quote: item.quote,
			reason: item.reason,
			answer: "",
			since: board.sent,
			edited: false,
		});
		added++;
		const from = movedFrom(item);

		if (from) moved.add(from.id);
	}

	const result = kept.filter((card) => !moved.has(card.id));

	return {
		board: { ...board, cards: result, nextId, applied: n },
		added,
		updated,
		withdrawn: cards.length - (result.length - added),
	};
}

// ---- The visitor's actions ----------------------------------------------------------------------------------------

/** Records how the cards named in `ids` were, then applies `change` to the board's cards. */
function act<L extends string>(
	board: Board<L>,
	label: string,
	ids: readonly string[],
	change: (cards: BoardCard<L>[]) => BoardCard<L>[],
	nextId = board.nextId,
): Board<L> {
	const before = ids.map((id) => {
		const index = board.cards.findIndex((card) => card.id === id);

		return { id, card: index >= 0 ? board.cards[index] : null, index };
	});

	return {
		...board,
		cards: change([...board.cards]),
		nextId,
		history: [...board.history, { label, before }].slice(-HISTORY_MAX),
	};
}

const replace =
	<L extends string>(id: string, patch: (card: BoardCard<L>) => BoardCard<L>) =>
	(cards: BoardCard<L>[]) =>
		cards.map((card) => (card.id === id ? patch(card) : card));

const find = <L extends string>(board: Board<L>, id: string) =>
	board.cards.find((card) => card.id === id);

/** Keep: an unowned card becomes the visitor's. */
export function keepCard<L extends string>(
	board: Board<L>,
	id: string,
): Board<L> {
	const card = find(board, id);

	if (!card || card.status !== "proposed") return board;

	return act(
		board,
		`kept “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({ ...c, status: "kept" })),
	);
}

/** Edit: the visitor's words replace the card's. A note stays a note. */
export const editCard = (board: Board, id: string, text: string): Board =>
	editCardIn(BRIEF_LANES, board, id, text);

export function editCardIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	id: string,
	text: string,
): Board<L> {
	const card = find(board, id);

	if (!card || card.status === "dismissed") return board;
	const words = oneLine(text).slice(0, config.textLimits[card.lane]);

	if (!words || words === card.text) return board;

	return act(
		board,
		`edited “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({
			...c,
			text: words,
			status: c.status === "wrote" ? "wrote" : "edited",
			edited: c.status !== "wrote",
		})),
	);
}

/** Answer: the visitor's answer to a question. The question becomes the visitor's; an empty answer clears it. */
export const answerCard = (board: Board, id: string, answer: string): Board =>
	answerCardIn(BRIEF_LANES, board, id, answer);

export function answerCardIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	id: string,
	answer: string,
): Board<L> {
	const card = find(board, id);
	const words = oneLine(answer).slice(0, ANSWER_MAX);

	if (
		!card ||
		card.lane !== config.answerLane ||
		card.status === "dismissed" ||
		words === card.answer
	)
		return board;

	return act(
		board,
		`answered “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({
			...c,
			answer: words,
			status: c.status === "proposed" ? "kept" : c.status,
		})),
	);
}

/** Not this: the card is set aside, and the idea is not offered again. */
export function setAside<L extends string>(
	board: Board<L>,
	id: string,
): Board<L> {
	const card = find(board, id);

	if (!card || card.status === "dismissed" || card.status === "wrote")
		return board;

	return act(
		board,
		`set aside “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({ ...c, status: "dismissed" })),
	);
}

/** What a set-aside card returns as: the visitor's note, edited when the visitor had reworded it, or kept. */
function broughtBack(card: Pick<BoardCard, "basis" | "edited">): CardStatus {
	if (card.basis === "none") return "wrote";

	return card.edited ? "edited" : "kept";
}

/** Bring back: a set-aside card returns as the visitor's again (see broughtBack). */
export const bringBack = (board: Board, id: string): Board =>
	bringBackIn(BRIEF_LANES, board, id);

export function bringBackIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	id: string,
): Board<L> {
	const card = find(board, id);

	if (
		!card ||
		card.status !== "dismissed" ||
		laneCount(board, card.lane) >= config.limits[card.lane]
	)
		return board;

	return act(
		board,
		`brought back “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({ ...c, status: broughtBack(c) })),
	);
}

/**
 * Remove: the visitor's own note is deleted (Undo brings it back). Its words are remembered in memory only, so a reply
 * does not offer the idea back during this visit.
 */
export function removeNote<L extends string>(
	board: Board<L>,
	id: string,
): Board<L> {
	const card = find(board, id);

	if (!card || card.status !== "wrote") return board;

	return {
		...act(board, `removed “${card.text}”`, [id], (cards) =>
			cards.filter((c) => c.id !== id),
		),
		removed: [
			...(board.removed ?? []),
			{ lane: card.lane, text: card.text },
		].slice(-HISTORY_MAX),
	};
}

/** Add: the visitor's own note, at the end of its lane, within the lane's limit. */
export const addNote = (board: Board, lane: Lane, text: string): Board =>
	addNoteIn(BRIEF_LANES, board, lane, text);

export function addNoteIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	lane: L,
	text: string,
): Board<L> {
	const words = oneLine(text).slice(0, config.textLimits[lane]);

	if (!words || laneCount(board, lane) >= config.limits[lane]) return board;
	const id = `c${board.nextId}`;

	return act(
		board,
		`added “${words}”`,
		[id],
		(cards) => [
			...cards,
			{
				id,
				lane,
				text: words,
				status: "wrote",
				basis: "none",
				quote: "",
				reason: "",
				answer: "",
				since: 0,
				edited: false,
			},
		],
		board.nextId + 1,
	);
}

/** What the page says when a list is full and the visitor tries to add to it or bring a card back to it. */
export const laneFull = (label: string) =>
	`“${label}” is full. Use Not this on one of its cards, or remove a note, then try again.`;

/** What Undo would undo, for its label; null when there is nothing. */
export const lastAction = <L extends string>(board: Board<L>) =>
	board.history.length ? board.history[board.history.length - 1].label : null;

/**
 * Undo: every card the last action changed is put back as it was, where it was. A card that becomes unowned again is
 * stamped with the requests sent so far, so a reply already on its way does not change it (the plan, rule 4).
 */
export const undo = (board: Board): Board => undoIn(BRIEF_LANES, board);

export function undoIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
): Board<L> {
	const step = board.history[board.history.length - 1];

	if (!step) return board;

	let cards = [...board.cards];

	for (const { id, card, index } of step.before) {
		const at = cards.findIndex((c) => c.id === id);

		if (!card) {
			if (at >= 0) cards.splice(at, 1);

			continue;
		}

		const restored =
			card.status === "proposed" ? { ...card, since: board.sent } : card;

		if (at >= 0) cards[at] = restored;
		else
			cards = [
				...cards.slice(0, Math.max(0, index)),
				restored,
				...cards.slice(Math.max(0, index)),
			];
	}

	// A removed note Undo brings back is no longer removed.
	const restored = step.before.flatMap(({ card }) =>
		card?.status === "wrote" ? [card] : [],
	);

	return {
		...board,
		cards: withinLimits(config, cards),
		history: board.history.slice(0, -1),
		removed: (board.removed ?? []).filter(
			(note) =>
				!restored.some(
					(card) => card.lane === note.lane && card.text === note.text,
				),
		),
	};
}

/**
 * The cards with every lane within its limit. Only Undo can bring a lane past it (a kept card back where a reply has
 * since added one), and the visitor's cards win: the lane's newest open cards are withdrawn until it fits, suggestions
 * before cards read from the answers.
 */
function withinLimits<L extends string>(
	config: LaneConfig<L>,
	cards: readonly BoardCard<L>[],
): BoardCard<L>[] {
	const fitted = [...cards];

	for (const lane of config.lanes)
		for (const basis of ["suggested", "said"] as const) {
			let over =
				fitted.filter(
					(card) => card.lane === lane && card.status !== "dismissed",
				).length - config.limits[lane];

			for (let at = fitted.length - 1; over > 0 && at >= 0; at--)
				if (
					fitted[at].lane === lane &&
					fitted[at].status === "proposed" &&
					fitted[at].basis === basis
				) {
					fitted.splice(at, 1);
					over--;
				}
		}

	return fitted;
}

/** The board after a request is sent: its number is the new count. */
export const sendRequest = <L extends string>(
	board: Board<L>,
): [Board<L>, number] => [{ ...board, sent: board.sent + 1 }, board.sent + 1];

// ---- What the model is shown ---------------------------------------------------------------------------------------

export type ContextCard<L extends string = Lane> = {
	readonly ref: string;
	readonly lane: L;
	readonly text: string;
	/** open: the model's, which it may keep, reword or leave out. yours: the visitor's. avoid: set aside. */
	readonly state: "open" | "yours" | "avoid";
};

/** The cards a request shows the model, at most CONTEXT_MAX: open ones first, then the visitor's, then set-aside ones. */
export function boardContext<L extends string>(
	board: Board<L>,
): ContextCard<L>[] {
	const state = (card: BoardCard<L>): ContextCard["state"] =>
		card.status === "proposed"
			? "open"
			: card.status === "dismissed"
				? "avoid"
				: "yours";

	const order = { open: 0, yours: 1, avoid: 2 };

	return board.cards
		.map((card) => ({
			ref: card.id,
			lane: card.lane,
			text: card.answer ? `${card.text} (answer: ${card.answer})` : card.text,
			state: state(card),
		}))
		.sort((a, b) => order[a.state] - order[b.state])
		.slice(0, CONTEXT_MAX);
}

/**
 * The context a request can carry with these answers: within CONTENT_MAX characters in all, leaving out set-aside cards
 * first and then the visitor's own, from the last. Open cards are always shown: a reply may withdraw an open card it
 * was not shown (its request was sent after the card became open), so leaving one out would risk losing it.
 */
export function fitContext<L extends string>(
	cards: readonly ContextCard<L>[],
	answersLength: number,
): ContextCard<L>[] {
	const fitted = [...cards];

	let size =
		answersLength + fitted.reduce((sum, card) => sum + card.text.length, 0);

	for (const state of ["avoid", "yours"] as const)
		for (let at = fitted.length - 1; size > CONTENT_MAX && at >= 0; at--)
			if (fitted[at].state === state) {
				size -= fitted[at].text.length;
				fitted.splice(at, 1);
			}

	return fitted;
}

/** A request to interpret the brief: the path, its written answers and the board as context (read on the server by src/server/brief-board-input.ts). */
export type BoardRequest = {
	readonly path: SoftwarePath;
	readonly answers: Readonly<Record<string, string>>;
	readonly cards: readonly ContextCard[];
};

/** The written answers of a request joined, as a passage is checked against them. */
export const answerText = (
	answers: Readonly<Record<string, string>>,
	path: SoftwarePath,
) =>
	boardAnswerKeys[path]
		.map((key) => (Object.hasOwn(answers, key) ? answers[key] : ""))
		.filter(Boolean)
		.join("\n\n");

// ---- What is sent with the brief -----------------------------------------------------------------------------------

/** answers: read from the visitor's answers. kept: a suggestion they kept. edited: one they reworded. wrote: their note. */
export type OutlineOrigin = "answers" | "kept" | "edited" | "wrote";

export type OutlineItem = {
	readonly lane: Lane;
	readonly text: string;
	readonly origin: OutlineOrigin;
	readonly quote?: string;
	readonly answer?: string;
};

/**
 * The outline sent with the brief, in lane order: every card read from the answers whose passage is still in them,
 * and every card the visitor kept, edited, answered or wrote. Suggestions the visitor did not keep and set-aside cards
 * are not sent. A kept card whose passage has gone from the answers is sent as kept, without the passage.
 */
export function briefOutline(board: Board, answers: string): OutlineItem[] {
	const items: OutlineItem[] = [];

	for (const lane of LANES) {
		const inLane: { item: OutlineItem; owned: boolean }[] = [];

		for (const card of board.cards) {
			if (card.lane !== lane || card.status === "dismissed") continue;

			const grounded = card.basis === "said" && standsOn(card, answers);

			if (card.status === "proposed" && !grounded) continue;

			const origin: OutlineOrigin =
				card.status === "wrote"
					? "wrote"
					: card.status === "edited"
						? "edited"
						: grounded
							? "answers"
							: "kept";

			const item: Mutable<OutlineItem> = { lane, text: card.text, origin };

			if (origin === "answers") item.quote = card.quote;

			if (card.answer) item.answer = card.answer;
			inLane.push({ item, owned: isOwned(card) });
		}

		// Undo can bring a lane past its limit for a moment (a note back where a reply has just added a card). The outline
		// keeps to the limit the server holds it to, leaving out the cards read from the answers before the visitor's own.
		let over = inLane.length - laneLimits[lane];

		for (let at = inLane.length - 1; over > 0 && at >= 0; at--)
			if (!inLane[at].owned) {
				inLane.splice(at, 1);
				over--;
			}

		items.push(...inLane.slice(0, laneLimits[lane]).map((entry) => entry.item));
	}

	return items;
}

const outlineItemFields = {
	lane: oneOf(LANES),
	text: text(textLimits.purpose),
	origin: oneOf(["answers", "kept", "edited", "wrote"]),
	quote: text(QUOTE_MAX),
	answer: text(ANSWER_MAX),
};

/** An outline's items, each read with its schema; null when it is not a list of at most OUTLINE_MAX well-formed items. */
function readOutlineItems(raw: RawValue): OutlineItem[] | null {
	const items = listOf(raw, OUTLINE_MAX);

	if (!items) return null;
	const read: OutlineItem[] = [];

	for (const item of items) {
		const one = readFields(outlineItemFields, item, {
			defaults: { quote: "", answer: "" },
		});

		if (!one.ok) return null;
		const { lane, text: words, origin, quote, answer } = one.value;
		const outline: Mutable<OutlineItem> = { lane, text: words, origin };

		// A passage or an answer is there only when it was sent, even an empty one, so readBriefOutline can refuse it.
		if (has(item, "quote")) outline.quote = quote;

		if (has(item, "answer")) outline.answer = answer;
		read.push(outline);
	}

	return read;
}

/** The sentence a visitor sees when the outline sent does not match the brief. */
export const OUTLINE_CHANGED =
	"Your brief outline no longer matches your answers. Go back to your first answer, check the outline and send again.";

/**
 * The outline sent with a brief, read on the server: undefined when none was sent; the items when each is within its
 * lane's limits, plain one-line text, no commitment or link, an answer only on a question, and a passage for (and only
 * for) an item read from the answers that is in the submitted `answers`; otherwise a refusal with OUTLINE_CHANGED.
 */
/** What reading a sent outline answers: the items (undefined when there are none), or the sentence refusing it. */
export type OutlineRead =
	| { readonly ok: true; readonly value: OutlineItem[] | undefined }
	| { readonly ok: false; readonly error: string };

export function readBriefOutline(raw: RawValue, answers: string): OutlineRead {
	if (raw === undefined) return { ok: true, value: undefined };
	const read = readOutlineItems(raw);

	if (!read) return { ok: false, error: OUTLINE_CHANGED };

	const counts: Record<Lane, number> = {
		purpose: 0,
		audience: 0,
		parts: 0,
		questions: 0,
	};

	for (const item of read) {
		counts[item.lane]++;
		const quote = item.quote ?? "";

		if (
			counts[item.lane] > laneLimits[item.lane] ||
			item.text !== oneLine(item.text) ||
			!item.text ||
			item.text.length > textLimits[item.lane] ||
			(item.origin !== "wrote" &&
				item.origin !== "edited" &&
				commits(item.text)) ||
			(item.answer !== undefined &&
				(item.lane !== "questions" ||
					item.answer !== oneLine(item.answer) ||
					!item.answer)) ||
			(item.origin === "answers") !== (item.quote !== undefined) ||
			(item.origin === "answers" &&
				(quote !== oneLine(quote) || !quotedFrom(quote, answers)))
		)
			return { ok: false, error: OUTLINE_CHANGED };
	}

	return {
		ok: true,
		value: read.length ? read : undefined,
	};
}

/** How each origin reads to the visitor and the owner. */
export const originLabels: Record<OutlineOrigin, string> = {
	answers: "From your answers",
	kept: "You kept this",
	edited: "Edited by you",
	wrote: "Your note",
};

/** How each origin reads in the stored brief, which the owner and the visitor both read (the owner page and the copy). */
export const outlineOriginWords: Record<OutlineOrigin, string> = {
	answers: "from the answers",
	kept: "AI suggestion, kept",
	edited: "AI suggestion, edited",
	wrote: "own note",
};

/** The outline a brief's body carries, unread; undefined when it has none. */
export function sentOutline(body: RawValue): RawValue | undefined {
	return ownField(body, "outline");
}

/** An outline as stored with a brief, read for display (it was checked against the answers when it was sent). */
export function storedOutline(raw: RawValue): OutlineItem[] {
	const read = readOutlineItems(raw);

	return read ?? [];
}

/** The outline as JSON to store with a brief: each item's fields, an absent passage or answer left out. */
export const outlineJson = (items: readonly OutlineItem[]) =>
	items.map((item) =>
		Object.fromEntries(
			Object.entries(item).filter((entry): entry is [string, string] =>
				Predicate.isString(entry[1]),
			),
		),
	);

/** The outline as text, one item a line with its lane, its origin and any passage or answer, for the brief's readers. */
export const outlineText = (
	items: readonly OutlineItem[],
	path: SoftwarePath,
) =>
	items
		.map((item) => {
			const quote = item.quote ? ` (“${item.quote}”)` : "";
			const answer = item.answer ? `\nAnswer: ${item.answer}` : "";

			return `${laneLabels[path][item.lane]}: ${item.text} · ${outlineOriginWords[item.origin]}${quote}${answer}`;
		})
		.join("\n");

// ---- The saved boards ---------------------------------------------------------------------------------------------

/** The localStorage key the boards are saved under, beside the brief's draft (`software-brief-draft`). */
export const BOARD_STORAGE_KEY = "software-brief-board";

const savedCardFields = {
	id: stringField(
		unreadable,
		Schema.isPattern(/^c\d{1,6}$/, { message: "Not a card id." }),
	),
	lane: oneOf(LANES),
	text: text(textLimits.purpose),
	status: oneOf(["proposed", "kept", "edited", "dismissed", "wrote"]),
	basis: oneOf(["said", "suggested", "none"]),
	quote: text(QUOTE_MAX),
	reason: text(REASON_MAX),
	answer: text(ANSWER_MAX),
};

export type SavedBoards = {
	readonly boards: Partial<Record<SoftwarePath, Board>>;
	readonly paused: boolean;
	readonly plain: boolean;
};

/** The most set-aside cards a saved board keeps (the newest); older ones may be offered again after a reload. */
export const ASIDE_SAVED_MAX = 200;

/** The most cards a saved board can hold: every lane full, and the set-aside cards. More is not a board this page saved. */
const SAVED_MAX = OUTLINE_MAX + ASIDE_SAVED_MAX;

/** The cards a board saves: all but the oldest set-aside cards past ASIDE_SAVED_MAX. */
function savedCards(board: Board) {
	let aside = board.cards.filter((card) => card.status === "dismissed").length;

	return board.cards.filter(
		(card) => card.status !== "dismissed" || aside-- <= ASIDE_SAVED_MAX,
	);
}

/** What a page saves: each path's cards, and whether the board is paused or set aside for the plain form. */
export const savedBoards = (saved: SavedBoards) => ({
	boards: Object.fromEntries(
		Object.entries(saved.boards).map(([path, board]) => [
			path,
			{ cards: savedCards(board).map(({ since: _since, ...card }) => card) },
		]),
	),
	paused: saved.paused,
	plain: saved.plain,
});

/**
 * The boards read back from storage, which anything may have written: each path's cards that are well formed (a lane's
 * cards over its limit, repeated ids and anything else left out), with no request in flight and nothing to undo.
 */
export function readSavedBoards(raw: RawValue): SavedBoards {
	const boards: Partial<Record<SoftwarePath, Board>> = {};

	for (const path of ["website", "webapp", "workflow"] as const) {
		const items = listOf(
			ownField(ownField(ownField(raw, "boards"), path), "cards"),
			SAVED_MAX,
		);

		if (!items) continue;
		const cards: BoardCard[] = [];

		for (const item of items) {
			const card = readFields(savedCardFields, item);

			if (!card.ok) continue;
			const value = card.value;
			const words = oneLine(value.text);

			if (
				!words ||
				words.length > textLimits[value.lane] ||
				cards.some((c) => c.id === value.id) ||
				(value.status === "dismissed" &&
					cards.filter((c) => c.status === "dismissed").length >=
						ASIDE_SAVED_MAX) ||
				(value.status !== "dismissed" &&
					cards.filter((c) => c.lane === value.lane && c.status !== "dismissed")
						.length >= laneLimits[value.lane])
			)
				continue;

			cards.push({
				...value,
				text: words,
				quote: oneLine(value.quote),
				reason: oneLine(value.reason),
				answer: value.lane === "questions" ? oneLine(value.answer) : "",
				since: 0,
				edited: ownField(item, "edited") === true,
			});
		}

		const highest = Math.max(
			0,
			...cards.map((card) => Number(card.id.slice(1))),
		);

		boards[path] = { ...emptyBoard(), cards, nextId: highest + 1 };
	}

	return {
		boards,
		paused: ownField(raw, "paused") === true,
		plain: ownField(raw, "plain") === true,
	};
}
