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
	keepCard,
	laneCount,
	laneLabels,
	laneLimits,
	lastAction,
	quotedFrom,
	readBoardAnswer,
	readReply,
	readSavedBoards,
	removeNote,
	savedBoards,
	sendRequest,
	setAside,
	textLimits,
	undo,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";
import type { SoftwarePath } from "../lib/software-inquiry";

/** How long the visitor stops writing before the board asks. */
const IDLE = 1500;

/** The least time between two requests. */
const GAP = 4000;

/** How long to wait after a failed request. */
const BACKOFF = 20000;

/** How long the page waits for an answer (the route gives the model eight seconds). */
const TIMEOUT = 12000;

/** Failures in a row before the board stops asking for this page. */
const FAILURES = 3;

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

const fetchInterpretation = async (
	body: string,
	signal: AbortSignal,
): Promise<InterpretAnswer> => {
	const response = await fetch("/api/software/brief/board", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
		signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
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
			changes: number;
		} | null = null,
		lastAnnounced = 0,
		pendingNews = 0,
		phase: "idle" | "reading" = "idle";

	const lastSent: Partial<Record<SoftwarePath, string>> = {};
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

	const interacting = () =>
		hovering || root.contains(document.activeElement) || touched();

	// ---- Status -------------------------------------------------------------------------------------------------------
	const announce = (text: string, force = false) => {
		const now = Date.now();

		if (!force && now - lastAnnounced < 4000) return;
		lastAnnounced = now;
		live.textContent = text;
	};

	/** What the board is doing, in one line: why it is not asking, or whether it has read the answers as they are now. */
	function statusText(words: number) {
		if (!options.live)
			return "Suggestions aren’t available here. You can add your own notes.";

		if (!options.aiEnabled())
			return "Suggestions are off. You can still add your own notes.";

		if (paused) return "Paused. Your cards stay as they are.";

		if (stopped) return stopped;

		if (phase === "reading") return "Reading your answers…";

		if (failures > 0)
			return "Couldn’t read your answers just now. Trying again shortly.";

		if (held) return "Updates are waiting below.";

		if (words < MIN_WORDS)
			return "Write a few sentences and an outline starts here.";

		if (lastSent[options.path()] !== answersKey())
			return "Keep writing. The outline catches up when you pause.";

		return lastAdded > 0
			? `Up to date. ${lastAdded} new ${lastAdded === 1 ? "card" : "cards"} in the board.`
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

		const fresh = board().cards.filter(
			(card) => card.status === "proposed",
		).length;

		for (const pulse of pulses) {
			pulse.hidden = plain || board().cards.length === 0;
			pulse.textContent =
				fresh > 0
					? `Your brief so far: ${fresh} to review`
					: "See your brief so far";
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
		const grounded = card.basis === "said" && quotedFrom(card.quote, answers);
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
		quote.textContent = showQuote ? `You wrote: “${card.quote}”` : "";
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
		const alive = new Set<string>();

		for (const lane of LANES) {
			const parts = lanes[lane];
			parts.title.textContent = laneLabels[path][lane];
			parts.add.textContent = addLabels[path][lane];
			parts.editorLabel.textContent = addLabels[path][lane];
			parts.input.maxLength = textLimits[lane];
			parts.add.disabled = laneCount(current, lane) >= laneLimits[lane];

			const cards = current.cards.filter(
				(card) => card.lane === lane && card.status !== "dismissed",
			);

			let previous: Element | null = null;

			for (const card of cards) {
				alive.add(card.id);
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

		for (const [id, node] of nodes)
			if (!alive.has(id)) {
				node.remove();
				nodes.delete(id);
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
				back.disabled = laneCount(current, card.lane) >= laneLimits[card.lane];
				item.appendChild(text);
				item.appendChild(document.createTextNode(" "));
				item.appendChild(back);

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
	}

	function applyHeld(moveFocus: boolean) {
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
		);

		boards[reply.path] = result.board;
		render();
		persist();
		options.onChange?.();
		news(result.added);

		if (moveFocus) {
			const first = result.board.cards.find((card) => !before.has(card.id));

			const target = first
				? nodes.get(first.id)?.querySelector<HTMLElement>("button")
				: null;

			(target ?? heading).focus();
		}
	}

	function news(added: number) {
		lastAdded = added;
		updateStatus();

		if (added <= 0) return;
		pendingNews += added;
		announce(
			`${pendingNews} new ${pendingNews === 1 ? "card" : "cards"} in your brief so far.`,
		);
		pendingNews = 0;
	}

	function deliver(path: SoftwarePath, n: number, cards: ReplyCard[]) {
		if (path !== options.path() || paused || plain || !options.aiEnabled())
			return;
		const preview = applyReply(board(), cards, n, currentAnswers(), false);
		const changes = preview.added + preview.updated + preview.withdrawn;

		if (changes > 0 && interacting()) {
			if (!held || n > held.n) held = { n, path, cards, changes };
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
	const answersKey = () => JSON.stringify([options.path(), options.answers()]);

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
			Math.max(delay, lastSendAt + GAP - Date.now(), retryAt - Date.now()),
		);
	}

	async function ask() {
		if (!canAsk() || inFlight) return;
		const key = answersKey();
		const path = options.path();

		if (lastSent[path] === key) return;

		if (!(await options.startPass())) {
			stopped =
				"Suggestions aren’t available right now. You can add your own notes.";
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
			cards: boardContext(next),
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

			const cards =
				answer.status === 200 && read.cards !== undefined
					? readReply(read.cards, answerText(options.answers(), path))
					: null;

			if (cards) {
				failures = 0;
				deliver(path, n, cards);
			} else if (answer.status === 429 || read.reason === "limit") {
				stopped =
					"Suggestions reached today’s limit. You can still add your own notes.";
			} else if (answer.status === 403 || read.reason === "off") {
				stopped =
					"Suggestions aren’t available here. You can add your own notes.";
			} else {
				failures++;
				// A request that failed is asked again once the visitor writes or the back-off ends.
				delete lastSent[path];
			}
		} catch {
			if (!controller.signal.aborted) {
				failures++;
				delete lastSent[path];
			} else retry = IDLE;
		} finally {
			if (inFlight?.controller === controller) inFlight = null;
			phase = "idle";

			if (failures >= FAILURES)
				stopped =
					"Suggestions aren’t available right now. You can add your own notes.";
			updateStatus();
			retryAt = failures > 0 ? Date.now() + retry : 0;
			schedule();
		}
	}

	function stopAsking() {
		clearTimeout(timer);
		inFlight?.controller.abort();
		inFlight = null;
		phase = "idle";
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

					break;
				case "edit":
				case "answer":
					openEditor(id, target.dataset.act);

					break;
				case "aside":
					change(setAside(board(), id), focusNear(id, card.lane));
					announce(
						`Set aside “${card.text}”. Undo or Bring back restores it.`,
						true,
					);

					break;
				case "remove":
					change(removeNote(board(), id), focusNear(id, card.lane));

					break;
			}

			return;
		}

		if (target.matches("[data-card-save]") && id) closeEditor(id, true);
		else if (target.matches("[data-card-cancel]") && id) closeEditor(id, false);
		else if (target.dataset.bringBack) {
			const backId = target.dataset.bringBack;
			change(bringBack(board(), backId), () =>
				cardNode(backId)?.querySelector<HTMLElement>("button"),
			);
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
		change(undo(board()));
		announce(`Undid: ${label}.`, true);
	}

	for (const lane of LANES) {
		const parts = lanes[lane];

		const close = (save: boolean) => {
			if (save) change(addNote(board(), lane, parts.input.value));
			parts.input.value = "";
			parts.editor.hidden = true;
			parts.add.hidden = false;
			parts.add.focus();
		};

		parts.add.addEventListener("click", () => {
			parts.add.hidden = true;
			parts.editor.hidden = false;
			parts.input.focus();
		});
		parts.save.addEventListener("click", () => close(true));
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
		announce(paused ? "Suggestions paused." : "Suggestions resumed.", true);
		schedule();
	});
	plainButton.addEventListener("click", () => {
		handle.setPlain(true);
		showButtons.find((button) => !button.closest("[hidden]"))?.focus();
	});
	heldButton.addEventListener("click", () => applyHeld(true));
	showButtons.forEach((button) =>
		button.addEventListener("click", () => {
			handle.setPlain(false);
			heading.focus();
		}),
	);

	// Held replies apply once the visitor is out of the board.
	root.addEventListener("focusout", (event) => {
		const to = event.relatedTarget;

		if (
			held &&
			!(to instanceof Node && root.contains(to)) &&
			!hovering &&
			!touched()
		)
			applyHeld(false);
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
		if (event.pointerType === "touch") noteTouch();
	});
	scroller.addEventListener("scroll", noteTouch, { passive: true });
	root.addEventListener("pointerenter", (event) => {
		if (event.pointerType === "mouse" || event.pointerType === "pen")
			hovering = true;
	});
	root.addEventListener("pointerleave", () => {
		hovering = false;

		if (held && !root.contains(document.activeElement) && !touched())
			applyHeld(false);
	});

	const handle: BriefBoardHandle = {
		show(next) {
			visible = next;
			root.hidden = !next || plain;
			showButtons.forEach((button) => (button.hidden = !plain));

			if (!next) {
				hovering = false;
				clearTimeout(timer);
			} else {
				render();
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
