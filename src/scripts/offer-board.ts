// The offer board in the owner's request page (docs/plans/2026-11-offer-board.md). The rules are the living brief's
// (src/lib/brief-board.ts, run with OFFER_LANE_CONFIG): the owner's cards never change from a reply, a set-aside idea
// is not offered again, an older reply never applies, and a reply that arrives while the owner is in the board waits.
// Use fills the offer editor's own fields (src/components/owner/SoftwareOfferEditor.astro) and Undo puts them back; the
// board itself saves and sends nothing. Prices are worked out here from the owner's numbers (src/lib/offer-pricing.ts).
import * as Predicate from "effect/Predicate";
import {
	type Board,
	type BoardCard,
	type ReplyCard,
	applyReplyIn,
	boardContext,
	bringBackIn,
	editCardIn,
	emptyBoard,
	keepCard,
	lastAction,
	listOf,
	ownField,
	replyRefs,
	sendRequest,
	setAside,
	undoIn,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";
import {
	type MilestoneDetail,
	OFFER_LANES,
	OFFER_LANE_CONFIG,
	type OfferDraft,
	type OfferLane,
	type OfferSizing,
	offerLaneLabels,
	pricingKind,
	readOfferReply,
} from "../lib/offer-board";
import { dayValueEstimate, withinRange } from "../lib/offer-pricing";
import {
	marketRange,
	readMarketReference,
	validDayValue,
} from "../lib/pricing-reference";

/** How long the owner stops editing the offer before the board asks again. */
const IDLE = 3000;

/** The least time between two requests. */
const GAP = 10000;

/** Requests one page may make. */
const REQUESTS_PER_PAGE = 12;

/** How long the page waits for an answer (the route gives the model 30 seconds). */
const TIMEOUT = 35000;

type OfferBoard = Board<OfferLane>;

type OfferCard = BoardCard<OfferLane>;

const dollars = (cents: number) =>
	`$${Math.round(cents / 100).toLocaleString("en-US")}`;

const field = (raw: RawValue, name: string) => ownField(raw, name);

/** The owner's numbers the page was rendered with; anything unreadable reads as not set. */
function readPricing(raw: RawValue) {
	const day = field(raw, "dayValueCents");
	const contingency = field(raw, "contingencyPercent");
	const market = readMarketReference(field(raw, "market"));

	return {
		dayValueCents: validDayValue(day) ? day : null,
		contingencyPercent:
			Predicate.isNumber(contingency) &&
			Number.isInteger(contingency) &&
			contingency >= 0 &&
			contingency <= 100
				? contingency
				: 0,
		market: market.ok ? market.value : null,
	};
}

export function setupOfferBoard() {
	const root = document.querySelector<HTMLElement>("[data-offer-board]");
	const form = document.querySelector<HTMLFormElement>("[data-offer-form]");

	if (!root || !form) return;
	const endpoint = root.dataset.endpoint ?? "";

	let pricing: ReturnType<typeof readPricing>;

	try {
		pricing = readPricing(JSON.parse(root.dataset.pricing ?? "null"));
	} catch {
		pricing = readPricing(null);
	}

	const kind = pricingKind(root.dataset.kind);

	let useLabels: Partial<Record<OfferLane, string>> = {};

	try {
		const raw: RawValue = JSON.parse(root.dataset.useLabels ?? "{}");

		useLabels = Object.fromEntries(
			OFFER_LANES.flatMap((lane) => {
				const label = field(raw, lane);

				return Predicate.isString(label) ? [[lane, label]] : [];
			}),
		);
	} catch {
		// The default label below is used.
	}

	const status = root.querySelector<HTMLElement>("[data-offer-status]")!;
	const live = root.querySelector<HTMLElement>("[data-offer-live]")!;
	const askButton = root.querySelector<HTMLButtonElement>("[data-offer-ask]")!;

	const undoButton =
		root.querySelector<HTMLButtonElement>("[data-offer-undo]")!;

	const heldButton =
		root.querySelector<HTMLButtonElement>("[data-offer-held]")!;

	const heading = root.querySelector<HTMLElement>("#offer-board-title")!;
	const aside = root.querySelector<HTMLDetailsElement>("[data-offer-aside]")!;

	const asideSummary = root.querySelector<HTMLElement>(
		"[data-offer-aside-summary]",
	)!;

	const asideList = root.querySelector<HTMLElement>("[data-offer-aside-list]")!;

	const template = root.querySelector<HTMLTemplateElement>(
		"[data-offer-card-template]",
	)!;

	const priceDay = root.querySelector<HTMLElement>("[data-price-day]")!;
	const priceMarket = root.querySelector<HTMLElement>("[data-price-market]")!;

	let board: OfferBoard = emptyBoard<OfferLane>();
	let sizing: OfferSizing | null = null;

	let started = false,
		requests = 0,
		lastSendAt = 0,
		lastSent = "",
		hovering = false,
		timer: ReturnType<typeof setTimeout> | undefined,
		inFlight: AbortController | null = null,
		held: {
			n: number;
			cards: ReplyCard<OfferLane>[];
			details: { lane: OfferLane; text: string; detail: MilestoneDetail }[];
			refs: string[];
			sizing: OfferSizing;
			changes: number;
		} | null = null;

	/** Each milestone card's detail: what it delivers and its days. */
	const details = new Map<string, MilestoneDetail>();
	/** Where a used milestone card went in the offer editor. */
	const usedIn = new Map<string, HTMLElement>();
	/** For each board history length, how to put the offer's fields back as they were before that Use. */
	const fieldUndo = new Map<number, () => void>();
	const nodes = new Map<string, HTMLLIElement>();

	const announce = (text: string) => {
		live.textContent = text;
	};

	// Only the cards move when a reply applies, so only the owner's pointer or focus among them holds a reply.
	const cardsBox = root.querySelector<HTMLElement>("[data-offer-scroll]")!;

	const interacting = () =>
		hovering || cardsBox.contains(document.activeElement);

	// ---- The offer editor's fields ------------------------------------------------------------------------------------
	const named = <E extends HTMLInputElement | HTMLTextAreaElement>(
		scope: HTMLElement,
		name: string,
	) => scope.querySelector<E>(`[name="${name}"]`);

	/** Sets a field as if the owner typed it (the editor marks the draft changed), and remembers how to put it back. */
	function setField(
		element: HTMLInputElement | HTMLTextAreaElement | null,
		value: string,
		restore: (() => void)[],
	) {
		if (!element || element.value === value) return;
		const before = element.value;
		element.value = value;
		element.dispatchEvent(new Event("input", { bubbles: true }));
		restore.push(() => {
			element.value = before;
			element.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	/** Adds a line to a one-per-line field, unless it is there. */
	function addLine(
		element: HTMLTextAreaElement | null,
		line: string,
		restore: (() => void)[],
	) {
		if (!element) return;
		const lines = element.value.split("\n").map((item) => item.trim());

		if (lines.includes(line)) return;
		setField(
			element,
			[element.value.trim(), line].filter(Boolean).join("\n"),
			restore,
		);
	}

	/** The milestone fieldset a card fills: the one it filled before, the first empty one, or a new one (at most 3). */
	function milestoneFor(cardId: string): HTMLElement | null {
		const known = usedIn.get(cardId);

		if (known?.isConnected) return known;
		const list = form!.querySelector<HTMLElement>("[data-milestones]");

		if (!list) return null;

		const empty = [
			...list.querySelectorAll<HTMLElement>("[data-milestone]"),
		].find((fieldset) => !named(fieldset, "milestoneName")?.value.trim());

		if (empty) return empty;
		const add = form!.querySelector<HTMLButtonElement>("[data-add-milestone]");

		if (!add || add.disabled) return null;
		add.click();

		return (
			[...list.querySelectorAll<HTMLElement>("[data-milestone]")].at(-1) ?? null
		);
	}

	/** The fee a milestone card's days give with the owner's day value: the high end, which carries the contingency. */
	function feeFor(cardId: string): number | null {
		const detail = details.get(cardId);

		if (!detail) return null;

		const estimate = dayValueEstimate(
			[detail],
			pricing.dayValueCents,
			pricing.contingencyPercent,
		);

		return estimate ? estimate.highCents : null;
	}

	/** Use: puts the card into the offer, keeps it on the board, and records how Undo puts the fields back. */
	function use(card: OfferCard, withFee = false) {
		const restore: (() => void)[] = [];
		let said = "";

		switch (card.lane) {
			case "outcome":
				setField(named(form!, "outcome"), card.text, restore);
				said = "Filled the outcome.";

				break;
			case "summary":
				setField(named(form!, "summary"), card.text, restore);
				said = "Filled the summary.";

				break;
			case "timing":
				setField(named(form!, "timing"), card.text, restore);
				said = "Filled the timing.";

				break;
			case "inputs":
				addLine(
					named<HTMLTextAreaElement>(form!, "clientInputs"),
					card.text,
					restore,
				);
				said = "Added to what you need from them.";

				break;
			case "exclusions":
				addLine(
					named<HTMLTextAreaElement>(form!, "exclusions"),
					card.text,
					restore,
				);
				said = "Added to what is outside this offer.";

				break;
			case "questions": {
				const box =
					document.querySelector<HTMLTextAreaElement>("#software-question");

				if (box)
					setField(
						box,
						[box.value.trim(), card.text].filter(Boolean).join("\n"),
						restore,
					);
				said =
					"Copied to Ask a question. It is not sent until you press Send question.";

				break;
			}

			case "milestones": {
				const fieldset = milestoneFor(card.id);
				const detail = details.get(card.id);

				if (!fieldset || !detail) {
					announce(
						"The offer already has three milestones. Remove one to add this.",
					);

					return;
				}

				usedIn.set(card.id, fieldset);
				setField(named(fieldset, "milestoneName"), card.text, restore);
				setField(
					named(fieldset, "deliverables"),
					detail.deliverables.join("\n"),
					restore,
				);
				setField(
					named(fieldset, "acceptance"),
					detail.acceptance.join("\n"),
					restore,
				);
				const fee = withFee ? feeFor(card.id) : null;

				if (fee !== null)
					setField(named(fieldset, "fee"), String(fee / 100), restore);
				said =
					fee === null
						? "Added the milestone. Set its fee."
						: `Added the milestone with a fee of ${dollars(fee)}.`;

				break;
			}

			case "drivers":
				said = `Kept “${card.text}”.`;

				break;
		}

		const next = keepCard(board, card.id);

		// Undo of this Use puts the fields back too. A fee filled later for a card already used is the owner's to change.
		if (next !== board) {
			board = next;
			fieldUndo.set(board.history.length, () => {
				for (const undoField of restore.reverse()) undoField();
			});
		}

		render();
		announce(said);
	}

	// ---- The offer as drafted, for the model (never a fee) -------------------------------------------------------------
	const value = (scope: HTMLElement, name: string, max: number) =>
		(named(scope, name)?.value ?? "").trim().slice(0, max);

	const lines = (text: string, count: number) =>
		text
			.split("\n")
			.map((line) => line.trim().slice(0, 200))
			.filter(Boolean)
			.slice(0, count);

	function draft(): OfferDraft {
		return {
			outcome: value(form!, "outcome", 120),
			summary: value(form!, "summary", 300),
			milestones: [...form!.querySelectorAll<HTMLElement>("[data-milestone]")]
				.slice(0, 3)
				.map((fieldset) => ({
					name: value(fieldset, "milestoneName", 80),
					deliverables: lines(value(fieldset, "deliverables", 1607), 8),
					acceptance: lines(value(fieldset, "acceptance", 1504), 5),
				})),
			clientInputs: value(form!, "clientInputs", 1000),
			exclusions: value(form!, "exclusions", 1000),
			timing: value(form!, "timing", 500),
		};
	}

	/** What a request is for: the draft and the owner's own choices on the board. A reply changes neither. */
	const requestKey = () =>
		JSON.stringify([
			draft(),
			board.cards
				.filter((card) => card.status !== "proposed")
				.map((card) => [card.id, card.status, card.text]),
		]);

	// ---- Prices -------------------------------------------------------------------------------------------------------
	function useRange(lowCents: number, highCents: number) {
		const has = named<HTMLInputElement>(form!, "hasRange");

		if (has && !has.checked) {
			has.checked = true;
			has.dispatchEvent(new Event("change", { bubbles: true }));
		}

		const ignored: (() => void)[] = [];
		setField(
			named(form!, "rangeLow"),
			String(Math.round(lowCents / 100)),
			ignored,
		);
		setField(
			named(form!, "rangeHigh"),
			String(Math.round(highCents / 100)),
			ignored,
		);
		announce(
			`Filled the estimate range: ${dollars(lowCents)} to ${dollars(highCents)}. Nothing is saved until you save the draft.`,
		);
	}

	const rangeButton = (lowCents: number, highCents: number) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "offer-link";
		button.textContent = "Use as the estimate range";
		button.dataset.priceUse = "";
		button.dataset.low = String(lowCents);
		button.dataset.high = String(highCents);

		return button;
	};

	function drawPrices() {
		// The milestones the owner used, or else the suggested ones: the days the estimate is made from.
		const milestones = board.cards.filter(
			(card) =>
				card.lane === "milestones" &&
				card.status !== "dismissed" &&
				details.has(card.id),
		);

		const used = milestones.filter((card) => card.status !== "proposed");
		const counted = (used.length ? used : milestones).slice(0, 3);
		const days = counted.flatMap((card) => details.get(card.id) ?? []);

		if (pricing.dayValueCents !== null && days.length) {
			const estimate = dayValueEstimate(
				days,
				pricing.dayValueCents,
				pricing.contingencyPercent,
			);

			if (estimate) {
				const low = days.reduce((sum, item) => sum + item.daysLow, 0);
				const high = days.reduce((sum, item) => sum + item.daysHigh, 0);

				priceDay.replaceChildren(
					`${dollars(estimate.lowCents)} to ${dollars(estimate.highCents)}: ${low} to ${high} days for ${counted.length} ${used.length ? "used" : "suggested"} ${counted.length === 1 ? "milestone" : "milestones"}, at your day value, plus ${pricing.contingencyPercent}% on the high end. `,
					rangeButton(estimate.lowCents, estimate.highCents),
				);
			}
		}

		if (!pricing.market || !sizing?.size || !kind) return;
		const range = marketRange(pricing.market, kind, sizing.size);

		if (!range) {
			priceMarket.textContent = `The AI reads this as ${sizing.size}, and your research has no figure for that size.`;

			return;
		}

		const parts: (string | HTMLElement)[] = [
			`Your research (${pricing.market.researchedOn}) puts a ${sizing.size} project of this kind at ${dollars(range.lowUsd * 100)} to ${dollars(range.highUsd * 100)}${sizing.sizeReason ? ` (the AI: ${sizing.sizeReason})` : ""}. `,
		];

		if (sizing.figureUsd !== null) {
			const figure = withinRange(sizing.figureUsd, range.lowUsd, range.highUsd);

			parts.push(
				`The AI suggests ${dollars(figure * 100)}${figure === sizing.figureUsd ? "" : ", moved into the researched range"}${sizing.figureReason ? `: ${sizing.figureReason}` : ""}. `,
			);
		}

		parts.push(rangeButton(range.lowUsd * 100, range.highUsd * 100));
		priceMarket.replaceChildren(...parts);
	}

	// ---- Drawing ------------------------------------------------------------------------------------------------------
	const originLabel = (card: OfferCard) => {
		if (card.status === "kept")
			return card.lane === "drivers" ? "You kept this" : "You used this";

		if (card.status === "edited") return "Edited by you";

		return "Suggestion";
	};

	function actionsFor(card: OfferCard): [string, string][] {
		const list: [string, string][] = [];

		if (card.status === "kept") {
			if (card.lane === "milestones" && feeFor(card.id) !== null)
				list.push(["fee", `Use ${dollars(feeFor(card.id) ?? 0)} as its fee`]);

			return list;
		}

		list.push(["use", useLabels[card.lane] ?? "Use"]);

		if (card.lane === "milestones" && feeFor(card.id) !== null)
			list.push([
				"use-fee",
				`Add with a fee of ${dollars(feeFor(card.id) ?? 0)}`,
			]);
		list.push(["edit", "Edit"], ["aside", "Not this"]);

		return list;
	}

	function drawCard(node: HTMLLIElement, card: OfferCard) {
		node.dataset.status = card.status;
		node.querySelector<HTMLElement>("[data-card-origin]")!.textContent =
			originLabel(card);
		node.querySelector<HTMLElement>("[data-card-text]")!.textContent =
			card.text;
		const detail = details.get(card.id);
		const list = node.querySelector<HTMLElement>("[data-card-detail]")!;
		list.hidden = !detail;
		list.replaceChildren(
			...(detail
				? [
						...detail.deliverables.map((item) => `Delivers: ${item}`),
						...detail.acceptance.map((item) => `Check: ${item}`),
						`${detail.daysLow} to ${detail.daysHigh} working days`,
					].map((text) => {
						const item = document.createElement("li");
						item.textContent = text;

						return item;
					})
				: []),
		);
		const reason = node.querySelector<HTMLElement>("[data-card-reason]")!;
		reason.hidden = !(card.status === "proposed" && card.reason);
		reason.textContent = reason.hidden ? "" : `Why: ${card.reason}`;
		const actions = node.querySelector<HTMLElement>("[data-card-actions]")!;
		const wanted = actionsFor(card);

		const signature =
			wanted.map(([act, label]) => `${act}:${label}`).join("|") + card.text;

		if (actions.dataset.signature === signature) return;

		const focused =
			document.activeElement instanceof HTMLElement &&
			actions.contains(document.activeElement)
				? document.activeElement.dataset.act
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

		if (focused)
			(
				actions.querySelector<HTMLElement>(`[data-act="${focused}"]`) ??
				actions.querySelector<HTMLElement>("button") ??
				heading
			).focus();
	}

	function render() {
		const alive = new Set(
			board.cards
				.filter((card) => card.status !== "dismissed")
				.map((card) => card.id),
		);

		for (const [id, node] of nodes)
			if (!alive.has(id)) {
				node.remove();
				nodes.delete(id);
			}

		for (const lane of OFFER_LANES) {
			const section = root!.querySelector<HTMLElement>(
				`[data-offer-lane="${lane}"]`,
			)!;

			const list = section.querySelector<HTMLElement>("[data-offer-cards]")!;

			const cards = board.cards.filter(
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

				drawCard(node, card);

				const expected: Element | null = previous
					? previous.nextElementSibling
					: list.firstElementChild;

				if (node.parentElement !== list || expected !== node)
					list.insertBefore(
						node,
						previous ? previous.nextSibling : list.firstChild,
					);
				previous = node;
			}

			section.querySelector<HTMLElement>("[data-offer-empty]")!.hidden =
				cards.length > 0;
		}

		const dismissed = board.cards.filter((card) => card.status === "dismissed");
		aside.hidden = dismissed.length === 0;
		asideSummary.textContent = `Set aside (${dismissed.length})`;
		asideList.replaceChildren(
			...dismissed.map((card) => {
				const item = document.createElement("li");
				const back = document.createElement("button");
				back.type = "button";
				back.className = "offer-link";
				back.dataset.bringBack = card.id;
				back.textContent = "Bring back";
				back.setAttribute("aria-label", `Bring back: ${card.text}`);
				item.appendChild(
					document.createTextNode(
						`${offerLaneLabels[card.lane]}: ${card.text} `,
					),
				);
				item.appendChild(back);

				return item;
			}),
		);

		const label = lastAction(board);
		undoButton.disabled = !label;
		undoButton.setAttribute("aria-label", label ? `Undo: ${label}` : "Undo");
		heldButton.hidden = !held;
		heldButton.textContent = held
			? `Show ${held.changes} ${held.changes === 1 ? "update" : "updates"}`
			: "";
		askButton.textContent = started
			? "Suggest again"
			: "Suggest an offer with AI";
		drawPrices();
	}

	// ---- Replies ------------------------------------------------------------------------------------------------------
	function apply(reply: NonNullable<typeof held>) {
		const result = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			reply.cards,
			reply.n,
			"",
			false,
			reply.refs,
		);

		board = result.board;

		for (const { lane, text, detail } of reply.details) {
			const card = board.cards.find(
				(item) => item.lane === lane && item.text === text,
			);

			if (card && card.status === "proposed") details.set(card.id, detail);
		}

		sizing = reply.sizing.size ? reply.sizing : sizing;
		held = null;
		render();
		status.textContent = result.added
			? `Up to date with your draft. ${result.added} new ${result.added === 1 ? "suggestion" : "suggestions"}.`
			: "Up to date with your draft.";
		announce(status.textContent);
	}

	function deliver(reply: NonNullable<typeof held>) {
		const preview = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			reply.cards,
			reply.n,
			"",
			false,
			reply.refs,
		);

		const changes = preview.added + preview.updated + preview.withdrawn;

		if (changes > 0 && interacting()) {
			if (!held || reply.n > held.n) held = { ...reply, changes };
			render();
			status.textContent = "Updates are waiting below the cards.";

			return;
		}

		apply(reply);
	}

	const canAsk = () => requests < REQUESTS_PER_PAGE && !inFlight;

	function schedule(delay = IDLE) {
		clearTimeout(timer);

		if (!started || !canAsk() || requestKey() === lastSent) return;
		timer = setTimeout(ask, Math.max(delay, lastSendAt + GAP - Date.now()));
	}

	async function ask() {
		if (!canAsk()) {
			if (requests >= REQUESTS_PER_PAGE)
				status.textContent =
					"The board reached its limit for this page. Reload to ask again.";

			return;
		}

		started = true;
		const key = requestKey();
		const [next, n] = sendRequest(board);
		board = next;
		const controller = new AbortController();
		const stop = setTimeout(() => controller.abort(), TIMEOUT);
		inFlight = controller;
		lastSent = key;
		lastSendAt = Date.now();
		requests++;
		status.textContent = "Reading the brief and your draft…";
		render();

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					cards: boardContext(board).slice(0, 40),
					draft: draft(),
				}),
				signal: controller.signal,
			});

			const json: RawValue = await response.json().catch(() => null);
			const reply = response.ok ? readOfferReply(json) : null;

			if (!reply) {
				const error = field(json, "error");
				status.textContent = Predicate.isString(error)
					? error
					: "The AI couldn’t answer just now. Your draft is unchanged; try again.";
				lastSent = "";
				announce(status.textContent);

				return;
			}

			// The route named these cards; those it or this page then left out still do.
			const refs = [
				...replyRefs({
					cards: (listOf(field(json, "refs"), 40) ?? []).map((ref) => ({
						ref,
					})),
				}),
				...replyRefs(json).filter(
					(ref) => !reply.cards.some((card) => card.ref === ref),
				),
			];

			deliver({
				n,
				cards: reply.cards.map((card) => ({
					ref: card.ref,
					lane: card.lane,
					text: card.text,
					basis: "suggested",
					quote: "",
					reason: card.reason,
				})),
				details: reply.cards.flatMap((card) =>
					card.detail
						? [{ lane: card.lane, text: card.text, detail: card.detail }]
						: [],
				),
				refs,
				sizing: reply,
				changes: 0,
			});
		} catch {
			status.textContent =
				"The AI couldn’t answer just now. Your draft is unchanged; try again.";
			lastSent = "";
			announce(status.textContent);
		} finally {
			clearTimeout(stop);
			inFlight = null;
			render();
			schedule();
		}
	}

	// ---- The owner's actions ------------------------------------------------------------------------------------------
	const cardOf = (id: string | undefined) =>
		board.cards.find((card) => card.id === id);

	function undoLast() {
		const label = lastAction(board);

		if (!label) return;
		const restore = fieldUndo.get(board.history.length);
		fieldUndo.delete(board.history.length);
		restore?.();
		board = undoIn(OFFER_LANE_CONFIG, board);
		render();

		if (
			!root!.contains(document.activeElement) ||
			document.activeElement === document.body
		)
			(undoButton.disabled ? heading : undoButton).focus();
		announce(`Undid: ${label}.`);
		schedule();
	}

	root.addEventListener("click", (event) => {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("button")
				: null;

		if (!target || !root.contains(target)) return;
		const node = target.closest<HTMLElement>("[data-card]");
		const card = cardOf(node?.dataset.card);

		if (target.dataset.priceUse !== undefined) {
			useRange(Number(target.dataset.low), Number(target.dataset.high));

			return;
		}

		if (target.dataset.bringBack) {
			const next = bringBackIn(
				OFFER_LANE_CONFIG,
				board,
				target.dataset.bringBack,
			);

			if (next === board)
				announce(
					"That list is full. Use “Not this” on one of its cards first.",
				);
			else {
				board = next;
				render();
				nodes
					.get(target.dataset.bringBack)
					?.querySelector<HTMLElement>("button")
					?.focus();
			}

			return;
		}

		if (!card || !node) return;

		switch (target.dataset.act) {
			case "use":
				use(card);

				break;
			case "use-fee":
			case "fee":
				use(card, true);

				break;
			case "aside": {
				const near = node.nextElementSibling ?? node.previousElementSibling;
				board = setAside(board, card.id);
				render();
				(near?.querySelector<HTMLElement>("button") ?? heading).focus();
				announce(`Set aside “${card.text}”. Undo or Bring back restores it.`);
				schedule();

				break;
			}

			case "edit": {
				const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;

				const input =
					node.querySelector<HTMLInputElement>("[data-card-input]")!;

				editor.hidden = false;
				input.value = card.text;
				input.focus();

				break;
			}
		}

		if (target.matches("[data-card-save], [data-card-cancel]")) {
			const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;
			node.querySelector<HTMLElement>("[data-card-editor]")!.hidden = true;

			if (target.matches("[data-card-save]")) {
				board = editCardIn(OFFER_LANE_CONFIG, board, card.id, input.value);
				render();
			}

			nodes
				.get(card.id)
				?.querySelector<HTMLElement>('[data-act="edit"]')
				?.focus();
		}
	});

	root.addEventListener("keydown", (event) => {
		const input =
			event.target instanceof HTMLInputElement ? event.target : null;

		if (
			input?.matches("[data-card-input]") &&
			(event.key === "Enter" || event.key === "Escape")
		) {
			event.preventDefault();
			input
				.closest("[data-card]")
				?.querySelector<HTMLButtonElement>(
					event.key === "Enter" ? "[data-card-save]" : "[data-card-cancel]",
				)
				?.click();

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

	askButton.addEventListener("click", () => {
		clearTimeout(timer);
		lastSent = "";
		void ask();
	});
	undoButton.addEventListener("click", undoLast);
	heldButton.addEventListener("click", () => held && apply(held));
	cardsBox.addEventListener("pointerenter", (event) => {
		if (event.pointerType === "mouse" || event.pointerType === "pen")
			hovering = true;
	});
	cardsBox.addEventListener("pointerleave", () => {
		hovering = false;

		if (held && !interacting()) apply(held);
	});
	root.addEventListener("focusout", () => {
		setTimeout(() => {
			if (held && !interacting()) apply(held);
		}, 0);
	});

	// The board keeps up with the draft once the owner has asked for it.
	form.addEventListener("input", () => schedule());
	form.addEventListener("change", () => schedule());
	render();
}
