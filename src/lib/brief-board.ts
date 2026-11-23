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

/** The data-steps of the lane screens in the brief's form (src/components/BriefBoard.astro), in lane order. */
export const LANE_STEPS = [9, 10, 11, 12] as const;

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

/**
 * Each lane's screen heading in the outline steps, by path: the lane's question. The outline does not speak as the owner,
 * so none says "I".
 */
export const laneQuestions: Record<SoftwarePath, Record<Lane, string>> = {
	website: {
		purpose: "Is this what it’s for?",
		audience: "Who is it for?",
		parts: "Which pages does it need?",
		questions: "What’s still undecided?",
	},
	webapp: {
		purpose: "Is this what it’s for?",
		audience: "Who will use it?",
		parts: "What should people be able to do?",
		questions: "What’s still undecided?",
	},
	workflow: {
		purpose: "Is this what should change?",
		audience: "Who does the work?",
		parts: "What are the steps today?",
		questions: "What’s still undecided?",
	},
};

/** The hint under a lane's heading when it lists cards, and when it lists none. */
export const LANE_HINT = "From your answers. Keep, change or add your own.";

export const LANE_HINT_EMPTY = "Add your own, or go on.";

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

/**
 * The reply held for the lane on screen (verification/brief-board.qnt `deferred`): the whole reply, of which only its
 * additions have been applied. Its changes and withdrawals apply, under the rules of any reply, when the lane is left
 * (`leaveLane`). Only the newest is held. Kept in memory only: a saved board drops it.
 */
export type HeldReply<L extends string = Lane> = {
	readonly lane: L;
	readonly n: number;
	readonly reply: readonly ReplyCard<L>[];
	readonly refs: readonly string[];
	/** The items of `reply` the delivery added to the lane while it was on screen: leaving does not add them again. */
	readonly added: readonly ReplyCard<L>[];
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
	/** The reply held for the lane on screen, if any. Never saved. */
	readonly deferred?: HeldReply<L>;
	/**
	 * The ids of the cards each lane listed (set-aside ones not counted) when the visitor last left it. A lane not in it
	 * has not been visited. Saved with the board.
	 */
	readonly seen: Partial<Record<L, readonly string[]>>;
};

export const emptyBoard = <L extends string = Lane>(): Board<L> => ({
	cards: [],
	nextId: 1,
	sent: 0,
	applied: 0,
	history: [],
	seen: {},
});

export const isOwned = (card: Pick<BoardCard, "status">) =>
	card.status !== "proposed";

/** The cards that count toward a lane's limit: everything but set-aside cards. */
export const laneCount = <L extends string>(board: Board<L>, lane: L) =>
	board.cards.filter(
		(card) => card.lane === lane && card.status !== "dismissed",
	).length;

// ---- Text ---------------------------------------------------------------------------------------------------------

/** Control characters, line and paragraph separators, and lone surrogates (which the brief's own fields refuse too). */
const CONTROLS = new RegExp(
	"[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\p{Cs}]",
	"gu",
);

/** One line of plain text: control characters and lone surrogates removed, spaces collapsed, trimmed. */
export const oneLine = (text: string) =>
	text.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();

/** One line of at most `limit` characters; a cut through an emoji leaves no half of it behind. */
export const clipped = (text: string, limit: number) =>
	oneLine(oneLine(text).slice(0, limit));

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

// The money forms, as named parts. PRICE_PARTS keeps the living brief's order, so MONEY's source stays as it was; the
// offer board's PRICE below reuses some of them and adds its own.
/** A currency's symbol before the amount ("$5,000", "€300", "$5k"). */
const SYMBOL_BEFORE =
	"[$€£¥₹₩]\\s?\\d[\\d,.]*(?:\\s?(?:k|m|million|thousand)\\b)?";

/** An amount, then a currency's code or word ("5,000 USD", "300 euros"). */
const CODE_OR_WORD_AFTER =
	"\\d[\\d,.]*\\s?(?:usd|eur|gbp|cad|aud|dollars?|euros?|pounds?|bucks)\\b";

// The currency's code before the amount ("USD 5,000", "EUR 300"), but not "CAD 3D" or "CAD 2D". Known limits: codes
// that are also abbreviations or words ("INR 2.5" readings, "CHF 4", Norwegian "nok 3") are refused.
const CODE_BEFORE =
	"\\b(?:usd|eur|gbp|cad|aud|nzd|chf|jpy|cny|inr|krw|mxn|brl|sek|nok|dkk)\\s?(?![\\d,.]*d\\b)\\d";

/** Chinese and Japanese amounts ("5000元", "3万円"). */
const CJK_AMOUNT =
	"\\d[\\d,.]*\\s?(?:千|万|萬|亿|億)?\\s?(?:円|元|圓|块钱|塊錢)";

// Korean won, with the amount's own units and spacing ("10만 원", "5천만원"), but not "3원칙" (three principles).
const WON_AMOUNT =
	"\\d[\\d,.]*\\s?(?:천만|천|만|억)?\\s?원(?=$|[^가-힣]|에|을|이|은|의|도|만|으로|짜리|정도|쯤|대|선|까지|부터|이하|이상|미만|씩)";

