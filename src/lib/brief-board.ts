// The living brief's board (docs/plans/2026-11-living-brief.md): the outline a visitor and the interpreting model shape at
// the same time beside the brief's written answers. This module is the board's rules, shared by the browser and the
// server: what a card is, the reply and outline schemas, how a passage is checked against the answers, how a reply is
// applied (`applyReply`, modelled in verification/brief-board.qnt) and what the visitor's own actions do. Pure and
// synchronous: Effect Schema only, decoded with `decodeUnknownResult`; no Effect runtime, service or storage.
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Mutable, RawValue } from "./fields";
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

export type BoardCard = {
	readonly id: string;
	readonly lane: Lane;
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
};

/** One visitor action, for Undo: each card it changed as it was before (null: the action added it), and where it was. */
export type HistoryStep = {
	readonly label: string;
	readonly before: readonly {
		readonly id: string;
		readonly card: BoardCard | null;
		readonly index: number;
	}[];
};

export type Board = {
	readonly cards: readonly BoardCard[];
	readonly nextId: number;
	/** Requests sent so far: each request's number is the count after it was sent. */
	readonly sent: number;
	/** The number of the newest reply applied (0: none). */
	readonly applied: number;
	readonly history: readonly HistoryStep[];
};

export const emptyBoard = (): Board => ({
	cards: [],
	nextId: 1,
	sent: 0,
	applied: 0,
	history: [],
});

export const isOwned = (card: BoardCard) => card.status !== "proposed";

/** The cards that count toward a lane's limit: everything but set-aside cards. */
export const laneCount = (board: Board, lane: Lane) =>
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

/** Whether `quote` is a passage of the answers: at least three characters, found in them as written (case, spacing and quote marks aside). */
export function quotedFrom(quote: string, answers: string): boolean {
	const passage = comparable(quote);

	return passage.length >= 3 && comparable(answers).includes(passage);
}

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

// Rule 7 of the plan: a card never carries a price, a time estimate, a promise or a link.
const MONEY = /[$€£¥₹]\s?\d|\d\s?(?:usd|eur|gbp|dollars?|euros?|pounds?|k\b)/i;

const DURATION =
	/\b\d+(?:\.\d+)?\s*(?:-|to)?\s*\d*\s*(?:hours?|hrs?|days?|weeks?|wks?|months?|years?)\b|\b(?:a|one|two|three|four|five|six|few|couple of)\s+(?:hours?|days?|weeks?|months?)\b/i;

const PROMISE =
	/\b(?:i will|i'll|we will|we'll|kazon will|guarantee[sd]?|promise[sd]?|deadline|delivered by|ready by|done by)\b/i;

const LINK =
	/https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|dev|app|co|us|uk|ai)\b|[\w.+-]+@[\w-]+\./i;

/** Whether text makes a commitment or points somewhere: a price, a time estimate, a promise, a link or an address. */
export const commits = (text: string) =>
	MONEY.test(text) ||
	DURATION.test(text) ||
	PROMISE.test(text.replace(/[‘’]/g, "'")) ||
	LINK.test(text);

// ---- The reply ----------------------------------------------------------------------------------------------------

const LaneSchema = Schema.Literals(LANES);

/** One card as the model answers it. Each card is read on its own, so one bad card does not lose the rest. */
const ReplyCardSchema = Schema.Struct({
	ref: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(12))),
	lane: LaneSchema,
	text: Schema.String.check(Schema.isMaxLength(200)),
	basis: Schema.Literals(["said", "suggested"]),
	quote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(400))),
	reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(300))),
});

const ReplyCardsSchema = Schema.Struct({
	cards: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(40)),
});

export type ReplyCard = {
	readonly ref: string;
	readonly lane: Lane;
	readonly text: string;
	readonly basis: "said" | "suggested";
	readonly quote: string;
	readonly reason: string;
};

const readReplyCards = Schema.decodeUnknownResult(ReplyCardsSchema);
const readCard = Schema.decodeUnknownResult(ReplyCardSchema);

