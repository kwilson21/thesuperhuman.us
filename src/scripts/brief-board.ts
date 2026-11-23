// The living brief's board in the page (docs/plans/2026-11-living-brief.md). The rules (what a reply may change, what the
// visitor's actions do, what is sent) are in src/lib/brief-board.ts; this file draws the board, asks for interpretations
// and keeps three promises the rules cannot keep on their own:
//   - one request at a time, after a pause in writing, at most REQUESTS_PER_PAGE per page, none while paused, off or plain;
//   - a reply that arrives while the visitor is in the board (focus inside it, or a fine pointer over it) is held until
//     they leave or ask for it, so nothing moves under them, and the answer box is never below the board;
//   - every card is drawn in place: a card's node is kept while the card lives, so a focused button is never replaced.
import {
	ANSWER_MAX,
	BOARD_STORAGE_KEY,
	type Board,
	type BoardCard,
	LANES,
	type Lane,
	type OutlineItem,
	REQUESTS_PER_PAGE,
	type ReplyCard,
	addLabels,
	addNote,
	answerCard,
	answerText,
	applyReply,
	boardAnswerKeys,
	boardContext,
	briefOutline,
	bringBack,
	editCard,
	emptyBoard,
	fitContext,
	keepCard,
	laneCount,
	laneFull,
	laneLabels,
	laneLimits,
	lastAction,
	readBoardAnswer,
	readReply,
	readSavedBoards,
	removeNote,
	replyRefs,
	savedBoards,
	sendRequest,
	setAside,
	standsOn,
	textLimits,
	undo,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";
import type { SoftwarePath } from "../lib/software-inquiry";

/** The end of a sentence after a quoted text: nothing when the quote already ends one (“…songs first.”, “…show dates?”). */
const endAfter = (text: string) =>
	/[.?!]["”’)]*$/.test(text.trim()) ? "" : ".";

/** How long the visitor stops writing before the board asks. */
const IDLE = 1500;

/** How long the board waits after the visitor's last choice on it (Keep, Not this) before it asks: they may make more. */
const BOARD_IDLE = 8000;

/** The least time between two requests. */
const GAP = 4000;

/** How long to wait after a failed request. */
const BACKOFF = 20000;

/** How long the page waits for an answer (the route gives the model thirty seconds). */
const TIMEOUT = 35000;

/** Failures in a row before the board stops asking for this page. */
const FAILURES = 3;

/** What the board says when it stops asking. The board's AI is "the outline"; "suggestions" are the answer boxes' too. */
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

/** How long after the visitor last touched or scrolled the board a held reply waits before it applies. */
const QUIET = 3000;

/** The fewest words, across the answers, worth interpreting. */
const MIN_WORDS = 6;

export type InterpretAnswer = { status: number; json: RawValue };

export type BriefBoardOptions = {
	readonly root: HTMLElement;
	readonly form: HTMLFormElement;
	readonly path: () => SoftwarePath;
	/** The current written answers, by field name. */
	readonly answers: () => Record<string, string>;
	readonly startPass: (renew?: boolean) => Promise<boolean>;
	/** Whether AI suggestions are on (the answers' "Turn off" switch). */
	readonly aiEnabled: () => boolean;
	/** Whether this deployment interprets at all; when false the board works by hand. */
	readonly live: boolean;
	/** Sends one request; tests and the scripted preview replace it. */
	readonly interpret?: (
		body: string,
		signal: AbortSignal,
	) => Promise<InterpretAnswer>;
	/** Called after any change the brief's review or draft should see. */
	readonly onChange?: () => void;
};

export type BriefBoardHandle = {
	/** Shows the board on a written step and hides it on the others. */
	show(visible: boolean): void;
	pathChanged(): void;
	answersChanged(): void;
	aiChanged(): void;
	/** What goes with the brief: undefined when the board is not in use or holds nothing to send. */
	outline(): OutlineItem[] | undefined;
	/** Whether the visitor chose the plain form. */
	plain(): boolean;
	setPlain(plain: boolean): void;
	/** The brief was sent: the saved boards are forgotten. */
	sent(): void;
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

export function setupBriefBoard(options: BriefBoardOptions): BriefBoardHandle {
	const { root, form } = options;
	const interpret = options.interpret ?? fetchInterpretation;
	const status = root.querySelector<HTMLElement>("[data-board-status]")!;
	const live = root.querySelector<HTMLElement>("[data-board-live]")!;

	const pauseButton =
		root.querySelector<HTMLButtonElement>("[data-board-pause]")!;

	const undoButton =
		root.querySelector<HTMLButtonElement>("[data-board-undo]")!;

	const plainButton =
		root.querySelector<HTMLButtonElement>("[data-board-plain]")!;

	const heldButton =
		root.querySelector<HTMLButtonElement>("[data-board-held]")!;

	const aside = root.querySelector<HTMLDetailsElement>("[data-board-aside]")!;
	const asideList = root.querySelector<HTMLElement>("[data-board-aside-list]")!;

	const asideSummary = root.querySelector<HTMLElement>(
		"[data-board-aside-summary]",
	)!;

	const template = root.querySelector<HTMLTemplateElement>(
		"[data-card-template]",
	)!;

	const heading = root.querySelector<HTMLElement>("#brief-board-title")!;
	const scroller = root.querySelector<HTMLElement>("[data-board-scroll]")!;

	const showButtons = [
		...form.querySelectorAll<HTMLButtonElement>("[data-board-show]"),
	];

	const pulses = [
		...form.querySelectorAll<HTMLAnchorElement>("[data-board-pulse]"),
	];

	type LaneParts = {
		section: HTMLElement;
		title: HTMLElement;
		list: HTMLElement;
		empty: HTMLElement;
		full: HTMLElement;
		add: HTMLButtonElement;
		editor: HTMLElement;
		editorLabel: HTMLElement;
		input: HTMLInputElement;
		save: HTMLButtonElement;
		cancel: HTMLButtonElement;
	};

	// BriefBoard.astro renders every lane with each of these parts; a missing one throws at the first use, as elsewhere.
	const laneParts = (lane: Lane): LaneParts => {
		const section = root.querySelector<HTMLElement>(`[data-lane="${lane}"]`)!;

		return {
			section,
			title: section.querySelector<HTMLElement>("[data-lane-title]")!,
			list: section.querySelector<HTMLElement>("[data-lane-cards]")!,
			empty: section.querySelector<HTMLElement>("[data-lane-empty]")!,
			full: section.querySelector<HTMLElement>("[data-lane-full]")!,
			add: section.querySelector<HTMLButtonElement>("[data-lane-add]")!,
			editor: section.querySelector<HTMLElement>("[data-lane-editor]")!,
			editorLabel: section.querySelector<HTMLElement>(
				"[data-lane-editor-label]",
			)!,
			input: section.querySelector<HTMLInputElement>("[data-lane-input]")!,
			save: section.querySelector<HTMLButtonElement>("[data-lane-save]")!,
			cancel: section.querySelector<HTMLButtonElement>("[data-lane-cancel]")!,
		};
	};

	const lanes: Record<Lane, LaneParts> = {
		purpose: laneParts("purpose"),
		audience: laneParts("audience"),
		parts: laneParts("parts"),
		questions: laneParts("questions"),
	};

	let saved = (() => {
		try {
			return readSavedBoards(
				JSON.parse(localStorage.getItem(BOARD_STORAGE_KEY) ?? "null"),
			);
		} catch {
			return readSavedBoards(null);
		}
	})();

	const boards: Partial<Record<SoftwarePath, Board>> = { ...saved.boards };

	let paused = saved.paused,
		plain = saved.plain,
		visible = false,
		hovering = false,
		// The pointer that last pressed in the board ("mouse", "touch" or "pen"), to tell a mouse press from a tap.
		lastPointer = "",
		// When the visitor last touched or scrolled the board: a finger has no hover, and a phone's cards scroll in a box.
		touchedAt = 0,
		quietTimer: ReturnType<typeof setTimeout> | undefined,
		// Cards the last applied reply added, for the status line: some may be out of view in the board's scrolling box.
		lastAdded = 0,
		stopped = "",
		failures = 0,
		// After a failure, no request before this time, however the visitor writes (the back-off).
		retryAt = 0,
		requests = 0,
		lastSendAt = 0,
		timer: ReturnType<typeof setTimeout> | undefined,
		inFlight: {
			n: number;
			path: SoftwarePath;
			controller: AbortController;
		} | null = null,
		held: {
			n: number;
			path: SoftwarePath;
			cards: ReplyCard[];
			refs: readonly string[];
			changes: number;
		} | null = null,
		lastAnnounced = 0,
		boardChangedAt = 0,
		unsaid = "",
		laterText = "",
		laterTimer: ReturnType<typeof setTimeout> | undefined,
		pendingNews = 0,
		newsTimer: ReturnType<typeof setTimeout> | undefined,
		phase: "idle" | "reading" = "idle";

	const lastSent: Partial<Record<SoftwarePath, string>> = {};
	// Lists the visitor tried to add to, and set-aside cards they tried to bring back, while the list was full: each says
	// why (laneFull) until there is room. Add and Bring back are never disabled, so the reason comes with the press.
	const fullTried = new Set<string>();
	const tried = (key: string) => `${options.path()}:${key}`;
	const nodes = new Map<string, HTMLLIElement>();

	const board = (): Board => (boards[options.path()] ??= emptyBoard());
	const currentAnswers = () => answerText(options.answers(), options.path());

	const persist = () => {
		saved = { boards, paused, plain };

		try {
			localStorage.setItem(
				BOARD_STORAGE_KEY,
				JSON.stringify(savedBoards(saved)),
			);
		} catch {
			/* Storage is optional. */
		}
	};

	const touched = () => Date.now() - touchedAt < QUIET;

	// An editor left open (the visitor clicked into the answer box mid-edit) holds replies, so its card cannot go away.
	const editing = () =>
		[
			...root.querySelectorAll<HTMLElement>(
				"[data-card-editor], [data-lane-editor]",
			),
		].some((editor) => !editor.hidden);

	const interacting = () =>
		hovering || root.contains(document.activeElement) || touched() || editing();

	// ---- Status -------------------------------------------------------------------------------------------------------
	/** Says `text` to screen readers, at most once in four seconds unless `force`; whether it was said. */
	const announce = (text: string, force = false) => {
		const now = Date.now();

		if (!force && now - lastAnnounced < 4000) return false;
		lastAnnounced = now;
		live.textContent = text;

		return true;
	};

	/** What the board is doing, in one line: why it is not asking, or whether it has read the answers as they are now. */
	function statusText(words: number) {
		if (!options.live) return NOT_HERE;

		if (!options.aiEnabled())
			return "Suggestions are off, so the outline is too. You can still add your own notes.";

		if (paused) return "Paused. Your cards stay as they are.";

		if (stopped) return stopped;

		if (phase === "reading") return "Reading your answers…";

		if (failures > 0)
			return "The outline couldn’t update just now. Trying again shortly.";

		if (held) return "Updates are waiting below the cards.";

		if (words < MIN_WORDS)
			return "Write a few sentences and an outline starts here.";

		if (lastSent[options.path()] !== answersKey())
			return "The outline catches up in a moment.";

		return lastAdded > 0
			? `Up to date. ${lastAdded} new ${lastAdded === 1 ? "card" : "cards"} in your brief so far.`
			: "Up to date with your answers.";
	}

	function updateStatus() {
		const words = currentAnswers().split(/\s+/).filter(Boolean).length;

		status.textContent = statusText(words);
		pauseButton.hidden = !options.live || !options.aiEnabled();
		// The label stays the same and aria-pressed says whether it is on, so the row of controls never reflows under a click.
		pauseButton.setAttribute("aria-pressed", String(paused));
		const label = lastAction(board());
		undoButton.disabled = !label;
		undoButton.setAttribute("aria-label", label ? `Undo: ${label}` : "Undo");
		undoButton.title = label ? `Undo: ${label}` : "";
		heldButton.hidden = !held;
		heldButton.textContent = held
			? `Show ${held.changes} ${held.changes === 1 ? "update" : "updates"}`
			: "";

		// Only suggestions wait for the visitor: cards read from the answers go with the brief unless they are removed.
		const fresh = board().cards.filter(
			(card) => card.status === "proposed" && card.basis === "suggested",
		).length;

		for (const pulse of pulses) {
			pulse.hidden = plain || board().cards.length === 0;
			// Short enough for two lines at 200% text on a narrow phone; the name says where it goes.
			pulse.textContent =
				fresh > 0
					? `Review ${fresh} ${fresh === 1 ? "suggestion" : "suggestions"}`
					: "See your brief so far";
			pulse.setAttribute(
				"aria-label",
				fresh > 0
					? `Review ${fresh} ${fresh === 1 ? "suggestion" : "suggestions"} in your brief so far`
					: "See your brief so far",
			);
		}
	}

	// ---- Drawing ------------------------------------------------------------------------------------------------------
	const originLabel = (card: BoardCard, grounded: boolean) =>
		card.status === "wrote"
			? "Your note"
			: card.status === "edited"
				? "Edited by you"
				: card.status === "kept"
					? card.answer
						? "You answered"
						: "You kept this"
					: card.basis === "said"
						? grounded
							? "From your answers"
							: "Your answer changed"
						: card.lane === "questions"
							? "Suggested question"
							: "Suggestion";

	const actionsFor = (card: BoardCard) => {
		const list: [string, string][] = [];

		if (card.status === "proposed") list.push(["keep", "Keep"]);
		list.push(["edit", "Edit"]);

		if (card.lane === "questions")
			list.push(["answer", card.answer ? "Change answer" : "Answer"]);
		list.push(
			card.status === "wrote" ? ["remove", "Remove"] : ["aside", "Not this"],
		);

		return list;
	};

	function drawCard(node: HTMLLIElement, card: BoardCard, answers: string) {
		const grounded = card.basis === "said" && standsOn(card, answers);
		node.dataset.status = card.status;
		node.dataset.basis = card.basis;
		node.dataset.grounded = String(grounded);
		node.querySelector<HTMLElement>("[data-card-origin]")!.textContent =
			originLabel(card, grounded);
		node.querySelector<HTMLElement>("[data-card-text]")!.textContent =
			card.text;
		const quote = node.querySelector<HTMLElement>("[data-card-quote]")!;

		const showQuote =
			card.basis === "said" &&
			card.status !== "edited" &&
			card.status !== "wrote";

		quote.hidden = !showQuote;
		quote.textContent = showQuote
			? `${grounded ? "You wrote" : "You wrote earlier"}: “${card.quote}”`
			: "";
		const reason = node.querySelector<HTMLElement>("[data-card-reason]")!;
		reason.hidden = !(
			card.status === "proposed" &&
			card.basis === "suggested" &&
			card.reason
		);
		reason.textContent = reason.hidden ? "" : `Why: ${card.reason}`;
		const answer = node.querySelector<HTMLElement>("[data-card-answer]")!;
		answer.hidden = !card.answer;
		answer.textContent = card.answer ? `Your answer: ${card.answer}` : "";

		const actions = node.querySelector<HTMLElement>("[data-card-actions]")!;
		const wanted = actionsFor(card);

		const signature = wanted
			.map(([act, label]) => `${act}:${label}:${card.text}`)
			.join("|");

		if (actions.dataset.signature !== signature) {
			const active = document.activeElement;

			const focused =
				active instanceof HTMLElement && actions.contains(active)
					? active.dataset.act
					: undefined;

			actions.replaceChildren(
				...wanted.map(([act, label]) => {
					const button = document.createElement("button");
					button.type = "button";
					button.dataset.act = act;
					button.textContent = label;
					button.setAttribute("aria-label", `${label}: ${card.text}`);

					return button;
				}),
			);
			actions.dataset.signature = signature;

			// A visitor's own action that removed the button they pressed moves focus to the card's first action.
			if (focused)
				(
					actions.querySelector<HTMLElement>(`[data-act="${focused}"]`) ??
					actions.querySelector<HTMLElement>("button")
				)?.focus();
		}
	}

	function render() {
		const current = board();
		const path = options.path();
		const answers = currentAnswers();

		// The nodes of cards that left go first, so a node still in use is never moved in front of a stale one.
		const alive = new Set(
			current.cards
				.filter((card) => card.status !== "dismissed")
				.map((card) => card.id),
		);

		for (const [id, node] of nodes)
			if (!alive.has(id)) {
				node.remove();
				nodes.delete(id);
			}

		for (const lane of LANES) {
			const parts = lanes[lane];
			const full = laneCount(current, lane) >= laneLimits[lane];
			parts.title.textContent = laneLabels[path][lane];
			parts.add.textContent = addLabels[path][lane];
			parts.editorLabel.textContent = addLabels[path][lane];
			parts.input.maxLength = textLimits[lane];

			if (!full) fullTried.delete(tried(lane));
			// Says why a note cannot be added, once the visitor has tried.
			parts.full.hidden = !fullTried.has(tried(lane));
			parts.full.textContent = laneFull(laneLabels[path][lane]);

			const cards = current.cards.filter(
				(card) => card.lane === lane && card.status !== "dismissed",
			);

			let previous: Element | null = null;

			for (const card of cards) {
				let node = nodes.get(card.id);

				if (!node) {
					const clone = template.content.firstElementChild?.cloneNode(true);

					if (!(clone instanceof HTMLLIElement))
						throw new TypeError("The card template must hold one list item.");
					node = clone;
					node.dataset.card = card.id;
					node.classList.add("is-new");
					const added = node;
					setTimeout(() => added.classList.remove("is-new"), 1600);
					nodes.set(card.id, node);
				}

				drawCard(node, card, answers);

				// New cards go after the ones before them. A node already in place is never moved, so focus inside it stays.
				const expected: Element | null = previous
					? previous.nextElementSibling
					: parts.list.firstElementChild;

				if (node.parentElement !== parts.list || expected !== node)
					parts.list.insertBefore(
						node,
						previous ? previous.nextSibling : parts.list.firstChild,
					);

				previous = node;
			}

			parts.empty.hidden = cards.length > 0;
		}

		const dismissed = current.cards.filter(
			(card) => card.status === "dismissed",
		);

		aside.hidden = dismissed.length === 0;
		asideSummary.textContent = `Set aside (${dismissed.length})`;
		asideList.replaceChildren(
			...dismissed.map((card) => {
				const item = document.createElement("li");
				const text = document.createElement("span");
				text.textContent = card.text;
				const back = document.createElement("button");
				back.type = "button";
				back.dataset.bringBack = card.id;
				back.textContent = "Bring back";
				back.setAttribute("aria-label", `Bring back: ${card.text}`);
				item.appendChild(text);
				item.appendChild(document.createTextNode(" "));
				item.appendChild(back);

				if (laneCount(current, card.lane) < laneLimits[card.lane])
					fullTried.delete(tried(card.id));
				else if (fullTried.has(tried(card.id))) {
					const why = document.createElement("span");
					why.className = "board-why";
					why.textContent = ` ${laneFull(laneLabels[path][card.lane])}`;
					item.appendChild(why);
				}

				return item;
			}),
		);
		updateStatus();
	}

	// ---- Changes ------------------------------------------------------------------------------------------------------
	function change(
		next: Board,
		focusAfter?: () => HTMLElement | null | undefined,
	) {
		if (next === board()) return;
		boards[options.path()] = next;
		render();
		persist();
		focusAfter?.()?.focus();
		options.onChange?.();
		// The visitor's choices go with the next request (plan, section 4), after a longer pause than writing.
		boardChangedAt = Date.now();
		schedule();
	}

	function applyHeld(moveFocus: boolean) {
		// A hidden board (another step, the review) applies nothing; the reply waits until it is shown again.
		if (!visible) return;
		const reply = held;
		held = null;

		if (!reply || reply.path !== options.path()) {
			updateStatus();

			return;
		}

		const before = new Set(board().cards.map((card) => card.id));

		const result = applyReply(
			board(),
			reply.cards,
			reply.n,
			currentAnswers(),
			paused || !options.aiEnabled() || plain,
			null,
			reply.refs,
		);

		boards[reply.path] = result.board;
		render();
		persist();
		options.onChange?.();
		// The visitor was told updates were waiting, so they hear that they arrived, even when no card was new.
		news(result.added, result.updated + result.withdrawn);

		if (moveFocus) {
			const first = result.board.cards.find((card) => !before.has(card.id));

			const target = first
				? nodes.get(first.id)?.querySelector<HTMLElement>("button")
				: null;

			(target ?? heading).focus();
		}
	}

	/** Says what a reply changed. A message the four-second throttle holds back is said once the throttle allows. */
	function news(added: number, changed = 0) {
		lastAdded = added;
		updateStatus();
		pendingNews += added;

		if (pendingNews <= 0 && changed <= 0) return;

		const say = () => {
			const text =
				pendingNews > 0
					? `${pendingNews} new ${pendingNews === 1 ? "card" : "cards"} in your brief so far.`
					: "Your brief so far was updated.";

			if (announce(text)) pendingNews = 0;
			else {
				clearTimeout(newsTimer);
				newsTimer = setTimeout(say, lastAnnounced + 4050 - Date.now());
			}
		};

		say();
	}

	function deliver(
		path: SoftwarePath,
		n: number,
		cards: ReplyCard[],
		refs: readonly string[],
	) {
		if (path !== options.path() || paused || plain || !options.aiEnabled())
			return;

		const preview = applyReply(
			board(),
			cards,
			n,
			currentAnswers(),
			false,
			null,
			refs,
		);

		const changes = preview.added + preview.updated + preview.withdrawn;

		if (changes > 0 && (interacting() || !visible)) {
			// Nothing is said for a hidden board: the visitor is on another step.
			if (!held && visible)
				announce(
					`${changes} ${changes === 1 ? "update is" : "updates are"} waiting below the cards.`,
					true,
				);

			if (!held || n > held.n) held = { n, path, cards, refs, changes };
			updateStatus();

			return;
		}

		held = null;
		boards[path] = preview.board;
		render();
		persist();

		if (changes > 0) options.onChange?.();
		news(preview.added);
	}

	// ---- Requests -----------------------------------------------------------------------------------------------------
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
		options.live &&
		visible &&
		!plain &&
		!paused &&
		options.aiEnabled() &&
		!stopped &&
		requests < REQUESTS_PER_PAGE &&
		currentAnswers().split(/\s+/).filter(Boolean).length >= MIN_WORDS;

	function schedule(delay = IDLE) {
		clearTimeout(timer);
		updateStatus();

		if (!canAsk() || lastSent[options.path()] === answersKey()) return;
		timer = setTimeout(
			ask,
			Math.max(
				delay,
				lastSendAt + GAP - Date.now(),
				retryAt - Date.now(),
				// The visitor may still be making choices on the board.
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
			updateStatus();

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
		inFlight = { n, path, controller };
		lastSent[path] = key;
		lastSendAt = Date.now();
		requests++;
		phase = "reading";
		updateStatus();
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
			// An aborted request (Pause, the plain form, another path) was never answered, so it is asked again later.
			delete lastSent[path];

			if (!controller.signal.aborted) failures++;
			else retry = IDLE;
		} finally {
			if (inFlight?.controller === controller) inFlight = null;
			phase = "idle";

			if (failures >= FAILURES && !stopped) stop(NOT_NOW);

			if (requests >= REQUESTS_PER_PAGE && !stopped) stop(PAGE_LIMIT, true);
			updateStatus();
			retryAt = failures > 0 ? Date.now() + retry : 0;
			schedule();
		}
	}

	/**
	 * Stops asking for this page, and says why to everyone, screen reader users included. `later` waits for what the last
	 * reply's arrival said to be heard first.
	 */
	function stop(why: string, later = false) {
		stopped = why;

		// A board that is paused, hidden, plain or off hears it when it is back (sayUnsaid).
		if (paused || plain || !visible || !options.aiEnabled()) unsaid = why;
		else if (later) sayWhenFree(why);
		else announce(why, true);
	}

	/** Says `text` once four seconds have passed since the last thing said, after any arrival message still waiting. */
	function sayWhenFree(text: string) {
		clearTimeout(laterTimer);
		laterText = "";

		// Nothing is said about a board that is paused, hidden, set aside for the plain form or off; it is said when the
		// board is back (sayUnsaid).
		if (paused || plain || !visible || !options.aiEnabled()) {
			unsaid = text;

			return;
		}

		const wait = lastAnnounced + 4050 - Date.now();

		if (wait <= 0 && pendingNews <= 0 && announce(text)) return;
		laterText = text;
		laterTimer = setTimeout(() => sayWhenFree(text), Math.max(wait, 200));
	}

	/** Says a stop the visitor did not hear because the board was paused, hidden, plain or off. */
	function sayUnsaid() {
		const text = unsaid;
		unsaid = "";

		if (text) sayWhenFree(text);
	}

	/** Drops messages still waiting for the throttle: the board they were about is paused, hidden or plain. */
	function quietNews() {
		clearTimeout(newsTimer);
		clearTimeout(laterTimer);
		pendingNews = 0;

		// A stop still waiting to be said is said when the board is back.
		if (laterText) unsaid = laterText;
		laterText = "";
	}

	function stopAsking() {
		clearTimeout(timer);
		inFlight?.controller.abort();
		inFlight = null;
		phase = "idle";
		quietNews();

		// The answers it was for were never shown to the visitor, so they are asked about again once asking resumes.
		if (held) delete lastSent[held.path];
		held = null;
	}

	// ---- The visitor's actions ----------------------------------------------------------------------------------------
	const cardNode = (id: string) => nodes.get(id);

	function openEditor(id: string, mode: "edit" | "answer") {
		const node = cardNode(id);
		const card = board().cards.find((c) => c.id === id);

		if (!node || !card) return;
		const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;
		const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;
		editor.dataset.mode = mode;
		node.querySelector<HTMLElement>("[data-card-editor-label]")!.textContent =
			mode === "edit" ? `Edit “${card.text}”` : `Your answer to “${card.text}”`;
		input.maxLength = mode === "edit" ? textLimits[card.lane] : ANSWER_MAX;
		input.value = mode === "edit" ? card.text : card.answer;
		editor.hidden = false;
		input.focus();
		input.select();
	}

	function closeEditor(id: string, save: boolean) {
		const node = cardNode(id);

		if (!node) return;
		const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;
		const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;
		const mode = editor.dataset.mode === "answer" ? "answer" : "edit";
		editor.hidden = true;

		const back = () =>
			cardNode(id)?.querySelector<HTMLElement>(`[data-act="${mode}"]`) ??
			cardNode(id)?.querySelector<HTMLElement>("button");

		if (!save) {
			back()?.focus();

			return;
		}

		change(
			mode === "edit"
				? editCard(board(), id, input.value)
				: answerCard(board(), id, input.value),
			back,
		);
		back()?.focus();
	}

	/** Where focus goes when the card holding it leaves the lane: the next card, the one before, or the lane's Add. */
	function focusNear(id: string, lane: Lane) {
		const node = cardNode(id);

		const next = node?.nextElementSibling ?? node?.previousElementSibling;

		return () =>
			(next instanceof HTMLElement
				? next.querySelector<HTMLElement>("button")
				: null) ?? lanes[lane].add;
	}

	root.addEventListener("click", (event) => {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("button")
				: null;

		if (!target || !root.contains(target)) return;
		const node = target.closest<HTMLElement>("[data-card]");
		const id = node?.dataset.card;
		const card = id ? board().cards.find((c) => c.id === id) : undefined;

		if (target.dataset.act && id && card) {
			switch (target.dataset.act) {
				case "keep":
					change(keepCard(board(), id));
					announce(`Kept “${card.text}”${endAfter(card.text)}`, true);

					break;
				case "edit":
				case "answer":
					openEditor(id, target.dataset.act);

					break;
				case "aside":
					change(setAside(board(), id), focusNear(id, card.lane));
					announce(
						`Set aside “${card.text}”${endAfter(card.text)} Undo or Bring back restores it.`,
						true,
					);

					break;
				case "remove":
					change(removeNote(board(), id), focusNear(id, card.lane));
					announce(
						`Removed “${card.text}”${endAfter(card.text)} Undo brings it back.`,
						true,
					);

					break;
			}

			return;
		}

		if (target.matches("[data-card-save]") && id) closeEditor(id, true);
		else if (target.matches("[data-card-cancel]") && id) closeEditor(id, false);
		else if (target.dataset.bringBack) {
			const backId = target.dataset.bringBack;
			const back = board().cards.find((c) => c.id === backId);
			const next = bringBack(board(), backId);

			// The card's list is full: say so beside the button and to screen readers; focus stays on the button.
			if (next === board()) {
				fullTried.add(tried(backId));
				render();
				asideList
					.querySelector<HTMLElement>(`[data-bring-back="${backId}"]`)
					?.focus();

				if (back)
					announce(laneFull(laneLabels[options.path()][back.lane]), true);

				return;
			}

			change(next, () =>
				cardNode(backId)?.querySelector<HTMLElement>("button"),
			);

			if (back)
				announce(`Brought back “${back.text}”${endAfter(back.text)}`, true);
		}
	});

	root.addEventListener("keydown", (event) => {
		const input =
			event.target instanceof HTMLInputElement ? event.target : null;

		const id = input?.closest<HTMLElement>("[data-card]")?.dataset.card;

		if (input?.matches("[data-card-input]") && id) {
			if (event.key === "Enter") {
				event.preventDefault();
				closeEditor(id, true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeEditor(id, false);
			}

			return;
		}

		if (
			(event.ctrlKey || event.metaKey) &&
			!event.shiftKey &&
			event.key.toLowerCase() === "z" &&
			!input
		) {
			event.preventDefault();
			undoLast();
		}
	});

	function undoLast() {
		const label = lastAction(board());

		if (!label) return;
		const fromUndo = document.activeElement === undoButton;
		const before = board();
		const after = undo(before);

		// Open cards Undo had to withdraw to keep a list within its limit (see undo in src/lib/brief-board.ts).
		const withdrawn = before.cards.filter(
			(card) =>
				card.status === "proposed" &&
				!after.cards.some((other) => other.id === card.id),
		);

		change(after, () => {
			// Undo can remove the card that held focus, or disable itself when nothing is left to undo; focus then goes to
			// Undo, or to the heading.
			const active = document.activeElement;

			const lost =
				active === document.body ||
				!active?.isConnected ||
				(fromUndo && undoButton.disabled);

			if (!lost) return null;

			return undoButton.disabled ? heading : undoButton;
		});
		announce(
			withdrawn.length
				? `Undid: ${label}${endAfter(label)} ${withdrawn.map((card) => `“${card.text}”`).join(", ")} left the list to keep it within its limit.`
				: `Undid: ${label}${endAfter(label)}`,
			true,
		);
	}

	/**
	 * Brings an element into view unless a mouse pressed the button just now: a mouse would have the button it pressed
	 * moved from under it, while a finger or the keyboard has nothing under a pointer to move. Decided by the press, not
	 * the device, so a keyboard on a laptop and a finger on a touch laptop both see the reason.
	 */
	const revealUnlessMouse = (element: HTMLElement, event?: Event) => {
		const byMouse =
			event instanceof MouseEvent &&
			event.detail > 0 &&
			lastPointer === "mouse";

		if (!byMouse) element.scrollIntoView({ block: "nearest" });
	};

	for (const lane of LANES) {
		const parts = lanes[lane];

		const close = (save: boolean, event?: Event) => {
			if (save && parts.input.value.trim()) {
				const next = addNote(board(), lane, parts.input.value);

				// The list filled while the visitor typed: keep their words, and say what to do.
				if (next === board()) {
					fullTried.add(tried(lane));
					render();
					announce(laneFull(laneLabels[options.path()][lane]), true);
					parts.input.focus();
					// The reason below the editor can be out of sight in the scrolling box.
					revealUnlessMouse(parts.full, event);

					return;
				}

				change(next);
			}

			parts.input.value = "";
			parts.editor.hidden = true;
			parts.add.hidden = false;
			parts.add.focus();
		};

		parts.add.addEventListener("click", (event) => {
			// A full list says why instead of opening the box; focus stays on Add.
			if (laneCount(board(), lane) >= laneLimits[lane]) {
				fullTried.add(tried(lane));
				render();
				announce(laneFull(laneLabels[options.path()][lane]), true);
				// The reason below Add can be out of sight in the scrolling box. A mouse keeps Add still.
				revealUnlessMouse(parts.full, event);

				return;
			}

			parts.add.hidden = true;
			parts.editor.hidden = false;
			parts.input.focus();
		});
		parts.save.addEventListener("click", (event) => close(true, event));
		parts.cancel.addEventListener("click", () => close(false));
		parts.input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				close(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				close(false);
			}
		});
	}

	undoButton.addEventListener("click", undoLast);
	pauseButton.addEventListener("click", () => {
		paused = !paused;

		if (paused) stopAsking();
		persist();

		// Resuming a board that has stopped asking says why, not that it resumed.
		if (!paused && stopped) {
			unsaid = "";
			announce(stopped, true);
		} else announce(paused ? "Outline paused." : "Outline resumed.", true);
		schedule();
	});
	plainButton.addEventListener("click", () => {
		handle.setPlain(true);
		// Focus goes to the step's own "Show the outline", or to the step's heading.
		(
			showButtons.find((button) => !button.closest("[hidden]")) ??
			form.querySelector<HTMLElement>("[data-step]:not([hidden]) h1")
		)?.focus();
	});
	heldButton.addEventListener("click", () => applyHeld(true));
	showButtons.forEach((button) =>
		button.addEventListener("click", () => {
			handle.setPlain(false);
			heading.focus();
		}),
	);

	// Held replies apply once the visitor is out of the board.
	root.addEventListener("focusout", () => {
		// Decided on the next tick, from where focus is then: drawing the board can remove the focused button and move
		// focus to its neighbour, which fires focusout with no target although the visitor never left.
		setTimeout(() => {
			if (held && !interacting()) applyHeld(false);
		}, 0);
	});

	// A finger on the board, or the board's cards scrolling, holds replies until the board has been still for a moment.
	const noteTouch = () => {
		touchedAt = Date.now();
		clearTimeout(quietTimer);
		quietTimer = setTimeout(() => {
			if (held && !interacting()) applyHeld(false);
		}, QUIET + 50);
	};

	root.addEventListener("pointerdown", (event) => {
		lastPointer = event.pointerType;

		if (event.pointerType === "touch") noteTouch();
	});
	// The visitor scrolling the cards, by wheel or finger. A scroll the page makes itself (moving focus) does not count.
	scroller.addEventListener("wheel", noteTouch, { passive: true });
	scroller.addEventListener("touchmove", noteTouch, { passive: true });
	root.addEventListener("pointerenter", (event) => {
		if (event.pointerType === "mouse" || event.pointerType === "pen")
			hovering = true;
	});
	root.addEventListener("pointerleave", () => {
		hovering = false;

		if (held && !interacting()) applyHeld(false);
	});

	const handle: BriefBoardHandle = {
		show(next) {
			visible = next;
			root.hidden = !next || plain;
			showButtons.forEach((button) => (button.hidden = !plain));

			if (!next) {
				hovering = false;
				clearTimeout(timer);
				quietNews();
				// A request in flight is aborted and asked again later; a reply already waiting is kept for when it shows.
				inFlight?.controller.abort();
				inFlight = null;
				phase = "idle";
			} else {
				render();

				if (held && !interacting()) applyHeld(false);
				sayUnsaid();
				schedule();
			}
		},
		pathChanged() {
			stopAsking();
			render();
			schedule();
		},
		answersChanged() {
			// The drawn cards follow the answers at once ("Your answer changed"); the request waits for a pause.
			if (visible && !plain) render();
			schedule();
		},
		aiChanged() {
			if (!options.aiEnabled()) stopAsking();
			else sayUnsaid();
			render();
			schedule();
		},
		outline() {
			if (plain) return undefined;
			const items = briefOutline(board(), currentAnswers());

			return items.length ? items : undefined;
		},
		plain: () => plain,
		setPlain(next) {
			plain = next;
			quietNews();

			if (plain) stopAsking();
			persist();
			handle.show(visible);
			options.onChange?.();
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

	render();

	return handle;
}