/** A Chinese, Japanese or Korean money word with an amount ("预算: 5000"). */
const CJK_MONEY_WORD =
	"(?:预算|預算|予算|費用|费用|价格|價格|価格|예산|비용)\\s*[:：]?\\s*\\d";

/** The living brief's money word with any number ("estimated 6 weeks" included: the brief refuses durations anyway). */
const BRIEF_MONEY_WORD_AMOUNT =
	"\\b(?:budget(?:ed)?|estimate[ds]?|quote[ds]?|prices?|priced|fees?|costs?)\\s*(?:of|is|at|around|about|under|over|roughly|:)?\\s*\\d[\\d,.]*";

const PRICE_PARTS = [
	SYMBOL_BEFORE,
	CODE_OR_WORD_AFTER,
	CODE_BEFORE,
	CJK_AMOUNT,
	WON_AMOUNT,
	CJK_MONEY_WORD,
	BRIEF_MONEY_WORD_AMOUNT,
];

/**
 * Money, or an amount a brief reads as money: "about 5k", or a bare large amount after "under", "up to" and the like
 * ("up to 5,000"). The same alternatives in the same order as before the offer board split PRICE out.
 */
const MONEY = new RegExp(
	[
		...PRICE_PARTS.slice(0, -1),
		`\\b(?:${MONEY_WORDS})\\s*(?:of|is|at|around|about|:)?\\s*\\d[\\d,.]*\\s?k\\b`,
		BRIEF_MONEY_WORD_AMOUNT,
		"\\b(?:under|over|below|above|up to|less than|more than)\\s+\\d{1,3}(?:,\\d{3})+\\b",
	].join("|"),
	"iu",
);

// ---- The offer board's money test --------------------------------------------------------------------------------
// An offer's cards may count things and give durations ("Import up to 2,000 products", "Estimated 6 weeks"), so the
// offer board reads a number after a money word by what follows it. A large amount (three digits or more, a thousands
// separator, "k", or a scale word such as "thousand", "mil" or "Tausend") is money unless a unit or a counted thing
// follows ("Fee 3,000 plus VAT" and "Budget around 5 thousand" are money; "Estimated 1,500 pages" is not). A small one is
// money only when what follows reads as paying ("a fee of 50", "costs 25/month"). An amount with its currency after it
// is money with or without a scale word between them ("5 mil dólares", "2 thousand dollars"), and so is a sum spelled in
// English words before a currency word ("five thousand dollars", "fifteen hundred dollars", "two hundred thousand
// dollars"). A range after a money word may end in a scale word ("Budget of 5 to 10 thousand"), and "and" joins a range
// only after "between" ("Budget between 2,000 and 4,000", but "a budget of 5,000 and 8 weeks" is money and a duration).
// Common verbs may stand between a money word and its amount ("Fees are 1,500", "The fee will be about 4,500", "Die
// Kosten betragen 5.000"), except after "invoices", "payments", "deposits" and "charges", which also name things an
// offer counts ("Invoices are about 40 a month"). In English a large amount may come first, after "a", "the" or the
// like, before "budget", "fee", "deposit" or "retainer", perhaps with one word between ("A 4,500 fee", "the 2,500
// launch fee", "a 4,500 one-time fee"), but not a year ("the 2026 budget") nor before a counted noun ("the 2,000 fee
// records"). "Total" and "rate" also count things ("Milestones total 3", "a rate of 1 per week"), so after them a large
// amount is money, and a small one only with cents, a currency, a period after a slash, "flat" or "upfront", or with
// two digits and "per", "a" or "each" after it ("a rate of 25 per page"); after "rate", two digits that end a sentence
// are money too ("billed at a rate of 95."). A rate named by its period ("day rate", "monthly rate") is a money word of
// its own.
// Known limits, on purpose: a small amount followed by an ordinary word passes ("a fee of 50 for setup"), and so do a
// one-digit amount after "total" or "rate" ("a rate of 5 per hour"), two digits that end a sentence after "total" ("in
// total: 12."), and an amount after a verb that follows a plural money word ("Payments are 2,500 a month"); a large number
// followed by a word that is not a listed unit is dropped ("Estimated 2026 launch"), and so is a number before a short
// scale word that is also an English word ("Quote 4 mil poly bags", "Price 2 bin sizes"); money words are listed for English,
// Spanish, Portuguese, French, German, Italian, Russian, Polish and Turkish only, so another language's money word
// passes unless a currency is written; a currency code that is also a word ("TRY") is not listed; a sum spelled in
// words in another language passes ("cinco mil dólares").

/** A money word, in the languages listed above, standing as a word of its own. */
const OFFER_MONEY_WORD =
	"(?<![\\p{L}\\p{N}])(?:(?:hourly|daily|day|weekly|monthly|yearly|annual|flat)\\s+rates?|budget(?:ed)?|estimate[ds]?|quote[ds]?|prices?|priced|fees?|costs?|deposit|payment|pay|charge|invoice|retainers?|presupuesto|precio|coste|costo|tarifa|honorarios|or[çc]amento|pre[çc]o|custo|kosten|preis|honorar|prix|co[uû]t|tarif|prezzo|preventivo|compenso|цена|стоимость|бюджет|koszt|cena|budżet|fiyat|bütçe|ücret)(?!\\p{L})";