/**
 * The cards of a reply that are fit to show, read from anything (the model's JSON on the server, the route's JSON in the
 * browser): each card's text cleaned and within its lane's limit, a passage for one read from the answers, a short reason
 * for an inference, nothing that makes a commitment or links anywhere, and a passage that is in `answers`. Anything else
 * is left out; null when the reply itself is not a list of cards. At most REPLY_MAX cards.
 */
export function readReply(raw: RawValue, answers: string): ReplyCard[] | null {
	const listed = readReplyCards(raw);

	if (Result.isFailure(listed)) return null;

	const cards: ReplyCard[] = [];

	for (const item of listed.success.cards) {
		const read = readCard(item);

		if (Result.isFailure(read)) continue;
		const card = read.success;
		const text = oneLine(card.text);
		const quote = oneLine(card.quote ?? "");
		const reason = oneLine(card.reason ?? "");

		if (
			!text ||
			text.length > textLimits[card.lane] ||
			commits(text) ||
			(card.basis === "said" &&
				(quote.length > QUOTE_MAX || !quotedFrom(quote, answers))) ||
			reason.length > REASON_MAX ||
			commits(reason)
		)
			continue;

		cards.push({
			ref: card.ref ?? "",
			lane: card.lane,
			text,
			basis: card.basis,
			quote: card.basis === "said" ? quote : "",
			reason: card.basis === "suggested" ? reason : "",
		});

		if (cards.length === REPLY_MAX) break;
	}

	return cards;
}

const BoardAnswerSchema = Schema.Struct({
	reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(20))),
	cards: Schema.optionalKey(Schema.Unknown),
});

const readAnswer = Schema.decodeUnknownResult(BoardAnswerSchema);

/** Why the route did not interpret: "pass" (renew the pass), "limit", "off", "busy" or "" when it did not say. */
export type BoardRefusal = "pass" | "limit" | "off" | "busy" | "";

/** The route's answer, as the browser reads it. */
export type BoardAnswer = {
	/** The reply's cards, still to be read with `readReply`, when the route sent some. */
	readonly cards: RawValue | undefined;
	readonly reason: BoardRefusal;
};

/** The route's answer, read in the browser: its cards when it sent some, and the reason it gave when it refused. */
export function readBoardAnswer(raw: RawValue): BoardAnswer {
	const read = readAnswer(raw);

	if (Result.isFailure(read)) return { cards: undefined, reason: "" };
	const reason = read.success.reason;

	return {
		cards:
			read.success.cards === undefined
				? undefined
				: { cards: read.success.cards },
		reason:
			reason === "pass" ||
			reason === "limit" ||
			reason === "off" ||
			reason === "busy"
				? reason
				: "",
	};
}

/** Whether reply number `n` may change `card`: only an unowned card that was unowned when request `n` was sent. */
const mayChange = (card: BoardCard, n: number) =>
	card.status === "proposed" && n > card.since;

export type Applied = {
	readonly board: Board;
	readonly added: number;
	readonly updated: number;
	readonly withdrawn: number;
};

/**
 * Applies reply number `n` to the board as it is now. Nothing changes when the reply is older than one already applied
 * or the board is paused. Otherwise each reply card that names an unowned card (by its id, or by saying the same idea)
 * updates it, if the reply's request was sent after the card last became unowned; one that names an owned card, or a
 * set-aside idea, is left out; a new idea is added at the end of its lane, within the lane's limit. An unowned card the
 * reply leaves out is withdrawn, again only if the request was sent after it last became unowned. A card read from the
 * answers is checked against the answers as they are now (`answers`), not as they were sent.
 */
