// The living brief's outline, without the page (docs/plans/2026-11-living-brief.md). The rules (what a reply may change, what
// the visitor's actions do, what is sent) are in src/lib/brief-board.ts; this file keeps what the rules cannot:
//   - which screen is showing (a lane screen, a written question, or any other step) and so which lane a reply may not
//     change: the lane on screen only receives new cards, and what the reply held back applies when the visitor leaves it;
//   - one request at a time, after a pause in writing, at most REQUESTS_PER_PAGE per page, none while the outline is
//     skipped or its AI is off, and none on the steps that are not written questions or lane screens;
//   - the saved boards, whether the visitor skipped the outline, and the one line each lane screen shows;
//   - which "is full" reasons to show.
// src/scripts/brief-board.ts draws the lane screens from it.
import {
	type Board,
	type BoardCard,
	LANES,
	type Lane,
	type OutlineItem,
	REQUESTS_PER_PAGE,
	type ReplyCard,
	addNote,
	answerText,
	applyReply,
	boardAnswerKeys,
	boardContext,
	briefOutline,
	bringBack,
	emptyBoard,
	fitContext,
	laneChanges,
	laneChangesLine,
	laneCount,
	laneFull,
	laneLabels,
	laneLimits,
	lastAction,
	leaveLane,
	ownChange,
	readBoardAnswer,
	readReply,
	readSavedBoards,
	replyRefs,
	savedBoards,
	sendRequest,
	undo,
	unseenFromAnswers,
	BOARD_STORAGE_KEY,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";
import type { SoftwarePath } from "../lib/software-inquiry";

/** How long the visitor stops writing before the outline asks. */
const IDLE = 1500;

/** How long the outline waits after the visitor's last choice on a lane screen before it asks: they may make more. */
const BOARD_IDLE = 8000;

/** The least time between two requests. */
const GAP = 4000;

/** How long to wait after a failed request. */
const BACKOFF = 20000;

/** How long the page waits for an answer (the route gives the model thirty seconds). */
const TIMEOUT = 35000;

/** Failures in a row before the outline stops asking for this page. */
const FAILURES = 3;

/** What a lane screen says when the outline stops asking. The outline's AI is "the outline"; "suggestions" are the answer boxes'. */
const NOT_HERE =
	"The outline isn’t available here. You can add your own notes.";

const NOT_NOW =
	"The outline isn’t available right now. You can add your own notes.";

const LIMIT =
	"The outline reached today’s limit. You can still add your own notes.";

const UNREADABLE =
	"The outline couldn’t read this brief. You can still add your own notes.";

const PAGE_LIMIT =
	"The outline reached its limit for now. You can still add your own notes.";

const SUGGESTIONS_OFF =
	"Suggestions are off, so the outline is too. You can still add your own notes.";

const FAILING = "The outline couldn’t update just now. Trying again shortly.";

export const READING = "Reading your answers…";

/** The fewest words, across the answers, worth interpreting. */
const MIN_WORDS = 6;

/** The screen showing: one of the outline's lane screens, a written question, or any other step. */
export type Where = Lane | "written" | "other";

export type InterpretAnswer = { status: number; json: RawValue };

export type BoardCoreOptions = {
	readonly path: () => SoftwarePath;
	/** The current written answers, by field name. */
	readonly answers: () => Record<string, string>;
	readonly startPass: (renew?: boolean) => Promise<boolean>;
	/** Whether AI suggestions are on (the answers' "Turn off" switch). */
	readonly aiEnabled: () => boolean;
	/** Sends one request; tests and the scripted preview replace it. */
	readonly interpret?: (
		body: string,
		signal: AbortSignal,
	) => Promise<InterpretAnswer>;
	/** Called after any change the review or the draft should see: the cards, or whether the outline is skipped. */
	readonly onChange?: () => void;
	/** Called when the lane screens should be drawn again: a change, or a new status line. */
	readonly onRender?: () => void;
};

export type BriefBoardHandle = {
	/**
	 * The screen now showing. Leaving a lane screen applies what the lane held back and records what it listed (leaveLane).
	 * A written question or a lane screen asks for the outline; any other step asks nothing.
	 */
	screen(on: Where): void;
	pathChanged(): void;
	answersChanged(): void;
	aiChanged(): void;
	/** What goes with the brief: undefined when the outline is skipped or holds nothing to send. */
	outline(): OutlineItem[] | undefined;
	/** The open cards read from the answers that their lane has not shown the visitor, for the review. */
	unseen(): BoardCard[];
	/** Whether the visitor skipped the outline. */
	skipped(): boolean;
	/** "Skip these, no AI outline": leaves the lane on screen, stops asking and sends no outline. */
	skip(): void;
	/** "Add the outline back": asks again, and the cards the visitor had are back. */
	addBack(): void;
	/** The brief was sent: the saved boards are forgotten. */
	sent(): void;
};

export type BriefBoardCore = BriefBoardHandle & {
	board(): Board;
	/** Makes `next` the board after a change of the visitor's, saves it and tells the page. */
	change(next: Board): void;
	/** The line under a lane screen's hint. */
	statusLine(lane: Lane): string;
	/** Whether the visitor tried to add to a list that was full, and the list still is: the reason, else "". */
	fullNote(lane: Lane): string;
	/** The same for a set-aside card that could not come back to its full list. */
	fullNoteFor(card: BoardCard): string;
	/** Notes that the visitor pressed Add on a full list: false (and the reason is shown) when it is full. */
	tryOpenAdd(lane: Lane): boolean;
	tryAddNote(lane: Lane, text: string): boolean;
	tryBringBack(id: string): boolean;
	/** Undoes the visitor's last action; what it undid, and the open cards Undo withdrew to keep a list within its limit. */
	undoLast(): { label: string; withdrawn: BoardCard[] } | null;
	undoLabel(): string | null;
};

/** A signal that aborts with `signal` or after `ms`, without AbortSignal.any (Safari before 17.4 has none). */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
	const controller = new AbortController();
	const abort = () => controller.abort();

	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	setTimeout(abort, ms);

	return controller.signal;
}