/** Money words that also count things ("Milestones total 3", "a rate of 1 per week"): see the rules above. */
const OFFER_COUNTING_MONEY_WORD =
	"(?<![\\p{L}\\p{N}])(?:total|rates?)(?!\\p{L})";

/** Plural money words that also name things an offer counts ("Invoices are about 40 a month"): no verb is read after them. */
const OFFER_COUNTED_MONEY_WORD =
	"(?<![\\p{L}\\p{N}])(?:deposits|payments|charges|invoices)(?!\\p{L})";

/** Words that may stand between a money word and its amount ("of", "about", "von ca."). */
const CONNECTOR_WORDS =
	"of|is|at|around|about|under|over|roughly|approximately|between|from|aproximadamente|environ|etwa|circa|de|von|di|du|ca\\.?|около|około|yaklaşık";

/** Verbs that may stand there too, except after the plural money words above ("are", "will be", "es de", "liegt bei"). */
const CONNECTOR_VERBS =
	"are|was|were|will|would|be|comes?|came|to|totals?|totall?ing|ranges?|runs?|es|est|sont|sera|serait|será|sería|é|è|sarà|sarebbe|ist|sind|wird|beträgt|betragen|liegt|liegen|bei|wynosi|составляет|составит";

/** A colon, then up to `most` of the words, each perhaps followed by a colon ("is about", ": roughly", "will be about"). */
const connector = (words: string, most: number) =>
	`\\s*(?:[:：]\\s*)?(?:(?:${words})\\s*[:：]?\\s*){0,${most}}`;

const OFFER_CONNECTOR = connector(`${CONNECTOR_VERBS}|${CONNECTOR_WORDS}`, 3);
const OFFER_PLAIN_CONNECTOR = connector(CONNECTOR_WORDS, 2);

/** A scale word after a number, in the languages listed above ("thousand", "mil", "millones", "Tausend", "тыс.", "bin"). */
const SCALE =
	"(?:thousands?|millions?|billions?|milliards?|mil|mill[oó]n(?:es)?|milh(?:ão|ões|ao|oes)|mille|mila|milion[ei]?|milioni|tausend|millionen|mio(?:\\.|(?!\\.))|mrd(?:\\.|(?!\\.))|тысяч\\p{L}*|тыс(?:\\.|(?!\\.))|миллион\\p{L}*|млн(?:\\.|(?!\\.))|tys(?:\\.|(?!\\.))|tysięcy|tysiące|milion(?:ów|y)?|bin|milyon)";

/**
 * A large amount: a thousands separator, three digits or more, or a scale ("1,500", "1.500,00", "3 000", "120", "5k",
 * "5 thousand").
 */
const LARGE_AMOUNT = `(?:\\d{1,3}(?:[,.\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d{3,}(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?\\s?(?:k|m|${SCALE})(?![\\p{L}\\p{N}]))(?!\\d|[.,]\\d|(?<=(?<![\\d,.])\\d{1,3}(?:\\s\\d{3})*)\\s\\d{3}(?!\\d))`;

/** A small amount: one or two digits, perhaps with cents ("6", "25", "4.5"). */
const SMALL_AMOUNT = "\\d{1,2}(?:[.,]\\d{1,2})?(?!\\d|[.,]\\d)";

/** "And" joining a range, only after "between" ("between 2,000 and 4,000"). */
const BETWEEN_AND = `(?<=(?<![\\p{L}])between\\s*[:：]?\\s*(?:(?:about|around|roughly|approximately|circa|ca\\.?|some)\\s*)?\\d[\\d,.]*(?:\\s\\d{3})*(?:\\s?(?:k|m|${SCALE}))?\\s*)and`;

/** A range after an amount ("to 6", "- 8", "– 1,200", "between 2,000 and 4,000"). */
const OFFER_RANGE = `(?:\\s*(?:to|-|–|a|à|bis|${BETWEEN_AND})\\s*\\d[\\d,.]*(?:\\s?(?:k|${SCALE})(?![\\p{L}]))?)?`;

/** Units of time, and things an offer counts, in the languages listed above. */
const OFFER_UNITS =
	"(?:transactions?|suppliers?|vendors?|invoices?|payments?|receipts?|bookings?|appointments?|leads?|contacts?|deals?|listings?|events?|hours?|hrs?|days?|weeks?|wks?|months?|years?|sprints?|rounds?|revisions?|iterations?|pages?|screens?|views?|products?|items?|skus?|users?|members?|accounts?|records?|rows?|entries|orders?|customers?|clients?|subscribers?|visitors?|emails?|messages?|files?|photos?|images?|videos?|posts?|articles?|templates?|forms?|fields?|steps?|milestones?|features?|integrations?|languages?|locations?|stores?|sites?|apps?|carriers?|reports?|dashboards?|seats?|licen[cs]es?|people|staff|employees?|requests?|calls?|tickets?|días|dias|semanas|meses|horas|páginas|paginas|productos|produtos|usuarios|usuários|tage|wochen|monate|stunden|seiten|produkte|jours|semaines|mois|heures|giorni|settimane|mesi|ore|pagine|prodotti|дней|недел[ьи]|месяц[аев]*|часов|страниц|dni|tygodni|miesięcy|godzin|stron|gün|hafta|ay|saat|sayfa)(?!\\p{L})";