export function applyReply(
	board: Board,
	reply: readonly ReplyCard[],
	n: number,
	answers: string,
	paused: boolean,
): Applied {
	if (paused || n <= board.applied)
		return { board, added: 0, updated: 0, withdrawn: 0 };

	const cards = [...board.cards];
	const named = new Set<string>();

	let nextId = board.nextId,
		added = 0,
		updated = 0;

	for (const item of reply) {
		if (item.basis === "said" && !quotedFrom(item.quote, answers)) continue;

		const index = cards.findIndex(
			(card) =>
				card.lane === item.lane &&
				(card.id === item.ref || sameIdea(card.text, item.text)),
		);

		if (index >= 0) {
			const card = cards[index];
			named.add(card.id);

			if (!mayChange(card, n)) continue;

			const next: BoardCard = {
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

			continue;
		}

		if (
			cards.filter(
				(card) => card.lane === item.lane && card.status !== "dismissed",
			).length >= laneLimits[item.lane]
		)
			continue;

		const id = `c${nextId++}`;
		named.add(id);
		cards.push({
			id,
			lane: item.lane,
			text: item.text,
			status: "proposed",
			basis: item.basis,
			quote: item.quote,
			reason: item.reason,
			answer: "",
			since: board.sent,
		});
		added++;
	}

	const kept = cards.filter(
		(card) => named.has(card.id) || !mayChange(card, n),
	);

	return {
		board: { ...board, cards: kept, nextId, applied: n },
		added,
		updated,
		withdrawn: cards.length - kept.length,
	};
}

// ---- The visitor's actions ----------------------------------------------------------------------------------------

/** Records how the cards named in `ids` were, then applies `change` to the board's cards. */
function act(
	board: Board,
	label: string,
	ids: readonly string[],
	change: (cards: BoardCard[]) => BoardCard[],
	nextId = board.nextId,
): Board {
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
	(id: string, patch: (card: BoardCard) => BoardCard) => (cards: BoardCard[]) =>
		cards.map((card) => (card.id === id ? patch(card) : card));

const find = (board: Board, id: string) =>
	board.cards.find((card) => card.id === id);

/** Keep: an unowned card becomes the visitor's. */
export function keepCard(board: Board, id: string): Board {
	const card = find(board, id);

	if (!card || card.status !== "proposed") return board;

	return act(
		board,
		`kept “${card.text}”`,
		[id],
		replace(id, (c) => ({ ...c, status: "kept" })),
	);
}

/** Edit: the visitor's words replace the card's. A note stays a note. */
export function editCard(board: Board, id: string, text: string): Board {
	const card = find(board, id);
	const words = oneLine(text).slice(0, textLimits[card?.lane ?? "parts"]);

	if (!card || card.status === "dismissed" || !words || words === card.text)
		return board;

	return act(
		board,
		`edited “${card.text}”`,
		[id],
		replace(id, (c) => ({
			...c,
			text: words,
			status: c.status === "wrote" ? "wrote" : "edited",
		})),
	);
}

/** Answer: the visitor's answer to a question. The question becomes the visitor's; an empty answer clears it. */
export function answerCard(board: Board, id: string, answer: string): Board {
	const card = find(board, id);
	const words = oneLine(answer).slice(0, ANSWER_MAX);

	if (
		!card ||
		card.lane !== "questions" ||
		card.status === "dismissed" ||
		words === card.answer
	)
		return board;

	return act(
		board,
		`answered “${card.text}”`,
		[id],
		replace(id, (c) => ({
			...c,
			answer: words,
			status: c.status === "proposed" ? "kept" : c.status,
		})),
	);
}

/** Not this: the card is set aside, and the idea is not offered again. */
export function setAside(board: Board, id: string): Board {
	const card = find(board, id);

	if (!card || card.status === "dismissed" || card.status === "wrote")
		return board;

	return act(
		board,
		`set aside “${card.text}”`,
		[id],
		replace(id, (c) => ({ ...c, status: "dismissed" })),
	);
}

/** Bring back: a set-aside card returns as kept. */
export function bringBack(board: Board, id: string): Board {
	const card = find(board, id);

	if (
		!card ||
		card.status !== "dismissed" ||
		laneCount(board, card.lane) >= laneLimits[card.lane]
	)
		return board;

	return act(
		board,
		`brought back “${card.text}”`,
		[id],
		replace(id, (c) => ({ ...c, status: "kept" })),
	);
}

/** Remove: the visitor's own note is deleted (Undo brings it back). */
export function removeNote(board: Board, id: string): Board {
	const card = find(board, id);

	if (!card || card.status !== "wrote") return board;

	return act(board, `removed “${card.text}”`, [id], (cards) =>
		cards.filter((c) => c.id !== id),
	);
}

/** Add: the visitor's own note, at the end of its lane, within the lane's limit. */
export function addNote(board: Board, lane: Lane, text: string): Board {
	const words = oneLine(text).slice(0, textLimits[lane]);

	if (!words || laneCount(board, lane) >= laneLimits[lane]) return board;
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
			},
		],
		board.nextId + 1,
	);
}

