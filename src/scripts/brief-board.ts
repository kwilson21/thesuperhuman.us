// The outline's four lane screens in the page (docs/plans/2026-11-living-brief.md). Each is one step of the brief: the
// lane's question, its cards, Add, its set-aside list, Undo and "Skip these, no AI outline". What a reply may change, when
// the page asks and what is saved are in src/scripts/brief-board-core.ts and src/lib/brief-board.ts; this file draws the
// screens from them, handles the visitor's actions and keeps one promise: every card is drawn in place, a card's node is
// kept while the card lives, so a focused button is never replaced.
import {
	ANSWER_MAX,
	type Board,
	type BoardCard,
	LANES,
	type Lane,
	addLabels,
	answerText,
	editCard,
	answerCard,
	keepCard,
	laneScreen,
	editOnLeaving,
	noteOnLeaving,
	removeNote,
	setAside,
	standsOn,
	textLimits,
} from "../lib/brief-board";
import {
	type BoardCoreOptions,
	type BriefBoardHandle,
	createBriefBoardCore,
} from "./brief-board-core";

export type BriefBoardOptions = BoardCoreOptions & {
	/** The brief's form, which holds the lane screens. */
	readonly form: HTMLFormElement;
};

/** The end of a sentence after a quoted text: nothing when the quote already ends one (“…songs first.”, “…show dates?”). */
const endAfter = (text: string) =>
	/[.?!]["”’)]*$/.test(text.trim()) ? "" : ".";

export function setupBriefBoard(options: BriefBoardOptions): BriefBoardHandle {
	const { form } = options;
	const live = form.querySelector<HTMLElement>("[data-board-live]")!;

	const template = form.querySelector<HTMLTemplateElement>(
		"[data-card-template]",
	)!;

	type LaneParts = {
		section: HTMLElement;
		title: HTMLElement;
		hint: HTMLElement;
		status: HTMLElement;
		region: HTMLElement;
		list: HTMLElement;
		full: HTMLElement;
		add: HTMLButtonElement;
		editor: HTMLElement;
		editorLabel: HTMLElement;
		input: HTMLInputElement;
		save: HTMLButtonElement;
		cancel: HTMLButtonElement;
		aside: HTMLDetailsElement;
		asideSummary: HTMLElement;
		asideList: HTMLElement;
		undo: HTMLButtonElement;
		skip: HTMLButtonElement;
	};

	// BriefBoard.astro renders every lane screen with each of these parts; a missing one throws at the first use, as elsewhere.
	const laneParts = (lane: Lane): LaneParts => {
		const section = form.querySelector<HTMLElement>(
			`[data-lane-screen="${lane}"]`,
		)!;

		const part = <T extends HTMLElement>(selector: string) =>
			section.querySelector<T>(selector)!;

		return {
			section,
			title: part("[data-lane-title]"),
			hint: part("[data-lane-hint]"),
			status: part("[data-lane-status]"),
			region: part("[data-lane-region]"),
			list: part("[data-lane-cards]"),
			full: part("[data-lane-full]"),
			add: part("[data-lane-add]"),
			editor: part("[data-lane-editor]"),
			editorLabel: part("[data-lane-editor-label]"),
			input: part("[data-lane-input]"),
			save: part("[data-lane-save]"),
			cancel: part("[data-lane-cancel]"),
			aside: part("[data-lane-aside]"),
			asideSummary: part("[data-lane-aside-summary]"),
			asideList: part("[data-lane-aside-list]"),
			undo: part("[data-board-undo]"),
			skip: part("[data-board-skip]"),
		};
	};

	const lanes: Record<Lane, LaneParts> = {
		audience: laneParts("audience"),
		parts: laneParts("parts"),
		questions: laneParts("questions"),
	};

	// The lane screen showing, if one is.
	const shown = () => LANES.find((lane) => !lanes[lane].section.hidden);

	// Lists the visitor's last pointer, to tell a mouse press from a tap (see revealUnlessMouse).
	let lastPointer = "";

	const nodes = new Map<string, HTMLLIElement>();

	// Whether the screens were last drawn by hand; the first drawing sets the fields up for whichever it is.
	let wasByHand: boolean | undefined;

	const core = createBriefBoardCore({ ...options, onRender: render });

	const currentAnswers = () => answerText(options.answers(), options.path());

	/** Says `text` to screen readers. */
	let announcing: ReturnType<typeof setTimeout> | undefined;

	const announce = (text: string) => {
		// Cleared first and set a moment later, in another task, so the same sentence said twice is read twice; the
		// newest sentence always lands.
		clearTimeout(announcing);
		live.textContent = "";
		announcing = setTimeout(() => {
			live.textContent = text;
		}, 50);
	};

	// ---- Drawing ------------------------------------------------------------------------------------------------------
	const originLabel = (
		card: BoardCard,
		grounded: boolean,
		ownLabel: boolean,
	) =>
		card.status === "wrote"
			? ownLabel
				? "Your note"
				: ""
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

	function drawCard(
		node: HTMLLIElement,
		card: BoardCard,
		answers: string,
		ownLabel: boolean,
	) {
		const grounded = card.basis === "said" && standsOn(card, answers);
		node.dataset.status = card.status;
		node.dataset.basis = card.basis;
		node.dataset.grounded = String(grounded);
		const origin = node.querySelector<HTMLElement>("[data-card-origin]")!;
		origin.textContent = originLabel(card, grounded, ownLabel);
		// A visitor's note in a lane of their own notes carries no label, so no empty line is left in the card.
		origin.hidden = !origin.textContent;
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
		const current = core.board();
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

		const undoLabel = core.undoLabel();
		const byHand = core.byHand();

		// When the lane screens change between working with the AI and by hand, the open field is put back as that mode has it.
		const modeChanged = byHand !== wasByHand;
		wasByHand = byHand;

		for (const lane of LANES) {
			const parts = lanes[lane];

			const screen = laneScreen({
				path,
				lane,
				board: current,
				byHand,
				undoLabel,
				answers,
			});

			parts.title.textContent = screen.heading;
			parts.add.textContent = addLabels[path][lane];
			parts.editorLabel.textContent = addLabels[path][lane];
			parts.input.maxLength = textLimits[lane];
			parts.input.placeholder = screen.placeholder;
			parts.skip.hidden = !screen.skipLink;

			// By hand the field stays open for the next note; with the AI on it opens from the lane's "Add".
			// A field that holds words is never cleared by the change, and stays open for them.
			if (modeChanged) {
				const holds = parts.input.value.trim() !== "";
				const onAdd = document.activeElement === parts.add;

				if (!holds) parts.input.value = "";
				parts.editor.hidden = !(screen.fieldOpen || holds);
				parts.add.hidden = screen.fieldOpen || holds;

				// The lane's Add link had focus and is gone: focus goes to the open field.
				if (onAdd && parts.add.hidden) parts.input.focus();
			}

			parts.cancel.hidden = screen.fieldOpen;

			// By hand the field and its Add button are one bordered control, and the field's label is read but not shown: the heading and
			// hint already say what to type. A lane of the visitor's own notes lists them as compact rows.
			parts.editor.classList.toggle("board-editor-inline", screen.fieldOpen);
			parts.editorLabel.classList.toggle("sr-only", screen.fieldOpen);
			parts.list.classList.toggle("board-cards-rows", !screen.ownLabel);

			// Says why a note cannot be added, once the visitor has tried.
			const full = core.fullNote(lane);
			parts.full.hidden = !full;
			parts.full.textContent = full;

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

				drawCard(node, card, answers, screen.ownLabel);

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

			parts.region.hidden = cards.length === 0;
			parts.hint.textContent = screen.hint;

			// The line is read aloud when it changes, so it is set only when it says something different.
			const line = core.statusLine(lane);

			if (parts.status.textContent !== line) parts.status.textContent = line;

			const dismissed = current.cards.filter(
				(card) => card.lane === lane && card.status === "dismissed",
			);

			parts.aside.hidden = dismissed.length === 0;
			parts.asideSummary.textContent = `Set aside (${dismissed.length})`;
			parts.asideList.replaceChildren(
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

					// A list that is full says why beside the button the visitor pressed.
					const why = core.fullNoteFor(card);

					if (why) {
						const reason = document.createElement("span");
						reason.className = "board-why";
						reason.textContent = ` ${why}`;
						item.appendChild(reason);
					}

					return item;
				}),
			);

			// Undo is the whole board's last action; its name says what it will undo.
			parts.undo.hidden = !screen.undoShown;
			parts.undo.disabled = !undoLabel;
			parts.undo.setAttribute(
				"aria-label",
				undoLabel ? `Undo: ${undoLabel}` : "Undo",
			);
			parts.undo.title = undoLabel ? `Undo: ${undoLabel}` : "";
		}
	}

	// ---- The visitor's actions ----------------------------------------------------------------------------------------
	const cardNode = (id: string) => nodes.get(id);

	/** Makes `next` the board, then puts focus where `focusAfter` says. */
	function change(
		next: Board,
		focusAfter?: () => HTMLElement | null | undefined,
	) {
		core.change(next);
		focusAfter?.()?.focus();
	}

	function openEditor(id: string, mode: "edit" | "answer") {
		const node = cardNode(id);
		const card = core.board().cards.find((c) => c.id === id);

		if (!node || !card) return;
		const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;
		const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;
		editor.dataset.mode = mode;
		node.querySelector<HTMLElement>("[data-card-editor-label]")!.textContent =
			mode === "edit" ? `Edit “${card.text}”` : `Your answer to “${card.text}”`;
		input.maxLength = mode === "edit" ? textLimits[card.lane] : ANSWER_MAX;
		input.value = mode === "edit" ? card.text : card.answer;
		// What the editor opened with: leaving applies the editor only if its words differ from these.
		editor.dataset.opened = input.value;
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
				? editCard(core.board(), id, input.value)
				: answerCard(core.board(), id, input.value),
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

	function undoLast() {
		const fromUndo = document.activeElement?.matches("[data-board-undo]");
		const result = core.undoLast();

		if (!result) return;

		// Undo can remove the card that held focus, or disable itself when nothing is left to undo; focus then goes to
		// Undo, or to the lane screen's heading.
		const active = document.activeElement;
		const lane = shown();

		const lost =
			active === document.body ||
			!active?.isConnected ||
			(fromUndo && !core.undoLabel());

		if (lane && lost)
			(core.undoLabel() ? lanes[lane].undo : lanes[lane].title).focus();

		const { label, withdrawn } = result;

		announce(
			withdrawn.length
				? `Undid: ${label}${endAfter(label)} ${withdrawn.map((card) => `“${card.text}”`).join(", ")} left the list to keep it within its limit.`
				: `Undid: ${label}${endAfter(label)}`,
		);
	}

	form.addEventListener("click", (event) => {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("button")
				: null;

		if (!target || !target.closest("[data-lane-screen]")) return;
		const node = target.closest<HTMLElement>("[data-card]");
		const id = node?.dataset.card;
		const card = id ? core.board().cards.find((c) => c.id === id) : undefined;

		if (target.matches("[data-board-undo]")) {
			undoLast();

			return;
		}

		if (target.dataset.act && id && card) {
			switch (target.dataset.act) {
				case "keep":
					change(keepCard(core.board(), id));
					announce(`Kept “${card.text}”${endAfter(card.text)}`);

					break;
				case "edit":
				case "answer":
					openEditor(id, target.dataset.act);

					break;
				case "aside":
					change(setAside(core.board(), id), focusNear(id, card.lane));
					announce(
						`Set aside “${card.text}”${endAfter(card.text)} Undo or Bring back restores it.`,
					);

					break;
				case "remove":
					change(removeNote(core.board(), id), focusNear(id, card.lane));
					announce(
						`Removed “${card.text}”${endAfter(card.text)} Undo brings it back.`,
					);

					break;
			}

			return;
		}

		if (target.matches("[data-card-save]") && id) closeEditor(id, true);
		else if (target.matches("[data-card-cancel]") && id) closeEditor(id, false);
		else if (target.dataset.bringBack) {
			const backId = target.dataset.bringBack;
			const back = core.board().cards.find((c) => c.id === backId);

			// The card's list is full: say so beside the button and to screen readers; focus stays on the button.
			if (!core.tryBringBack(backId)) {
				form
					.querySelector<HTMLElement>(`[data-bring-back="${backId}"]`)
					?.focus();

				if (back) announce(core.fullNoteFor(back));

				return;
			}

			cardNode(backId)?.querySelector<HTMLElement>("button")?.focus();
			revealCard(backId);

			if (back) announce(`Brought back “${back.text}”${endAfter(back.text)}`);
		}
	});

	form.addEventListener("keydown", (event) => {
		const input =
			event.target instanceof HTMLInputElement ? event.target : null;

		const id = input?.closest<HTMLElement>("[data-card]")?.dataset.card;

		if (input?.matches("[data-card-input]") && id) {
			if (event.key === "Enter") {
				// Enter that confirms a word in an input method confirms nothing (Safari reports it as keyCode 229).
				if (event.isComposing || event.keyCode === 229) return;
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
			!input &&
			event.target instanceof Element &&
			event.target.closest("[data-lane-screen]")
		) {
			event.preventDefault();
			undoLast();
		}
	});

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

	/**
	 * Brings a card the visitor just added or brought back into view inside its scrolling list, so it is never added out
	 * of sight. Never smooth: the list jumps, which is also what reduced motion asks for.
	 */
	const revealCard = (id: string) =>
		cardNode(id)?.scrollIntoView({ block: "nearest", behavior: "instant" });

	form.addEventListener("pointerdown", (event) => {
		lastPointer = event.pointerType;
	});

	for (const lane of LANES) {
		const parts = lanes[lane];

		const close = (save: boolean, event?: Event) => {
			if (save && parts.input.value.trim()) {
				// The list filled while the visitor typed: keep their words, and say what to do.
				if (!core.tryAddNote(lane, parts.input.value)) {
					announce(core.fullNote(lane));
					parts.input.focus();
					// The reason below the editor can be out of sight in the scrolling box.
					revealUnlessMouse(parts.full, event);

					return;
				}
			}

			if (save && parts.input.value.trim()) {
				// addNote puts the note at the end of the lane's cards.
				const added = core
					.board()
					.cards.filter((card) => card.lane === lane)
					.at(-1);

				if (added) revealCard(added.id);
			}

			parts.input.value = "";

			// By hand the field stays open with focus in it, for the next note.
			if (core.byHand()) {
				parts.input.focus();

				return;
			}

			parts.editor.hidden = true;
			parts.add.hidden = false;
			parts.add.focus();
		};

		parts.add.addEventListener("click", (event) => {
			// A full list says why instead of opening the box; focus stays on Add.
			if (!core.tryOpenAdd(lane)) {
				announce(core.fullNote(lane));
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
				// Enter that confirms a word in an input method adds nothing (Safari reports it as keyCode 229).
				if (event.isComposing || event.keyCode === 229) return;

				// Ctrl or Cmd+Enter is the form's Next: leaving applies the words once.
				if (event.ctrlKey || event.metaKey) return;
				event.preventDefault();
				close(true);
			} else if (event.key === "Escape") {
				// By hand the field cannot close, so Escape keeps the words.
				if (core.byHand()) return;
				event.preventDefault();
				close(false);
			}
		});
	}

	render();

	/**
	 * Applies what the shown lane screen's open editors hold, as if confirmed, and closes every card editor. False when a
	 * note could not be added because the list is full: the screen then says why, unless `silent`, when the words are dropped.
	 */
	function flushEditors(lane: Lane, silent: boolean) {
		const parts = lanes[lane];

		for (const input of parts.section.querySelectorAll<HTMLInputElement>(
			"[data-card-input]",
		)) {
			const editor = input.closest<HTMLElement>("[data-card-editor]");
			const id = input.closest<HTMLElement>("[data-card]")?.dataset.card;

			if (!editor || editor.hidden || !id) continue;

			const next = editOnLeaving({
				board: core.board(),
				id,
				mode: editor.dataset.mode === "answer" ? "answer" : "edit",
				text: input.value,
				opened: editor.dataset.opened ?? input.value,
			});

			editor.hidden = true;
			input.value = "";

			if (next) core.change(next);
		}

		const text = noteOnLeaving({
			editorOpen: !parts.editor.hidden,
			text: parts.input.value,
		});

		if (text !== null && !core.tryAddNote(lane, text)) {
			if (silent) {
				parts.input.value = "";
			} else {
				announce(core.fullNote(lane));
				parts.input.focus();
				revealUnlessMouse(parts.full);

				return false;
			}
		}

		parts.input.value = "";

		// With the AI on the Add editor closes with the screen; by hand the field stays open.
		if (!core.byHand()) {
			parts.editor.hidden = true;
			parts.add.hidden = false;
		}

		return true;
	}

	return {
		...core,
		skip() {
			const lane = shown();

			// What can be applied is applied first, so the words are there if the outline is added back; the rest is dropped.
			if (lane) flushEditors(lane, true);
			core.skip();
		},
		leaveField() {
			const lane = shown();

			// A skipped outline's screens are out of the plan: nothing to flush, nothing to refuse.
			if (!lane || core.skipped()) return true;

			return flushEditors(lane, false);
		},
	};
}