/** What may follow a large amount when it counts things rather than money: a range, perhaps one word, then a unit. */
const COUNTED_AFTER = `\\+?${OFFER_RANGE}\\s*(?:(?!(?:per|a|an|each|every|for|plus|or|and|including|on|in|with|to|of|the|this|next|last|first|across|over|during|throughout)(?!\\p{L}))\\p{L}+\\s+)?${OFFER_UNITS}`;

/** What follows a small amount when it is money: the end, a full stop, a period of time after a slash, or a paying word. */
const PAID_AFTER = `${OFFER_RANGE}\\s*(?:$|[.;)\\]](?=\\s|$)|\\/\\s?(?:mo|month|yr|year|wk|week|day|hr|hour)\\b|(?:dollars?|euros?|pounds?|bucks|per|a(?!\\s*\\d)|an|each|flat|upfront|up front|total|plus)\\b)`;

/** What follows a small amount after "total" or "rate" when it is money: a currency, a period after a slash, "flat". */
const COUNTING_PAID_AFTER = `${OFFER_RANGE}\\s*(?:\\/\\s?(?:mo|month|yr|year|wk|week|day|hr|hour)\\b|(?:dollars?|euros?|pounds?|bucks|flat|upfront|up front)\\b)`;

/** A money word with an amount that is money by the rules above. */
const OFFER_MONEY_WORD_AMOUNT = `${OFFER_MONEY_WORD}${OFFER_CONNECTOR}(?:${LARGE_AMOUNT}(?!${COUNTED_AFTER})|${SMALL_AMOUNT}(?=${PAID_AFTER}))`;

/** The plural money words with an amount, read without verbs. */
const OFFER_COUNTED_WORD_AMOUNT = `${OFFER_COUNTED_MONEY_WORD}${OFFER_PLAIN_CONNECTOR}(?:${LARGE_AMOUNT}(?!${COUNTED_AFTER})|${SMALL_AMOUNT}(?=${PAID_AFTER}))`;

/** An amount with cents ("95.00", "7,50"). */
const CENTS = "\\d{1,2}[.,]\\d{2}(?!\\d|[.,]\\d)";

/** Two digits, or an amount with cents, then "per", "a" or "each" ("25 per page", "7.50 an hour"), but not "per cent". */
const PER_SOMETHING = `(?:\\d{2}|\\d{1,2}[.,]\\d{1,2})(?!\\d|[.,]\\d)(?=${OFFER_RANGE}\\s*(?:per|a|an|each)\\s+(?!cent(?!\\p{L}))\\p{L})`;

/** "Total" or "rate" with an amount that is money by the rules above. */
const OFFER_COUNTING_WORD_AMOUNT = `${OFFER_COUNTING_MONEY_WORD}${OFFER_CONNECTOR}(?:${LARGE_AMOUNT}(?!${COUNTED_AFTER})|${SMALL_AMOUNT}(?=${COUNTING_PAID_AFTER})|${CENTS}|${PER_SOMETHING})`;

/** "Rate" with two digits that end a sentence ("billed at a rate of 95."). */
const RATE_AT_END = `(?<![\\p{L}\\p{N}])rates?(?!\\p{L})${OFFER_CONNECTOR}\\d{2}(?!\\d|[.,]\\d)(?=\\s*(?:$|[.;)\\]](?=\\s|$)))`;

/** Nouns a money word may describe when it counts things ("fee records", "deposit transactions"). */
const COUNTED_NOUN =
	"(?:records?|transactions?|entries|lines?|items?|codes?|data|types?|history|schedules?|reports?|tables?|fields?|categories|accounts?|ledgers?)";

/**
 * A large amount before a money word, after "a", "the" or the like ("A 4,500 fee", "the 2,500 launch fee"), but not a
 * year ("the 2026 budget") nor before a counted noun ("the 2,000 fee records").
 */
const AMOUNT_THEN_MONEY_WORD = `(?<![\\p{L}\\p{N}])(?:a|an|the|this|that|our|your|their|its|one)\\s+(?!(?:19|20)\\d{2}(?![\\d,.]))${LARGE_AMOUNT}(?:[\\s-]+\\p{L}+(?:-\\p{L}+)*)?[\\s-]+(?:budget|fee|deposit|retainer)(?!\\p{L})(?!\\s+${COUNTED_NOUN}(?!\\p{L}))`;

/** Currency symbols the living brief does not list, before the amount ("₽5 000", "₺50.000", "₪20,000"). */
const OTHER_SYMBOL_BEFORE = "[₽₺₪₱₫]\\s?\\d";

/** Codes the living brief does not list, before the amount ("PLN 2 000"). */
const OTHER_CODE_BEFORE = "\\b(?:pln|czk|huf|rub|zar|sgd|hkd)\\s?\\d";