/** What Undo would undo, for its label; null when there is nothing. */
export const lastAction = (board: Board) =>
	board.history.length ? board.history[board.history.length - 1].label : null;

/**
 * Undo: every card the last action changed is put back as it was, where it was. A card that becomes unowned again is
 * stamped with the requests sent so far, so a reply already on its way does not change it (the plan, rule 4).
 */
export function undo(board: Board): Board {
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

	return { ...board, cards, history: board.history.slice(0, -1) };
}

/** The board after a request is sent: its number is the new count. */
export const sendRequest = (board: Board): [Board, number] => [
	{ ...board, sent: board.sent + 1 },
	board.sent + 1,
];

// ---- What the model is shown ---------------------------------------------------------------------------------------

export type ContextCard = {
	readonly ref: string;
	readonly lane: Lane;
	readonly text: string;
	/** open: the model's, which it may keep, reword or leave out. yours: the visitor's. avoid: set aside. */
	readonly state: "open" | "yours" | "avoid";
};

/** The cards a request shows the model, at most CONTEXT_MAX: open ones first, then the visitor's, then set-aside ones. */
export function boardContext(board: Board): ContextCard[] {
	const state = (card: BoardCard): ContextCard["state"] =>
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

/** A request to interpret the brief: the path, its written answers and the board as context. */
export const BoardRequestSchema = Schema.Struct({
	path: Schema.Literals(["website", "webapp", "workflow"]),
	answers: Schema.Record(
		Schema.String.check(Schema.isMaxLength(20)),
		Schema.String.check(Schema.isMaxLength(2000)),
	),
	cards: Schema.Array(
		Schema.Struct({
			ref: Schema.String.check(Schema.isMaxLength(12)),
			lane: LaneSchema,
			text: Schema.String.check(
				Schema.isMaxLength(textLimits.questions + ANSWER_MAX + 12),
			),
			state: Schema.Literals(["open", "yours", "avoid"]),
		}),
	).check(Schema.isMaxLength(CONTEXT_MAX)),
});

export type BoardRequest = Schema.Schema.Type<typeof BoardRequestSchema>;

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

	for (const lane of LANES)
		for (const card of board.cards) {
			if (card.lane !== lane || card.status === "dismissed") continue;
			const grounded = card.basis === "said" && quotedFrom(card.quote, answers);

			if (card.status === "proposed" && !grounded) continue;

			const origin: OutlineOrigin =
				card.status === "wrote"
					? "wrote"
					: card.status === "edited"
						? "edited"
						: grounded
							? "answers"
							: "kept";

			const item: Mutable<OutlineItem> = {
				lane,
				text: card.text,
				origin,
			};

			if (origin === "answers") item.quote = card.quote;

			if (card.answer) item.answer = card.answer;
			items.push(item);
		}

	return items;
}

const OutlineItemSchema = Schema.Struct({
	lane: LaneSchema,
	text: Schema.String.check(Schema.isMaxLength(textLimits.purpose)),
	origin: Schema.Literals(["answers", "kept", "edited", "wrote"]),
	quote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(QUOTE_MAX))),
	answer: Schema.optionalKey(
		Schema.String.check(Schema.isMaxLength(ANSWER_MAX)),
	),
});

const OutlineSchema = Schema.Array(OutlineItemSchema).check(
	Schema.isMaxLength(OUTLINE_MAX),
);

const readOutlineItems = Schema.decodeUnknownResult(OutlineSchema);

/** The sentence a visitor sees when the outline sent does not match the brief. */
export const OUTLINE_CHANGED =
	"Your brief outline no longer matches your answers. Go back to it, check it and send again.";

/**
 * The outline sent with a brief, read on the server: undefined when none was sent; the items when each is within its
 * lane's limits, plain one-line text, no commitment or link, an answer only on a question, and a passage for (and only
 * for) an item read from the answers that is in the submitted `answers`; otherwise a refusal with OUTLINE_CHANGED.
 */