const fetchInterpretation = async (
	body: string,
	signal: AbortSignal,
): Promise<InterpretAnswer> => {
	const response = await fetch("/api/software/brief/board", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
		signal: withTimeout(signal, TIMEOUT),
	});

	return {
		status: response.status,
		json: await response.json().catch(() => null),
	};
};

const laneOf = (where: Where): Lane | null =>
	LANES.find((lane) => lane === where) ?? null;

export function createBriefBoardCore(
	options: BoardCoreOptions,
): BriefBoardCore {
	const interpret = options.interpret ?? fetchInterpretation;

	const saved = (() => {
		try {
			return readSavedBoards(
				JSON.parse(localStorage.getItem(BOARD_STORAGE_KEY) ?? "null"),
			);
		} catch {
			return readSavedBoards(null);
		}
	})();

	const boards: Partial<Record<SoftwarePath, Board>> = { ...saved.boards };

	// An old page saved "paused" and "plain": both stopped the outline, and this page has one way to do that.
	let skipped = saved.plain || saved.paused,
		where: Where = "other",
		stopped = "",
		failures = 0,
		// After a failure, no request before this time, however the visitor writes (the back-off).
		retryAt = 0,
		requests = 0,
		lastSendAt = 0,
		boardChangedAt = 0,
		phase: "idle" | "reading" = "idle",
		timer: ReturnType<typeof setTimeout> | undefined,
		inFlight: { controller: AbortController } | null = null;

	const lastSent: Partial<Record<SoftwarePath, string>> = {};
	// Lists the visitor tried to add to, and set-aside cards they tried to bring back, while the list was full: each says
	// why (laneFull) until there is room. Add and Bring back are never disabled, so the reason comes with the press.
	const fullTried = new Set<string>();
	const tried = (key: string) => `${options.path()}:${key}`;

	const board = (): Board => (boards[options.path()] ??= emptyBoard());
	const currentAnswers = () => answerText(options.answers(), options.path());
	const paused = () => skipped || !options.aiEnabled();
	const render = () => options.onRender?.();

	const persist = () => {
		try {
			localStorage.setItem(
				BOARD_STORAGE_KEY,
				JSON.stringify(savedBoards({ boards, paused: false, plain: skipped })),
			);
		} catch {
			/* Storage is optional. */
		}
	};

	// What a request is for: the answers as words (a trailing space asks nothing new) and the visitor's own choices on the
	// board. A reply changes only open cards, so applying one never asks again by itself.
	const answersKey = () =>
		JSON.stringify([
			options.path(),
			Object.entries(options.answers()).map(([name, value]) => [
				name,
				value.replace(/\s+/g, " ").trim(),
			]),
			board()
				.cards.filter((card) => card.status !== "proposed")
				.map((card) => [card.id, card.status, card.text, card.answer]),
		]);

	const canAsk = () =>
		where !== "other" &&
		!skipped &&
		options.aiEnabled() &&
		!stopped &&
		requests < REQUESTS_PER_PAGE &&
		currentAnswers().split(/\s+/).filter(Boolean).length >= MIN_WORDS;

	/** The board needs a request again, though its answers are as they were when the last one was sent. */
	const forgetSent = () => {
		for (const path of Object.keys(lastSent)) {
			// SAFETY: lastSent is only ever written under a SoftwarePath key, so its own keys are all SoftwarePath values.
			delete lastSent[path as SoftwarePath];
		}
	};

	/** Whether a request is waiting for the visitor to stop writing or choosing. */
	const waiting = () => canAsk() && lastSent[options.path()] !== answersKey();

	// ---- Replies ------------------------------------------------------------------------------------------------------
	/**
	 * A reply applies when it arrives, whichever step is showing. The lane on screen only receives its new cards, at the end
	 * of its list; the rest of the reply is held for it and applies when the visitor leaves (leaveLane).
	 */
	function deliver(
		path: SoftwarePath,
		n: number,
		cards: ReplyCard[],
		refs: readonly string[],
	) {
		if (path !== options.path() || paused()) return;

		const result = applyReply(
			board(),
			cards,
			n,
			currentAnswers(),
			false,
			laneOf(where),
			refs,
		);

		boards[path] = result.board;
		persist();
		render();

		if (result.added + result.updated + result.withdrawn > 0)
			options.onChange?.();
	}

	// ---- Requests -----------------------------------------------------------------------------------------------------
	function schedule(delay = IDLE) {
		clearTimeout(timer);
		render();

		if (!canAsk() || lastSent[options.path()] === answersKey()) return;
		timer = setTimeout(
			ask,
			Math.max(
				delay,
				lastSendAt + GAP - Date.now(),
				retryAt - Date.now(),
				// The visitor may still be making choices on the lane screen.
				boardChangedAt + BOARD_IDLE - Date.now(),
			),
		);
	}

	async function ask() {
		if (!canAsk() || inFlight) return;
		const key = answersKey();
		const path = options.path();

		if (lastSent[path] === key) return;

		if (!(await options.startPass())) {
			stop(NOT_NOW);

			return;
		}

		if (
			!canAsk() ||
			inFlight ||
			options.path() !== path ||
			answersKey() !== key
		) {
			schedule();

			return;
		}

		const [next, n] = sendRequest(board());
		boards[path] = next;

		const body = JSON.stringify({
			path,
			answers: Object.fromEntries(
				boardAnswerKeys[path].map((name) => [
					name,
					options.answers()[name] ?? "",
				]),
			),
			cards: fitContext(
				boardContext(next),
				answerText(options.answers(), path).length,
			),
		});

		const controller = new AbortController();
		inFlight = { controller };
		lastSent[path] = key;
		lastSendAt = Date.now();
		requests++;
		phase = "reading";
		render();
		let retry = BACKOFF;

		try {
			let answer = await interpret(body, controller.signal);
			let read = readBoardAnswer(answer.json);

			if (
				answer.status === 403 &&
				read.reason === "pass" &&
				(await options.startPass(true))
			) {
				answer = await interpret(body, controller.signal);
				read = readBoardAnswer(answer.json);
			}

			// Aborted while the answer was still arriving: it was never answered, as below.
			if (controller.signal.aborted) throw new Error("aborted");

			const cards =
				answer.status === 200 && read.cards !== undefined
					? readReply(read.cards, answerText(options.answers(), path))
					: null;

			if (cards) {
				failures = 0;

				// The route named these cards; the ones this page then leaves out (their passage edited meanwhile) still do.
				const refs = [
					...read.refs,
					...replyRefs(read.cards).filter(
						(ref) => !cards.some((card) => card.ref === ref),
					),
				];

				deliver(path, n, cards, refs);
			} else if (read.reason === "limit") {
				stop(LIMIT);
			} else if (answer.status === 403 || read.reason === "off") {
				stop(NOT_HERE);
			} else if (answer.status === 400) {
				// The page fits every request to what the route reads; a refusal means asking again would not help.
				stop(UNREADABLE);
			} else {
				failures++;
				// A request that failed is asked again once the visitor writes or the back-off ends.
				delete lastSent[path];
			}
		} catch {
			// An aborted request (a skip, another path) was never answered, so it is asked again later.
			delete lastSent[path];

			if (!controller.signal.aborted) failures++;
			else retry = IDLE;
		} finally {
			if (inFlight?.controller === controller) inFlight = null;
			phase = "idle";

			if (failures >= FAILURES && !stopped) stop(NOT_NOW);

			if (requests >= REQUESTS_PER_PAGE && !stopped) stop(PAGE_LIMIT);
			retryAt = failures > 0 ? Date.now() + retry : 0;
			schedule();
		}
	}

	/** Stops asking for this page. The lane screens say why (statusLine), and the visitor's own cards keep working. */
	function stop(why: string) {
		stopped = why;
		render();
	}

	function stopAsking() {
		clearTimeout(timer);
		inFlight?.controller.abort();
		inFlight = null;
		phase = "idle";
		render();
	}

	// ---- The visitor's choices ----------------------------------------------------------------------------------------
	/** Makes `next` the board after a change of the visitor's, and asks again once they have paused. */
	function change(next: Board) {
		if (next === board()) return;
		// The visitor's own action is not a change a reply made: the status line must not count it.
		boards[options.path()] = ownChange(board(), next);
		persist();
		render();
		options.onChange?.();
		// The visitor's choices go with the next request, after a longer pause than writing.
		boardChangedAt = Date.now();
		schedule();
	}

	/** What the visitor sees of a lane's list when it is full and they tried to add. */
	const fullNote = (lane: Lane) => {
		if (laneCount(board(), lane) < laneLimits[lane]) {
			fullTried.delete(tried(lane));

			return "";
		}

		return fullTried.has(tried(lane))
			? laneFull(laneLabels[options.path()][lane])
			: "";
	};

	const fullNoteFor = (card: BoardCard) => {
		if (laneCount(board(), card.lane) < laneLimits[card.lane]) {
			fullTried.delete(tried(card.id));

			return "";
		}

		return fullTried.has(tried(card.id))
			? laneFull(laneLabels[options.path()][card.lane])
			: "";
	};

	/** A leave of the lane on screen: what it held applies, and what it lists is what the visitor has seen. */
	function leave(lane: Lane) {
		boards[options.path()] = leaveLane(
			board(),
			lane,
			currentAnswers(),
			paused(),
		);
		persist();
		render();
	}

	return {
		board,
		change,
		statusLine(lane) {
			if (!options.aiEnabled()) return SUGGESTIONS_OFF;

			if (stopped) return stopped;

			if (phase === "reading" || waiting()) return READING;

			if (failures > 0) return FAILING;

			return laneChangesLine(laneChanges(board(), lane));
		},
		fullNote,
		fullNoteFor,
		tryOpenAdd(lane) {
			if (laneCount(board(), lane) < laneLimits[lane]) return true;
			fullTried.add(tried(lane));
			render();

			return false;
		},
		tryAddNote(lane, text) {
			const next = addNote(board(), lane, text);

			if (next === board()) {
				fullTried.add(tried(lane));
				render();

				return false;
			}

			change(next);

			return true;
		},
		tryBringBack(id) {
			const next = bringBack(board(), id);

			if (next === board()) {
				fullTried.add(tried(id));
				render();

				return false;
			}

			change(next);

			return true;
		},
		undoLabel: () => lastAction(board()),
		undoLast() {
			const label = lastAction(board());

			if (!label) return null;
			const before = board();
			const after = undo(before);

			// Open cards Undo had to withdraw to keep a list within its limit (see undo in src/lib/brief-board.ts).
			const withdrawn = before.cards.filter(
				(card) =>
					card.status === "proposed" &&
					!after.cards.some((other) => other.id === card.id),
			);

			change(after);

			return { label, withdrawn };
		},
		screen(on) {
			const before = laneOf(where);
			where = on;

			if (before && before !== laneOf(on)) leave(before);

			if (on === "other") clearTimeout(timer);
			schedule();
		},
		pathChanged() {
			stopAsking();
			render();
			schedule();
		},
		answersChanged() {
			// The drawn cards follow the answers at once ("Your answer changed"); the request waits for a pause.
			render();
			schedule();
		},
		aiChanged() {
			if (!options.aiEnabled()) stopAsking();
			// Turned back on: the reply dropped while it was off is asked for again, though nothing was written since.
			else forgetSent();
			render();
			schedule();
		},
		outline() {
			if (skipped) return undefined;
			const items = briefOutline(board(), currentAnswers());

			return items.length ? items : undefined;
		},
		unseen: () => (skipped ? [] : unseenFromAnswers(board(), currentAnswers())),
		skipped: () => skipped,
		skip() {
			const lane = laneOf(where);
			skipped = true;
			where = "other";
			stopAsking();

			// The reply held for the lane is dropped, not applied: the outline is paused.
			if (lane) leave(lane);
			else persist();
		},
		addBack() {
			skipped = false;
			// The reply dropped at the skip is asked for again, though nothing was written since.
			forgetSent();
			persist();
			schedule();
		},
		sent() {
			stopAsking();

			try {
				localStorage.removeItem(BOARD_STORAGE_KEY);
			} catch {
				/* Storage is optional. */
			}
		},
	};
}