/**
 * Money written after the amount, as many languages write it and the model writes in the brief's language: "20 €",
 * "1.500 €", "5.000 R$", "15 CHF", "5k USD", "50 000 kr", "3.000 dólares", "20 000 zł", and "Rs. 50,000" with its dot
 * (without it, "RS 232" is a port). "CAD" and "AUD" after a small number followed by a word are formats, not money
 * ("3 CAD file types").
 */
const AMOUNT_THEN_CURRENCY = [
	`\\d[\\d,.]*(?:\\s\\d{3})*(?:[,.][-–])?\\s?(?:k|m|${SCALE}(?:\\s+de|\\s+d['’])?)?\\s?(?:r\\$|[$€£¥₹₩₽₺₪₱₫])`,
	`\\d[\\d,.]*(?:\\s\\d{3})*(?:[,.][-–])?\\s?(?:k|m|${SCALE}(?:\\s+de|\\s+d['’])?)?[\\s-]?(?:usd|eur|gbp|chf|nzd|jpy|cny|inr|krw|mxn|brl|sek|nok|dkk|kr|pln|czk|huf|rub|zar|sgd|hkd|tl|zł|kč|руб\\p{L}*|евро|доллар\\p{L}*|dollars?|euros?|pounds?|bucks|dólares|dolares|reais|pesos|rublos|złotych|zlotych|rupees?|yen|yuan|francs?|kronor|kroner)(?![\\p{L}])`,
	`${LARGE_AMOUNT}\\s?(?:cad|aud)(?!\\p{L})`,
	"(?<![\\p{L}])(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a few|few|several|a couple of|couple of)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?\\s+(?:hundred|thousand|million)(?:\\s+(?:thousand|million))?\\s+(?:dollars?|euros?|pounds?|bucks|usd|eur|gbp)(?![\\p{L}])",
	"\\d{1,2}\\s?(?:cad|aud)(?!\\p{L})(?!\\s+\\p{L})",
	"\\brs\\.\\s?\\d",
];

/**
 * An amount of money only, for the offer board: a currency before or after the amount, or a money word with an amount
 * that reads as money. MONEY above keeps its own alternatives for the living brief.
 */