export function readBriefOutline(
	raw: RawValue,
	answers: string,
):
	| { ok: true; value: OutlineItem[] | undefined }
	| { ok: false; error: string } {
	if (raw === undefined) return { ok: true, value: undefined };
	const read = readOutlineItems(raw);

	if (Result.isFailure(read)) return { ok: false, error: OUTLINE_CHANGED };

	const counts: Record<Lane, number> = {
		purpose: 0,
		audience: 0,
		parts: 0,
		questions: 0,
	};

	for (const item of read.success) {
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
		value: read.success.length
			? read.success.map((item) => ({ ...item }))
			: undefined,
	};
}

/** How each origin reads to the visitor and the owner. */
export const originLabels: Record<OutlineOrigin, string> = {
	answers: "From your answers",
	kept: "Suggestion you kept",
	edited: "Suggestion you edited",
	wrote: "Your note",
};

/** How each origin reads to the owner, who is not the visitor. */
export const ownerOriginLabels: Record<OutlineOrigin, string> = {
	answers: "from their answers",
	kept: "AI suggestion they kept",
	edited: "AI suggestion they edited",
	wrote: "their own note",
};

// ---- The saved boards ---------------------------------------------------------------------------------------------

/** The localStorage key the boards are saved under, beside the brief's draft (`software-brief-draft`). */
export const BOARD_STORAGE_KEY = "software-brief-board";

const SavedCardSchema = Schema.Struct({
	id: Schema.String.check(Schema.isPattern(/^c\d{1,6}$/)),
	lane: LaneSchema,
	text: Schema.String.check(Schema.isMaxLength(textLimits.purpose)),
	status: Schema.Literals(["proposed", "kept", "edited", "dismissed", "wrote"]),
	basis: Schema.Literals(["said", "suggested", "none"]),
	quote: Schema.String.check(Schema.isMaxLength(QUOTE_MAX)),
	reason: Schema.String.check(Schema.isMaxLength(REASON_MAX)),
	answer: Schema.String.check(Schema.isMaxLength(ANSWER_MAX)),
});

const SavedSchema = Schema.Struct({
	boards: Schema.Record(
		Schema.String,
		Schema.Struct({
			cards: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(60)),
		}),
	),
	paused: Schema.Boolean,
	plain: Schema.Boolean,
});

const readSaved = Schema.decodeUnknownResult(SavedSchema);
const readSavedCard = Schema.decodeUnknownResult(SavedCardSchema);

export type SavedBoards = {
	readonly boards: Partial<Record<SoftwarePath, Board>>;
	readonly paused: boolean;
	readonly plain: boolean;
};

/** What a page saves: each path's cards, and whether the board is paused or set aside for the plain form. */
export const savedBoards = (saved: SavedBoards) => ({
	boards: Object.fromEntries(
		Object.entries(saved.boards).map(([path, board]) => [
			path,
			{ cards: board.cards.map(({ since: _since, ...card }) => card) },
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
	const read = readSaved(raw);

	if (Result.isFailure(read))
		return { boards: {}, paused: false, plain: false };
	const boards: Partial<Record<SoftwarePath, Board>> = {};

	for (const path of ["website", "webapp", "workflow"] as const) {
		if (!Object.hasOwn(read.success.boards, path)) continue;
		const cards: BoardCard[] = [];

		for (const item of read.success.boards[path].cards) {
			const card = readSavedCard(item);

			if (Result.isFailure(card)) continue;
			const value = card.success;
			const text = oneLine(value.text);

			if (
				!text ||
				text.length > textLimits[value.lane] ||
				cards.some((c) => c.id === value.id) ||
				(value.status !== "dismissed" &&
					cards.filter((c) => c.lane === value.lane && c.status !== "dismissed")
						.length >= laneLimits[value.lane])
			)
				continue;

			cards.push({
				...value,
				text,
				quote: oneLine(value.quote),
				reason: oneLine(value.reason),
				answer: value.lane === "questions" ? oneLine(value.answer) : "",
				since: 0,
			});
		}

		const highest = Math.max(
			0,
			...cards.map((card) => Number(card.id.slice(1))),
		);

		boards[path] = { ...emptyBoard(), cards, nextId: highest + 1 };
	}

	return { boards, paused: read.success.paused, plain: read.success.plain };
}