const PRICE = new RegExp(
	[
		SYMBOL_BEFORE,
		OTHER_SYMBOL_BEFORE,
		CODE_BEFORE,
		OTHER_CODE_BEFORE,
		CJK_AMOUNT,
		WON_AMOUNT,
		CJK_MONEY_WORD,
		OFFER_MONEY_WORD_AMOUNT,
		OFFER_COUNTED_WORD_AMOUNT,
		OFFER_COUNTING_WORD_AMOUNT,
		RATE_AT_END,
		AMOUNT_THEN_MONEY_WORD,
		...AMOUNT_THEN_CURRENCY,
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
		// Not "創業10周年" (an anniversary) or "Step 1 주문" (an order): 周 and 주 stand alone or before a particle.
		"\\d+\\s*(?:週間|か月|ヶ月|カ月|ヵ月|ケ月|日間|天|個月|个月|星期|개월|일간|시간)",
		// Not "1時間目" (a class period), but "3時間目安" (about three hours) is a duration.
		"\\d+\\s*時間(?!目(?!安))",
		"\\d+\\s*周(?!年)",
		// Not an ordinal ("1일차", "3주차", "1주 차에", "3년 차입니다", "1년 차일 때") or parking ("주차장"). Unspaced, 차
		// fails the lookahead at the end; spaced, 차 is an ordinal only alone or before a particle or ending (a one-syllable
		// ending only at the end of the word, so "차일피일" is not one), and "2주 차이" (a difference) still counts. The
		// ordinal check comes before 간: "2주간 차를" is a duration. A four-digit year outside 19xx and 20xx ("1876년부터")
		// is history, not a duration; 19xx and 20xx count here too, since "FY2027년" has no word boundary for the date rules.
		"(?<!\\d)(?!(?!19|20)\\d{4}\\s?년)\\d+\\s?(?:주일|주|일|년)(?!\\s차(?:$|[^가-힣]|에|의|인|부터|까지|로|를|가|는|도|째|이상|이하|와|만|마다|보다|처럼|랑|하고|엔|쯤|께|입니|예요|였|라서|라도|지만|면|여서|여야|라면|라고|라는|니까|며|든|죠|밖에|(?:일|나|요|고|다)(?![가-힣])))(?:간)?(?=$|[^가-힣]|안|내|이내|동안|만에|만|후|정도|쯤|가|의|째|이|을|는|도)",
		// More endings, only with the unit written straight after the number ("2주면", "2주를", "2주짜리"), so "React 18
		// 주로 사용" (mainly) is not one, nor "1 년은" with a space. Known limits of this net: shares written with 주
		// ("10주를 매수") are refused;
		// months written with 달, minutes, and a date followed by 에 ("3월 1일에") pass; "10년 차이며" is refused.
		"(?<!\\d)(?!(?!19|20)\\d{4}년)\\d+(?:주일|주|일|년)(?:간)?(?=면|를|은|로|으로|짜리|밖에|뿐|씩|나|미만|까지|부터|에\\s?걸쳐)",
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
 * Whether text names an amount of money or a link: the offer board's filter, where durations, promises and quantities
 * ("a few hundred products", "up to 2,000 subscribers") belong to the offer the owner writes, but money belongs to the
 * pricing panel and links to nobody. Words about cost without an amount ("low-cost hosting") are not money.
 */
export const pricesOrLinks = (text: string) =>
	[PRICE, LINK].some((pattern) => pattern.test(plainText(text)));

/** Whether text names a link or an address (a domain, a path, an email): for text that may name money but not a link. */
export const hasLink = (text: string) => LINK.test(plainText(text));

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

/** Whether a reply card says the idea of a note the visitor removed from that lane. */
const removedIdea = <L extends string>(board: Board<L>, item: ReplyCard<L>) =>
	(board.removed ?? []).some(
		(note) => note.lane === item.lane && sameIdea(note.text, item.text),
	);

/** Whether reply number `n` may change `card`: only an unowned card that was unowned when request `n` was sent. */
const mayChange = (card: Pick<BoardCard, "status" | "since">, n: number) =>
	card.status === "proposed" && n > card.since;

export type Applied<L extends string = Lane> = {
	readonly board: Board<L>;
	readonly added: number;
	readonly updated: number;
	readonly withdrawn: number;
};

/** What one pass over a reply may do (see applyReply and leaveLane). */
type Scope<L extends string> = {
	/** Whether the reply's new cards are added. */
	readonly add: boolean;
	/** A lane whose listed cards the pass leaves alone: the lane on screen. */
	readonly skip: L | null;
	/** The only lane whose cards the pass may change or withdraw (null: any). */
	readonly only: L | null;
};

/**
 * One pass of reply number `n` over the board as it is now: the shared body of `applyReply` and `leaveLane`. Each reply
 * card that names an unowned card (by its id, or by saying the same idea) updates it, if the reply's request was sent
 * after the card last became unowned; one that names an owned card, or a set-aside idea, is left out. An unowned card the
 * reply leaves out is withdrawn, again only if the request was sent after it last became unowned; a card the reply names
 * in `refs` (or by a card left out below) is not left out. Then, when the scope adds, each new idea is added at the end
 * of its lane, within the lane's limit as it is after the withdrawals. A card read from the answers is checked against
 * the answers as they are now (`answers`), not as they were sent. The scope keeps the pass off the cards of one lane, or
 * on those of one lane only.
 */
function reconcile<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	reply: readonly ReplyCard<L>[],
	n: number,
	answers: string,
	refs: readonly string[],
	scope: Scope<L>,
): Applied<L> & { readonly addedItems: readonly ReplyCard<L>[] } {
	const cards = [...board.cards];

	// Whether the pass may change or withdraw a card of this lane.
	const touches = (lane: L) =>
		lane !== scope.skip && (scope.only === null || lane === scope.only);

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
		// The card the item names by its ref, in any lane.
		const refIndex =
			item.ref === "" ? -1 : cards.findIndex((card) => card.id === item.ref);

		// Cards never move between lanes: a reply card that names a card in another lane, or whose version is dropped
		// because its passage is not in the answers, leaves the card it names as it is, while that card still stands.
		const elsewhere = refIndex >= 0 && cards[refIndex].lane !== item.lane;

		const ungrounded =
			item.basis === "said" && !quotedFrom(item.quote, answers);

		if (
			refIndex >= 0 &&
			(elsewhere || ungrounded) &&
			supported(cards[refIndex])
		)
			named.add(cards[refIndex].id);

		if (ungrounded) continue;

		// The card the item names in its own lane: by its ref first, then by saying the same idea. A card named from
		// another lane is not added here; a card in this lane that says its idea is still named (and may be reworded).
		const byRef = elsewhere ? -1 : refIndex;

		const index =
			byRef >= 0
				? byRef
				: cards.findIndex(
						(card) => card.lane === item.lane && sameIdea(card.text, item.text),
					);

		if (index < 0) {
			if (
				!elsewhere &&
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

		if (!mayChange(card, n) || !touches(card.lane)) continue;

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

	const kept = cards.filter(
		(card) => named.has(card.id) || !mayChange(card, n) || !touches(card.lane),
	);

	let nextId = board.nextId,
		added = 0;

	const addedItems: ReplyCard<L>[] = [];

	for (const item of scope.add ? fresh : []) {
		// A pass limited to one lane adds to that lane only: the others took the reply in full when it arrived.
		if (scope.only !== null && item.lane !== scope.only) continue;

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
		addedItems.push(item);
	}

	return {
		board: { ...board, cards: kept, nextId },
		addedItems,
		added,
		updated,
		withdrawn: cards.length - (kept.length - added),
	};
}

/**
 * Applies reply number `n` to the board as it is now (see `reconcile`). Nothing changes when the reply is older than one
 * already applied or the board is paused. The lane on screen (`onScreen`, null when a written question or another step
 * is showing) only receives the reply's new cards, at the end of its list: nothing listed there changes or leaves while
 * the visitor looks at it. The whole reply is held for it (`board.deferred`, replacing an older one) and the rest of it is
 * applied by `leaveLane`. Every other lane takes the reply in full. A card the reply adds to the lane on screen is
 * stamped like any other (`since`), so the same reply's held changes cannot reach it.
 */
export function applyReply(
	board: Board,
	reply: readonly ReplyCard[],
	n: number,
	answers: string,
	paused: boolean,
	onScreen: Lane | null,
	refs: readonly string[] = [],
): Applied {
	return applyReplyIn(
		BRIEF_LANES,
		board,
		reply,
		n,
		answers,
		paused,
		refs,
		onScreen,
	);
}

/**
 * applyReply for any set of lanes: the same rules, with the lanes' limits and their own test of whether a card stands.
 * `onScreen` is the lane the visitor is looking at, if the board has such a lane (the offer board has none).
 */
export function applyReplyIn<L extends string>(
	config: LaneConfig<L>,
	board: Board<L>,
	reply: readonly ReplyCard<L>[],
	n: number,
	answers: string,
	paused: boolean,
	refs: readonly string[] = [],
	onScreen: L | null = null,
): Applied<L> {
	if (paused || n <= board.applied)
		return { board, added: 0, updated: 0, withdrawn: 0 };

	const result = reconcile(config, board, reply, n, answers, refs, {
		add: true,
		skip: onScreen,
		only: null,
	});

	const { addedItems, ...applied } = result;

	return {
		...applied,
		board: {
			...result.board,
			applied: n,
			deferred: onScreen
				? { lane: onScreen, n, reply, refs, added: addedItems }
				: result.board.deferred,
		},
	};
}

/**
 * The visitor leaves `lane`'s screen: the reply held for it is applied now, to that lane's cards only, as any reply is
 * (owned cards left alone, `since` respected, set-aside ideas not offered again, passages checked against `answers` as
 * they are now, rewording never into another card's idea), with the new cards the delivery could not add while the lane
 * was full. Cards it did add are not touched again (their `since` is not before the reply). A held reply is dropped, not applied, when the board is
 * paused or a newer reply has applied since. Nothing is held afterwards, and the lane's last-seen list is the cards it
 * listed before the held reply applied, so a card the leave adds counts as new and one it withdraws as removed. A
 * reply's items the delivery already added are not added again (the visitor may have edited or set them aside).
 */
export function leaveLane(
	board: Board,
	lane: Lane,
	answers: string,
	paused = false,
): Board {
	const { deferred, ...rest } = board;

	let next: Board = rest;

	// What the visitor saw: the lane as it was before the held reply applies, so what the leave adds is new to them and
	// what it withdraws is removed.
	const saw = listed(rest, lane);

	if (
		deferred &&
		deferred.lane === lane &&
		!paused &&
		deferred.n >= board.applied
	)
		next = reconcile(
			BRIEF_LANES,
			rest,
			deferred.reply.filter((item) => !deferred.added.includes(item)),
			deferred.n,
			answers,
			deferred.refs,
			{ add: true, skip: null, only: lane },
		).board;

	return {
		...next,
		seen: { ...next.seen, [lane]: saw },
	};
}

/** The ids of the cards a lane lists: all but the set-aside ones. */
const listed = (board: Board, lane: Lane) =>
	board.cards
		.filter((card) => card.lane === lane && card.status !== "dismissed")
		.map((card) => card.id);

/** How a lane differs from when the visitor last left it: cards that are new, and cards that are gone. */
export type LaneChanges = { readonly added: number; readonly removed: number };

/** What changed in a lane since it was last left; zeros when it has not been visited. */
export function laneChanges(board: Board, lane: Lane): LaneChanges {
	const before = board.seen[lane];

	if (!before) return { added: 0, removed: 0 };
	const now = listed(board, lane);

	return {
		added: now.filter((id) => !before.includes(id)).length,
		removed: before.filter((id) => !now.includes(id)).length,
	};
}

/**
 * The visitor's own action (Keep, Edit, Answer, Not this, Bring back, Add, Remove, Undo) took the board from `before` to
 * `after`: each visited lane's last-seen list takes up that action's changes to what the lane lists, so the lane's status
 * line only ever counts what replies changed. A card the visitor put on the list is not "new" and one they took off is
 * not "removed"; what replies changed before the action stays counted.
 */
export function ownChange(before: Board, after: Board): Board {
	const changed = LANES.flatMap((lane): [Lane, readonly string[]][] => {
		const last = after.seen[lane];

		if (!last) return [];
		const was = listed(before, lane);
		const now = listed(after, lane);
		const gone = was.filter((id) => !now.includes(id));
		const put = now.filter((id) => !was.includes(id));

		return gone.length || put.length
			? [[lane, [...last.filter((id) => !gone.includes(id)), ...put]]]
			: [];
	});

	return changed.length
		? { ...after, seen: { ...after.seen, ...Object.fromEntries(changed) } }
		: after;
}

/** The line a lane shows under its hint after an answer changed: "" for no change, else its non-zero parts. */
export function laneChangesLine(changes: LaneChanges): string {
	const parts = [
		changes.added > 0 ? `${changes.added} new` : "",
		changes.removed > 0 ? `${changes.removed} removed` : "",
	].filter(Boolean);

	return parts.length ? `${parts.join(", ")} since you edited your answer` : "";
}

/**
 * The open cards read from the answers that their lane has not shown the visitor: still unowned, still grounded in the
 * answers, and not in the lane's last-seen list (every one, for a lane never visited). They are sent unless removed, so
 * the review step lists them.
 */
export function unseenFromAnswers(board: Board, answers: string): BoardCard[] {
	return LANES.flatMap((lane) =>
		board.cards.filter(
			(card) =>
				card.lane === lane &&
				card.status === "proposed" &&
				card.basis === "said" &&
				standsOn(card, answers) &&
				!(board.seen[lane] ?? []).includes(card.id),
		),
	);
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

/**
 * Use (the offer board): a card on the board becomes the owner's, as used in the offer. Like Keep, but an edited card, or
 * one kept by bringing it back, may be used too, and Undo says "used". The step is recorded even when the card was
 * already the owner's, so the page can undo what Use put into the offer with it.
 */
export function useCard<L extends string>(
	board: Board<L>,
	id: string,
	/** What the press did, as Undo names it; "used" by default. */
	verb = "used",
): Board<L> {
	const card = find(board, id);

	if (!card || card.status === "dismissed" || card.status === "wrote")
		return board;

	return act(
		board,
		`${verb} “${card.text}”`,
		[id],
		replace<L>(id, (c) => ({ ...c, status: "kept" })),
	);
}

/**
 * A step on the board's history that changes no card, for an action beside the board that Undo must reach (the offer
 * board's Set its fee). Undo of it puts the card back as it already is; the page puts back what the action changed.
 */
export function markStep<L extends string>(
	board: Board<L>,
	id: string,
	label: string,
): Board<L> {
	if (!find(board, id)) return board;

	return act(board, label, [id], (cards) => cards);
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
	const words = clipped(text, config.textLimits[card.lane]);

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
	const words = clipped(answer, ANSWER_MAX);

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
	const words = clipped(text, config.textLimits[lane]);

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
	`“${label}” is full. Use “Not this” on one of its cards, or remove a note, then try again.`;

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

	// A removed note Undo brings back is no longer removed: one entry for each note restored (the newest, which its
	// removal added), so an earlier removal of the same words still stands.
	const removed = [...(board.removed ?? [])];

	for (const { id, card } of step.before)
		if (
			card?.status === "wrote" &&
			!board.cards.some((present) => present.id === id)
		) {
			const at = removed.findLastIndex(
				(note) => note.lane === card.lane && note.text === card.text,
			);

			if (at >= 0) removed.splice(at, 1);
		}

	return {
		...board,
		cards: withinLimits(config, cards),
		history: board.history.slice(0, -1),
		removed,
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
	max = CONTEXT_MAX,
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
		.slice(0, max);
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
	"Your brief outline no longer matches your answers. Go back to the outline screens, check them and send again.";

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

/** What a page saves: each path's cards, and whether the outline is stopped (a page saves "plain" for a skipped outline, "paused" from before it). */
export const savedBoards = (saved: SavedBoards) => ({
	boards: Object.fromEntries(
		Object.entries(saved.boards).map(([path, board]) => [
			path,
			{
				cards: savedCards(board).map(({ since: _since, ...card }) => card),
				seen: board.seen,
			},
		]),
	),
	paused: saved.paused,
	plain: saved.plain,
});

/**
 * The last-seen lists read back: for each lane, its distinct card ids, at most the lane's limit plus the history's length
 * (Undo can leave a lane over its limit for a while, one card per step). Cutting to the limit would make a seen card
 * come back as new; the larger bound only stops a list that is not one this page saved.
 */
function readSeen(raw: RawValue): Board["seen"] {
	const seen: Partial<Record<Lane, readonly string[]>> = {};

	for (const lane of LANES) {
		const ids = listOf(ownField(raw, lane), SAVED_MAX);

		if (!ids) continue;

		seen[lane] = [
			...new Set(
				ids.filter(
					(id): id is string => Predicate.isString(id) && /^c\d{1,6}$/.test(id),
				),
			),
		].slice(0, laneLimits[lane] + HISTORY_MAX);
	}

	return seen;
}

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
				// The model's words that commit to something are never kept (an earlier build allowed some).
				(value.status !== "wrote" &&
					value.status !== "edited" &&
					!(
						value.status === "dismissed" && ownField(item, "edited") === true
					) &&
					commits(words)) ||
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
				// A reason that commits (an earlier build allowed some) is not shown again.
				reason: commits(value.reason) ? "" : oneLine(value.reason),
				answer: value.lane === "questions" ? oneLine(value.answer) : "",
				since: 0,
				edited: ownField(item, "edited") === true,
			});
		}

		const seen = readSeen(
			ownField(ownField(ownField(raw, "boards"), path), "seen"),
		);

		// The next id is above every id the page remembers: a withdrawn card's id can still be in a last-seen list, and a
		// new card that took it would count as already seen.
		const highest = Math.max(
			0,
			...cards.map((card) => Number(card.id.slice(1))),
			...Object.values(seen).flatMap((ids) =>
				(ids ?? []).map((id) => Number(id.slice(1))),
			),
		);

		boards[path] = {
			...emptyBoard(),
			cards,
			nextId: highest + 1,
			seen,
		};
	}

	return {
		boards,
		paused: ownField(raw, "paused") === true,
		plain: ownField(raw, "plain") === true,
	};
}
