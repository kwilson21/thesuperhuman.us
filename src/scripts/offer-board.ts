// The offer board in the owner's request page (docs/plans/2026-11-offer-board.md). The rules are the living brief's
// (src/lib/brief-board.ts, run with OFFER_LANE_CONFIG): the owner's cards never change from a reply, a set-aside idea
// is not offered again, an older reply never applies, and a reply that arrives while the owner is among the cards waits.
// Use fills the offer editor's own fields (src/components/owner/SoftwareOfferEditor.astro); Undo puts back what Use
// changed, and only that. The board itself saves and sends nothing. Prices are worked out here from the owner's numbers
// (src/lib/offer-pricing.ts). Use, Undo, Set its fee, replies and failures are modelled in verification/offer-board.qnt;
// tests/browser/offer-board.cjs tries each of its mutants on the real page.
import * as Predicate from "effect/Predicate";
import {
	type Board,
	type BoardCard,
	type HistoryStep,
	type ReplyCard,
	applyReplyIn,
	boardContext,
	bringBackIn,
	editCardIn,
	emptyBoard,
	lastAction,
	markStep,
	oneLine,
	ownField,
	sendRequest,
	setAside,
	undoIn,
	useCard,
} from "../lib/brief-board";
import type { RawValue } from "../lib/fields";
import {
	type MilestoneDetail,
	OFFER_CONTEXT_MAX,
	OFFER_LANES,
	OFFER_LANE_CONFIG,
	type OfferDraft,
	type OfferLane,
	type OfferSizing,
	cardRefs,
	fitOfferCards,
	offerLaneLabels,
	offerTextLimits,
	pricingKind,
	readOfferReply,
	refList,
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

/** How long a finger on the cards, or the cards scrolling, holds a reply after it stops (as the living brief's board). */
const QUIET = 3000;

/** The milestone fields Use fills. Use fills a row only when these are all empty, and a row it added goes on Undo only when they are empty again. */
const MILESTONE_FIELDS = [
	"milestoneName",
	"deliverables",
	"acceptance",
	"fee",
] as const;

/** Requests one page may make. */
const REQUESTS_PER_PAGE = 12;

/** What the board says at its page limit, with the reply that reaches it and on a press of Suggest after. */
const PAGE_LIMIT = `The board has asked the AI ${REQUESTS_PER_PAGE} times on this page, its limit, so it no longer follows your draft. Save your draft, then reload the page to ask again; the board starts empty.`;

/** How long the page waits for an answer (the route gives the model 30 seconds). */
const TIMEOUT = 35000;

type OfferBoard = Board<OfferLane>;

type OfferCard = BoardCard<OfferLane>;

type Held = {
	n: number;
	cards: ReplyCard<OfferLane>[];
	details: { lane: OfferLane; text: string; detail: MilestoneDetail }[];
	refs: string[];
	sizing: OfferSizing;
	changes: number;
	/** The request was the page's last, so applying its reply says the board asks nothing more. */
	last: boolean;
};

const dollars = (cents: number) =>
	`$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** An amount to the cent when it has cents: what fills the offer. */
const exactDollars = (cents: number) =>
	`$${(cents / 100).toLocaleString("en-US", {
		minimumFractionDigits: cents % 100 ? 2 : 0,
		maximumFractionDigits: 2,
	})}`;

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
	const kind = pricingKind(root.dataset.kind);

	let pricing: ReturnType<typeof readPricing>;

	try {
		pricing = readPricing(JSON.parse(root.dataset.pricing ?? "null"));
	} catch {
		pricing = readPricing(null);
	}

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
	const cardsBox = root.querySelector<HTMLElement>("[data-offer-scroll]")!;
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

	// What each price row says before there is anything to work out, to go back to when there is nothing again.
	const dayDefault = [...priceDay.childNodes].map((node) =>
		node.cloneNode(true),
	);

	const marketDefault = [...priceMarket.childNodes].map((node) =>
		node.cloneNode(true),
	);

	let board: OfferBoard = emptyBoard<OfferLane>();
	let sizing: OfferSizing | null = null;

	let autoAsk = false,
		requests = 0,
		lastSendAt = 0,
		lastSent = "",
		hovering = false,
		hoveringPrices = false,
		pressing = false,
		touchedAt = 0,
		fingerDown = false,
		quietTimer: ReturnType<typeof setTimeout> | undefined,
		pressNumber = 0,
		lastFailure: string | null = null,
		timer: ReturnType<typeof setTimeout> | undefined,
		inFlight: AbortController | null = null,
		latestN = 0,
		held: Held | null = null,
		priceSignature = "";

	/** Each milestone card's detail: what it delivers and its days. */
	const details = new Map<string, MilestoneDetail>();

	/** Whether a suggestion has arrived on this page: the Suggest button says "again" only then. */
	let replied = false;
	/** The cards Use has put into the offer (Undo takes a card out again). */
	const used = new Set<string>();
	/** Where a used milestone card went in the offer editor. */
	const usedIn = new Map<string, HTMLElement>();

	/**
	 * For each Use on the board's history, how to put back what it changed in the offer editor. Keyed by the step itself,
	 * so a step that falls off the capped history takes its entry with it and never answers for another.
	 */
	const fieldUndo = new WeakMap<HistoryStep<OfferLane>, () => void>();
	const nodes = new Map<string, HTMLLIElement>();

	const announce = (text: string) => {
		live.textContent = text;
	};

	/** The offer editor's largest milestone fee, $1,000,000 (the fee field's max and the server's check). */
	const EDITOR_MAX_CENTS = 100_000_000;

	/** A date that never splits across lines at its hyphens. */
	const day = (date: string) => date.replace(/-/g, "\u2011");

	/** What this kind of work is called in a sentence. */
	const kindNoun =
		kind === "webapp"
			? "web app"
			: kind === "workflow"
				? "workflow tool"
				: "website";

	/** The AI's own words quoted inside a sentence: trimmed, without a closing period. */
	const clause = (text: string) => text.trim().replace(/[.。]+$/, "");

	/** The end of a sentence after a quoted text: nothing when the quote already ends one (“…are in.”, “…launch?”). */
	const endAfter = (text: string) =>
		/[.?!]["”’)]*$/.test(text.trim()) ? "" : ".";

	/** The whole sentence behind a short form shown while the owner was among the cards, shown once they leave. */
	let pendingFull: string | null = null;

	/** A message the owner both sees in the status line and hears. */
	/**
	 * Measures a field outside the board that has focus and can be seen, and returns a step that puts it back where it was
	 * on screen once the board above it has changed height (Chrome's scroll anchoring does not always, and Safari has
	 * none). A field scrolled out of view is left alone, so the page never moves under someone reading the board.
	 */
	const keepTypedField = () => {
		const focused = document.activeElement;

		const box =
			focused instanceof HTMLElement &&
			focused !== document.body &&
			!focused.closest("[data-offer-board]")
				? focused.getBoundingClientRect()
				: null;

		// Seen: its top and its first line are on screen (a tall text area may run past the bottom).
		const kept =
			box &&
			box.top >= 0 &&
			box.top + Math.min(box.height, 48) <= window.innerHeight
				? focused
				: null;

		return () => {
			if (kept?.isConnected && box)
				window.scrollBy(0, kept.getBoundingClientRect().top - box.top);
		};
	};

	const say = (text: string) => {
		const keep = keepTypedField();

		pendingFull = null;
		status.style.minHeight = "";
		status.textContent = text;
		announce(text);
		keep();
	};

	/** Words the board writes on its own, while the owner may be among the cards: the line keeps its height. */
	const quietly = (text: string) => {
		const keep = keepTypedField();

		pendingFull = null;
		status.style.minHeight = `${status.offsetHeight}px`;
		status.textContent = text;
		keep();
	};

	// Only the cards move when a reply applies, so only the owner's pointer or focus among them holds a reply. The
	// "Show updates" button counts too, so moving to it never applies (and hides) what it would show.
	const interacting = () =>
		fingerDown ||
		Date.now() - touchedAt < QUIET ||
		hovering ||
		hoveringPrices ||
		pressing ||
		cardsBox.contains(document.activeElement) ||
		document.activeElement === heldButton ||
		// A price row is redrawn when a reply applies, so focus on its buttons holds a reply too.
		Boolean(
			document.activeElement?.closest("[data-price-day], [data-price-market]"),
		) ||
		[...cardsBox.querySelectorAll<HTMLElement>("[data-card-editor]")].some(
			(editor) => !editor.hidden,
		);

	/**
	 * What the board says on its own (a reply, a failure). While the owner is among the cards the line keeps its height and
	 * shows the short form, so the cards do not move under the pointer or finger; the whole sentence is announced now and
	 * shown once they leave the cards.
	 */
	function sayOrHold(full: string, short: string) {
		if (!interacting()) {
			say(full);

			return;
		}

		quietly(short);
		announce(full);

		if (short !== full) pendingFull = full;
	}

	// ---- The offer editor's fields ------------------------------------------------------------------------------------
	const named = <E extends HTMLInputElement | HTMLTextAreaElement>(
		scope: HTMLElement,
		name: string,
	) => scope.querySelector<E>(`[name="${name}"]`);

	const changed = (element: HTMLInputElement | HTMLTextAreaElement) =>
		element.dispatchEvent(new Event("input", { bubbles: true }));

	/**
	 * Sets a field as if the owner typed it (the editor marks the draft changed). Undo puts it back only while it still
	 * holds what Use put there: anything the owner typed since stays.
	 */
	function setField(
		element: HTMLInputElement | HTMLTextAreaElement | null,
		value: string,
		restore: (() => void)[],
	) {
		if (!element || element.value === value) return;
		const before = element.value;
		element.value = value;
		changed(element);
		restore.push(() => {
			if (element.value !== value) return;
			element.value = before;
			changed(element);
		});
	}

	/** Adds a line to a one-per-line field, unless it is there. Undo removes that line, and only that line. */
	function addLine(
		element: HTMLTextAreaElement | null,
		line: string,
		restore: (() => void)[],
	): boolean {
		if (!element) return true;

		if (element.value.split("\n").some((item) => item.trim() === line))
			return true;

		const joined = [element.value.trimEnd(), line].filter(Boolean).join("\n");

		// Setting the value from script skips the field's maxlength, and the editor refuses to save past it.
		if (element.maxLength > 0 && joined.length > element.maxLength)
			return false;
		element.value = joined;
		changed(element);
		restore.push(() => {
			const kept = element.value.split("\n");
			const at = kept.findIndex((item) => item.trim() === line);

			if (at < 0) return;
			kept.splice(at, 1);
			element.value = kept.join("\n");
			changed(element);
		});

		return true;
	}

	/** Says that a line was not added because its field would pass its own character limit. */
	const tooLong = (field: HTMLTextAreaElement | null, name: string) =>
		say(
			`Adding this would take “${name}” past its ${(field?.maxLength ?? 0).toLocaleString("en-US")}-character limit, so the board left it out. Shorten that field first.`,
		);

	const milestones = () => [
		...form.querySelectorAll<HTMLElement>("[data-milestone]"),
	];

	/**
	 * The milestone fieldset a card fills: the one it filled before (while it still holds that milestone's name), the
	 * first empty one, or a new one (at most three). `added` says whether this added one.
	 */
	function milestoneFor(card: OfferCard) {
		const known = usedIn.get(card.id);

		if (
			known?.isConnected &&
			named(known, "milestoneName")?.value.trim() === card.text
		)
			return { fieldset: known, added: false, drawn: [] };

		// Empty means every field Use fills is empty: a row with no name may still hold deliverables or a fee the owner
		// typed (verification/offer-board.qnt, ownerWordsKept, mutant name-only-empty).
		const empty = milestones().find((fieldset) =>
			MILESTONE_FIELDS.every((name) => {
				const control = named(fieldset, name);

				// valueOf reads a partly typed fee ("1e") as typed, though its value is "".
				return !control || !valueOf(control).trim();
			}),
		);

		if (empty) return { fieldset: empty, added: false, drawn: [] };
		const add = form!.querySelector<HTMLButtonElement>("[data-add-milestone]");

		if (!add || add.disabled) return null;
		const count = milestones().length;

		// The editor moves focus into a row it adds; the owner is still working in the board.
		const focused =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;

		const agreements = form!.querySelector<HTMLElement>(
			"[data-agreement-milestones]",
		);

		add.click();
		focused?.focus();
		const fieldset = milestones().at(-1);

		if (!fieldset || milestones().length <= count) return null;

		// The row and its agreement row as the editor drew them: Undo removes the row only while all of it still reads so.
		const parts = [fieldset, agreements?.lastElementChild].filter(
			(part): part is HTMLElement => part instanceof HTMLElement,
		);

		return { fieldset, added: true, drawn: snapshot(parts) };
	}

	/** What a control holds, a checkbox by whether it is ticked. The rows hold only inputs and text areas. */
	const valueOf = (control: HTMLInputElement | HTMLTextAreaElement) =>
		control instanceof HTMLInputElement &&
		(control.type === "checkbox" || control.type === "radio")
			? String(control.checked)
			: // A partly typed date or number reads as "" with badInput set: the owner has typed in it.
				control.validity.badInput
				? "\u0000typed"
				: control.value;

	/** Every control in these parts and what it holds. */
	function snapshot(parts: readonly HTMLElement[]) {
		return parts.flatMap((part) =>
			[
				...part.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
					"input, textarea",
				),
			].map((control) => ({ control, value: valueOf(control) })),
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

		// Above the offer editor's own limit, no fee is offered: the editor would refuse to save it.
		return estimate && estimate.highCents <= EDITOR_MAX_CENTS
			? estimate.highCents
			: null;
	}

	/** Sets only the fee of a milestone already in the offer: the rest of it is the owner's now. */
	function setFee(card: OfferCard) {
		const fee = feeFor(card.id);
		const fieldset = rowOf(card);
		const input = fieldset ? named(fieldset, "fee") : null;

		if (fee === null || !input) {
			say(
				"This milestone is no longer in the offer under its name. Set its fee in the offer itself.",
			);
			render();

			return;
		}

		const value = String(fee / 100);
		const was = input.value;

		if (was === value) {
			say(`The fee is already ${dollars(fee)}.`);

			return;
		}

		input.value = value;
		changed(input);

		// Its own step: Undo puts the fee back while it still holds what this put there (mutant fee-no-step).
		const marked = markStep(board, card.id, `set the fee of “${card.text}”`);

		if (marked === board) return;
		board = marked;
		const step = board.history.at(-1);

		if (step)
			fieldUndo.set(step, () => {
				if (input.value !== value) return;
				input.value = was;
				changed(input);
			});

		render();
		say(`Set the fee to ${dollars(fee)}. Change it in the offer if you like.`);
	}

	/** The row a used milestone went to, while it still holds that milestone's name (mutant fee-any-row). */
	function rowOf(card: OfferCard) {
		const fieldset = usedIn.get(card.id);

		return fieldset?.isConnected &&
			named(fieldset, "milestoneName")?.value.trim() === card.text
			? fieldset
			: null;
	}

	/** Use: puts the card into the offer and makes it the owner's; Undo of that step puts back what it changed. */
	function use(card: OfferCard, withFee = false) {
		const restore: (() => void)[] = [];
		let said = "";

		switch (card.lane) {
			case "outcome":
			case "summary":
			case "timing": {
				const field = named(form!, card.lane);
				const had = field?.value.trim() ?? "";

				setField(field, card.text, restore);
				said =
					had && had !== card.text
						? `Replaced your ${card.lane} with this card. Undo puts your words back.`
						: `Filled the ${card.lane}.`;

				break;
			}

			case "inputs": {
				const field = named<HTMLTextAreaElement>(form!, "clientInputs");

				if (!addLine(field, card.text, restore)) {
					tooLong(field, "What you need from them");

					return;
				}

				said = "Added to what you need from them.";

				break;
			}

			case "exclusions": {
				const field = named<HTMLTextAreaElement>(form!, "exclusions");

				if (!addLine(field, card.text, restore)) {
					tooLong(field, "Outside this offer");

					return;
				}

				said = "Added to what is outside this offer.";

				break;
			}

			case "questions": {
				const field =
					document.querySelector<HTMLTextAreaElement>("#software-question");

				if (!addLine(field, card.text, restore)) {
					tooLong(field, "Ask a question");

					return;
				}

				said =
					"Copied to Ask a question. It is not sent until you press Send question.";

				break;
			}

			case "milestones": {
				const detail = details.get(card.id);
				const target = detail ? milestoneFor(card) : null;

				if (!detail || !target) {
					say(
						"The offer already has three milestones. Remove one to add this.",
					);

					return;
				}

				const { fieldset, added, drawn } = target;
				const before = usedIn.get(card.id);
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

				// Runs last on Undo (the list is undone from the end), once the fields are back: a row this Use added goes
				// only while all of it, its checkpoint and agreement row included, reads as the editor drew it
				// (verification/offer-board.qnt, mutant four-fields-only).
				restore.unshift(() => {
					if (before) usedIn.set(card.id, before);
					else usedIn.delete(card.id);

					if (
						added &&
						fieldset.isConnected &&
						drawn.every(
							({ control, value }) =>
								control.isConnected && valueOf(control) === value,
						)
					) {
						const focused =
							document.activeElement instanceof HTMLElement
								? document.activeElement
								: null;

						fieldset
							.querySelector<HTMLButtonElement>("[data-remove-milestone]")
							?.click();
						focused?.focus();
					}
				});
				said =
					fee === null
						? "Added the milestone. Set its fee."
						: `Added the milestone with a fee of ${dollars(fee)}.`;

				break;
			}

			case "drivers":
				said = `Kept “${card.text}” on the board for you; it is not added to the offer.`;

				break;
		}

		const wasUsed = used.has(card.id);
		used.add(card.id);
		restore.unshift(() => {
			if (!wasUsed) used.delete(card.id);
		});

		const next = useCard(
			board,
			card.id,
			card.lane === "drivers"
				? "kept"
				: card.lane === "questions"
					? "copied to Ask a question"
					: "used",
		);

		if (next === board) {
			for (const undoField of restore.reverse()) undoField();

			return;
		}

		board = next;
		const step = board.history.at(-1);

		if (step)
			fieldUndo.set(step, () => {
				for (const undoField of restore.reverse()) undoField();
			});
		render();
		say(said);
		schedule();
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
			milestones: milestones()
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
	/**
	 * Fills the offer's estimate range, to the cent (past offers can hold cents). The editor's range starts at $1, so a
	 * researched low end of $0 fills as $1.
	 */
	/**
	 * What a price row's button did, shown in that row under the button (the board's status line is out of view there),
	 * and announced. One such line at a time; it stays through a redraw of its row until the next price press.
	 */
	function sayPrice(text: string, from: HTMLElement) {
		for (const old of document.querySelectorAll("[data-price-said]"))
			old.remove();

		const line = document.createElement("p");

		line.className = "offer-price-said";
		line.dataset.priceSaid = "";
		line.textContent = text;
		from.insertAdjacentElement("afterend", line);
		// Just far enough that it shows, when the button sat at the screen's edge.
		line.scrollIntoView({ block: "nearest" });
		announce(text);
	}

	function useRange(lowCents: number, highCents: number, from: HTMLElement) {
		const low = Math.max(100, lowCents);
		const high = Math.max(low, highCents);

		// The editor refuses a whole-project range whose low end is under the offer's total, so this never fills one.
		const total = milestones().reduce((sum, fieldset) => {
			const fee = Number(named(fieldset, "fee")?.value || 0);

			return sum + (Number.isFinite(fee) ? Math.round(fee * 100) : 0);
		}, 0);

		if (total > low) {
			sayPrice(
				`Your milestone fees add up to ${exactDollars(total)}, more than this range’s low end of ${exactDollars(low)}. The whole-project range must start at the offer total or above, so it was not filled. Change the fees, or type a range in the offer.`,
				from,
			);

			return;
		}

		const has = named<HTMLInputElement>(form!, "hasRange");

		if (has && !has.checked) {
			has.checked = true;
			has.dispatchEvent(new Event("change", { bubbles: true }));
		}

		for (const [name, cents] of [
			["rangeLow", low],
			["rangeHigh", high],
		] as const) {
			const input = named(form!, name);

			if (input) {
				input.value = String(cents / 100);
				changed(input);
			}
		}

		sayPrice(
			`Filled the whole-project range the client sees as an estimate: ${exactDollars(low)} to ${exactDollars(high)}. Nothing is saved until you save the draft.`,
			from,
		);
	}

	const rangeButton = (lowCents: number, highCents: number, what: string) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "studio-quiet";
		button.textContent = "Use as the whole-project range";
		button.setAttribute(
			"aria-label",
			`Use as the whole-project range: ${what}`,
		);
		button.dataset.priceUse = "";
		button.dataset.low = String(lowCents);
		button.dataset.high = String(highCents);

		return button;
	};

	/** Replaces the price rows only when what they say changes, so a focused button in one is never replaced for nothing. */
	function drawPrices() {
		const dayParts: (string | Node)[] = [];
		const marketParts: (string | Node)[] = [];

		// The milestones the owner used, or else the suggested ones: the days the estimate is made from.
		const onBoard = board.cards.filter(
			(card) =>
				card.lane === "milestones" &&
				card.status !== "dismissed" &&
				details.has(card.id),
		);

		const inOffer = board.cards.filter(
			(card) =>
				card.lane === "milestones" &&
				details.has(card.id) &&
				used.has(card.id) &&
				usedIn.get(card.id)?.isConnected === true,
		);

		const counted = (inOffer.length ? inOffer : onBoard).slice(0, 3);
		const days = counted.flatMap((card) => details.get(card.id) ?? []);

		const estimate = days.length
			? dayValueEstimate(
					days,
					pricing.dayValueCents,
					pricing.contingencyPercent,
				)
			: null;

		if (estimate) {
			const low = days.reduce((sum, item) => sum + item.daysLow, 0);
			const high = days.reduce((sum, item) => sum + item.daysHigh, 0);

			dayParts.push(
				`${dollars(estimate.lowCents)} to ${dollars(estimate.highCents)}: ${low} to ${high} days for ${counted.length} ${inOffer.length ? "used" : "suggested"} ${counted.length === 1 ? "milestone" : "milestones"}, at your day value, plus ${pricing.contingencyPercent}% on the high end. `,
				rangeButton(
					estimate.lowCents,
					estimate.highCents,
					"the day-value estimate",
				),
			);
		} else if (pricing.dayValueCents !== null && (sizing || replied))
			dayParts.push("No milestones with days on the board to estimate from.");
		else dayParts.push(...dayDefault.map((node) => node.cloneNode(true)));

		const range =
			pricing.market && sizing?.size && kind
				? marketRange(pricing.market, kind, sizing.size)
				: null;

		if (range && pricing.market && sizing?.size) {
			marketParts.push(
				`The AI reads this as a ${sizing.size} ${kindNoun}${sizing.sizeReason ? ` (its reason: “${clause(sizing.sizeReason)}”)` : ""}. Your research (${day(pricing.market.researchedOn)}) puts a ${sizing.size} ${kindNoun} at ${dollars(range.lowUsd * 100)} to ${dollars(range.highUsd * 100)}. `,
			);

			if (sizing.figureUsd !== null) {
				const figure = withinRange(
					sizing.figureUsd,
					range.lowUsd,
					range.highUsd,
				);

				const why = sizing.figureReason
					? ` (its reason: “${clause(sizing.figureReason)}”)`
					: "";

				marketParts.push(
					figure === sizing.figureUsd
						? `The AI suggests ${dollars(figure * 100)}${why}. `
						: `The AI named ${dollars(sizing.figureUsd * 100)}${why}; held to your research’s range, that is ${dollars(figure * 100)}. `,
				);
			}

			marketParts.push(
				rangeButton(
					range.lowUsd * 100,
					range.highUsd * 100,
					"the market range",
				),
			);
		} else if (pricing.market && sizing?.size)
			marketParts.push(
				`The AI reads this as a ${sizing.size} ${kindNoun}, and your research has no figure for that size.`,
			);
		else if (pricing.market && replied)
			marketParts.push(
				requests < REQUESTS_PER_PAGE
					? "The AI did not size this brief, so there is no market range to show. Press Suggest again to ask."
					: "The AI did not size this brief, so there is no market range to show.",
			);
		else marketParts.push(...marketDefault.map((node) => node.cloneNode(true)));

		const text = (parts: (string | Node)[]) =>
			parts
				.map((part) =>
					Predicate.isString(part)
						? part
						: `${part.textContent}${part instanceof HTMLElement ? `[${part.dataset.low}-${part.dataset.high}]` : ""}`,
				)
				.join("");

		const signature = `${text(dayParts)}|${text(marketParts)}`;

		if (signature === priceSignature) return;
		priceSignature = signature;

		const focused =
			document.activeElement instanceof HTMLElement &&
			(priceDay.contains(document.activeElement) ||
				priceMarket.contains(document.activeElement))
				? document.activeElement.closest("dd")
				: null;

		// What a price button said stays in its row through the redraw.
		const said = document.querySelector<HTMLElement>("[data-price-said]");
		const saidIn = said?.closest("dd");

		priceDay.replaceChildren(...dayParts);
		priceMarket.replaceChildren(...marketParts);

		if (said && (saidIn === priceDay || saidIn === priceMarket))
			saidIn.appendChild(said);

		// A row redrawn under focus keeps it on its new button, or on the row's heading when it has none.
		if (focused && !focused.contains(document.activeElement))
			(
				focused.querySelector<HTMLElement>("button") ??
				root!.querySelector<HTMLElement>("#offer-pricing-title") ??
				heading
			).focus();
	}

	// ---- Drawing ------------------------------------------------------------------------------------------------------
	const originLabel = (card: OfferCard) => {
		if (used.has(card.id))
			return card.lane === "drivers" ? "You kept this" : "You used this";

		if (card.status === "edited") return "Edited by you";

		if (card.status === "kept") return "You kept this";

		return "Suggestion";
	};

	/** A card in the offer can have its fee set or be set aside; any other card can be used, edited or set aside. */
	function actionsFor(card: OfferCard): [string, string][] {
		const list: [string, string][] = [];
		const fee = card.lane === "milestones" ? feeFor(card.id) : null;

		if (
			used.has(card.id) ||
			(card.lane === "drivers" && card.status === "kept")
		) {
			const row = rowOf(card);

			if (fee !== null && row && named(row, "fee")?.value !== String(fee / 100))
				list.push(["fee", `Set its fee to ${dollars(fee)}`]);
			list.push(["aside", "Not this"]);

			return list;
		}

		list.push(["use", useLabels[card.lane] ?? "Use"]);

		if (fee !== null)
			list.push(["use-fee", `Add with a fee of ${dollars(fee)}`]);
		list.push(["edit", "Edit"], ["aside", "Not this"]);

		return list;
	}

	function drawCard(node: HTMLLIElement, card: OfferCard) {
		node.dataset.status = card.status;
		node.querySelector<HTMLElement>("[data-card-origin]")!.textContent =
			originLabel(card);
		node.querySelector<HTMLElement>("[data-card-text]")!.textContent =
			card.text;
		const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;
		input.setAttribute("aria-label", `Edit “${card.text}”`);
		input.maxLength = offerTextLimits[card.lane];
		const hint = node.querySelector<HTMLElement>("[data-card-hint]")!;
		hint.id = `offer-card-hint-${card.id}`;
		hint.textContent = `Up to ${offerTextLimits[card.lane]} characters.`;

		if (!input.hasAttribute("aria-invalid"))
			input.setAttribute("aria-describedby", hint.id);
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
		const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;

		if (!editor.hidden && !wanted.some(([act]) => act === "edit")) {
			const editing = editor.contains(document.activeElement);
			editor.hidden = true;

			if (editing)
				queueMicrotask(() =>
					actions.querySelector<HTMLElement>("button")?.focus(),
				);
		}

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
				button.className = "studio-quiet";
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

	/**
	 * The first card showing in the cards' box and where it sits. The box takes no scroll anchor (overflow-anchor is off, so
	 * the page never follows a card in it, and Safari has none), so a redraw keeps that card in place itself.
	 */
	function boxAnchor() {
		if (cardsBox.scrollTop === 0) return null;

		const top = cardsBox.getBoundingClientRect().top;

		const node = [
			...cardsBox.querySelectorAll<HTMLElement>("[data-card]"),
		].find((each) => each.getBoundingClientRect().bottom > top);

		return node?.dataset.card
			? {
					id: node.dataset.card,
					offset: node.getBoundingClientRect().top - top,
				}
			: null;
	}

	function keepAnchor(anchor: { id: string; offset: number } | null) {
		const node = anchor ? nodes.get(anchor.id) : undefined;

		if (!anchor || !node?.isConnected) return;
		cardsBox.scrollTop +=
			node.getBoundingClientRect().top -
			cardsBox.getBoundingClientRect().top -
			anchor.offset;
	}

	function render() {
		const anchor = boxAnchor();

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

			const empty = section.querySelector<HTMLElement>("[data-offer-empty]")!;

			empty.hidden = cards.length > 0;
			empty.textContent = board.cards.some(
				(card) => card.lane === lane && card.status === "dismissed",
			)
				? "Nothing here now. The ones you set aside are under Set aside."
				: replied
					? "No suggestions for this part."
					: "No suggestions yet.";
		}

		const dismissed = board.cards.filter((card) => card.status === "dismissed");
		aside.hidden = dismissed.length === 0;
		asideSummary.textContent = `Set aside (${dismissed.length})`;

		const asideSignature = dismissed
			.map((card) => `${card.id}:${card.text}`)
			.join("|");

		if (asideList.dataset.signature !== asideSignature) {
			asideList.dataset.signature = asideSignature;
			asideList.replaceChildren(
				...dismissed.map((card) => {
					const item = document.createElement("li");
					const back = document.createElement("button");
					back.type = "button";
					back.className = "studio-quiet";
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
		}

		const label = lastAction(board);
		undoButton.disabled = !label;
		undoButton.setAttribute("aria-label", label ? `Undo: ${label}` : "Undo");
		// The button keeps its place while nothing waits (hidden from sight and from assistive technology), so showing it
		// never moves the cards.
		heldButton.hidden = false;
		heldButton.toggleAttribute("data-idle", !held);
		heldButton.textContent = held
			? `Show ${held.changes} ${held.changes === 1 ? "update" : "updates"}`
			: "Show 88 updates";
		askButton.textContent = replied
			? "Suggest again"
			: "Suggest an offer with AI";
		keepAnchor(anchor);
		drawPrices();
	}

	// ---- Replies ------------------------------------------------------------------------------------------------------
	/**
	 * The milestone details a reply sets once applied (`after` is the board it leaves): a new card's, or an open one's its
	 * request was sent after (applyReplyIn changes no other).
	 */
	function detailsSet(reply: Held, after: OfferBoard) {
		const before = new Set(board.cards.map((card) => card.id));

		const changeable = new Set(
			board.cards
				.filter((card) => card.status === "proposed" && reply.n > card.since)
				.map((card) => card.id),
		);

		return reply.details.flatMap(({ lane, text, detail }) => {
			const card = after.cards.find(
				(item) =>
					item.lane === lane &&
					item.text === text &&
					item.status === "proposed",
			);

			return card && (!before.has(card.id) || changeable.has(card.id))
				? [{ id: card.id, detail }]
				: [];
		});
	}

	const sameDetail = (one: MilestoneDetail | undefined, two: MilestoneDetail) =>
		JSON.stringify(one) === JSON.stringify(two);

	function apply(reply: Held, shown = false) {
		replied = true;

		// A newer reply replaces updates that were waiting; focus on their button, about to hide, goes to the heading.
		const replaced = held !== null && held !== reply ? held.changes : 0;
		const showFocused = document.activeElement === heldButton;

		const result = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			reply.cards,
			reply.n,
			"",
			false,
			reply.refs,
		);

		const set = detailsSet(reply, result.board);

		board = result.board;

		for (const { id, detail } of set) details.set(id, detail);

		sizing = reply.sizing.size ? reply.sizing : sizing;
		held = null;

		// A field below the board that the owner is typing in stays put when the board above it grows or shrinks.
		const keep = keepTypedField();

		render();
		keep();

		if (showFocused) heading.focus({ preventScroll: true });

		const added = `${result.added} new ${result.added === 1 ? "suggestion" : "suggestions"}.`;

		// A reply that waited while a newer request went out is not the board catching up with the draft: the newer one is
		// still out, or it failed, and its failure stays said.
		const older = reply.n < latestN;
		const failure = older && inFlight === null ? lastFailure : null;

		const done =
			older && inFlight !== null
				? result.added
					? `${added} Reading your latest changes…`
					: "Reading your latest changes…"
				: failure
					? result.added
						? `${result.added} new ${result.added === 1 ? "suggestion" : "suggestions"} from an earlier request.${failure.startsWith("The board’s last request") ? "" : " Your latest request failed."} ${failure}`
						: failure
					: result.added
						? `Up to date with your draft. ${added}`
						: "Up to date with your draft.";

		// The reply to the page's last request says so: the board asks nothing more on this page.
		const said = !replaced
			? done
			: replaced === 1
				? `${done} A newer answer replaced the update that was waiting.`
				: `${done} A newer answer replaced the ${replaced} updates that were waiting.`;

		const full = reply.last ? `${said} ${PAGE_LIMIT}` : said;

		// While the owner is among the cards the line keeps its height and a short form, so the cards do not move under the
		// pointer or finger; the whole sentence is still announced, and Suggest says the limit again.
		if (shown) say(full);
		else
			sayOrHold(
				full,
				reply.last && !failure ? "Up to date. Page limit reached." : done,
			);
	}

	/**
	 * What of a reply's sizing the market row shows: nothing without research for this kind of work, the size alone when
	 * the research has no range for it, and the size, figure and their reasons when it has one.
	 */
	const marketShown = (shown: OfferSizing | null) =>
		!shown?.size || !pricing.market || !kind
			? ""
			: marketRange(pricing.market, kind, shown.size)
				? JSON.stringify([
						shown.size,
						clause(shown.sizeReason),
						shown.figureUsd,
						shown.figureUsd === null ? "" : clause(shown.figureReason),
					])
				: shown.size;

	function deliver(reply: Held) {
		const preview = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			reply.cards,
			reply.n,
			"",
			false,
			reply.refs,
		);

		// New days or deliverables on a card it keeps count too: they move the cards and change a fee button's amount.
		const changes =
			preview.added +
			preview.updated +
			preview.withdrawn +
			detailsSet(reply, preview.board).filter(({ id, detail }) => {
				const was = board.cards.find((card) => card.id === id);
				const now = preview.board.cards.find((card) => card.id === id);

				// A card the reply changed otherwise (its words or reason) is already counted once in `updated`, and
				// applyReplyIn keeps the same card object for a card it leaves alone.
				return (
					was !== undefined &&
					now === was &&
					!sameDetail(details.get(id), detail)
				);
			}).length +
			(reply.sizing.size &&
			(pressing ||
				hoveringPrices ||
				document.activeElement?.closest(
					"[data-price-day], [data-price-market]",
				)) &&
			marketShown(reply.sizing) !== marketShown(sizing)
				? 1
				: 0);

		if (changes > 0 && interacting()) {
			const first = !held;

			if (!held || reply.n > held.n) held = { ...reply, changes };
			// The status line says so without changing its height, so the cards below it stay.
			render();
			quietly(
				held.changes === 1
					? "An update is waiting."
					: `${held.changes} updates are waiting.`,
			);

			if (first)
				announce(
					held.changes === 1
						? "An update is waiting. Press “Show 1 update” to see it."
						: `${held.changes} updates are waiting. Press “Show ${held.changes} updates” to see them.`,
				);

			return;
		}

		apply(reply);
	}

	const canAsk = () => requests < REQUESTS_PER_PAGE && !inFlight;

	/** After the owner has asked once, the board keeps up with the draft; a failure stops that until they ask again. */
	function schedule(delay = IDLE) {
		clearTimeout(timer);

		if (!autoAsk || !canAsk() || requestKey() === lastSent) return;
		timer = setTimeout(ask, Math.max(delay, lastSendAt + GAP - Date.now()));
	}

	/** A failure stops automatic asking. The route's own sentence is shown as it is; the page's own adds what to do. */
	/** The same sentence the route answers when the AI fails, so one failure reads one way. */
	const AI_FAILED =
		"The AI couldn’t answer just now. Your draft is unchanged; press Suggest to try again.";

	/**
	 * A request failed, with the route's sentence or the page's own. Its kind decides the short form and the page's limit:
	 * "retry" says to try again (the AI or the store failed, or requests crossed), "answer" is final (the request is
	 * missing or closed, or the board is off here), "daily" is the owner's daily limit, "signin" a lapsed sign-in.
	 */
	function failed(
		text: string,
		kind: "retry" | "answer" | "daily" | "signin",
		short = text,
	) {
		autoAsk = false;

		// Only the request on its way can fail, so at the page's limit it was the last: a "try again" would contradict the
		// reload the limit asks for. The other kinds keep their own sentence, which is right at the limit too.
		const atLimit = requests >= REQUESTS_PER_PAGE && kind === "retry";

		const full = atLimit
			? `The board’s last request on this page got no answer. ${PAGE_LIMIT}`
			: text;

		lastFailure = full;
		sayOrHold(
			full,
			atLimit
				? "No answer. Page limit reached."
				: kind === "retry"
					? "No answer. Press Suggest again."
					: kind === "daily"
						? "Daily limit reached."
						: kind === "signin"
							? "Reload: sign-in may have lapsed."
							: short,
		);
	}

	async function ask(pressed = false) {
		if (!canAsk()) {
			if (requests >= REQUESTS_PER_PAGE && !inFlight) say(PAGE_LIMIT);

			return;
		}

		const key = requestKey();
		const [next, n] = sendRequest(board);
		latestN = n;
		lastFailure = null;
		board = next;
		const controller = new AbortController();
		const stop = setTimeout(() => controller.abort(), TIMEOUT);
		inFlight = controller;
		lastSent = key;
		lastSendAt = Date.now();
		requests++;
		const last = requests >= REQUESTS_PER_PAGE;

		if (pressed) say("Reading the brief and your draft…");
		else quietly("Reading the brief and your draft…");
		render();
		const shown = draft();

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					cards: fitOfferCards(
						boardContext(board, OFFER_CONTEXT_MAX),
						JSON.stringify(shown).length,
					),
					draft: shown,
				}),
				signal: controller.signal,
			});

			const json: RawValue = await response.json().catch(() => null);
			const reply = response.ok ? readOfferReply(json) : null;

			if (!reply) {
				const error = field(json, "error");

				if (Predicate.isString(error))
					failed(
						error,
						response.status === 429
							? "daily"
							: /try again/i.test(error)
								? "retry"
								: "answer",
						response.status === 404
							? "No such request."
							: response.status === 409
								? "This request is closed."
								: response.status === 503
									? "The board is off here."
									: error,
					);
				else if (
					json === null ||
					response.status === 401 ||
					response.status === 403
				)
					failed(
						"The answer could not be read, perhaps because your sign-in lapsed. Your draft is unchanged; reload the page, then press Suggest.",
						"signin",
					);
				else failed(AI_FAILED, "retry");

				return;
			}

			// The route named these cards; those it or this page then left out still do.
			const refs = [
				...refList(field(json, "refs")),
				...cardRefs(json).filter(
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
				sizing: {
					size: reply.size,
					sizeReason: reply.sizeReason,
					figureUsd: reply.figureUsd,
					figureReason: reply.figureReason,
				},
				changes: 0,
				last,
			});
		} catch {
			failed(AI_FAILED, "retry");
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
		const step = board.history.at(-1);

		if (!label || !step) return;
		const next = undoIn(OFFER_LANE_CONFIG, board);

		// Undo can bring a card back into a full lane, which withdraws the lane's newest open card: never one being edited.
		if (
			stopForEdit(
				next,
				"Undo would change this card. Save or Cancel your edit first, then undo.",
			)
		)
			return;

		fieldUndo.get(step)?.();
		board = next;
		render();

		if (
			!root!.contains(document.activeElement) ||
			document.activeElement === document.body ||
			(document.activeElement === undoButton && undoButton.disabled)
		)
			(undoButton.disabled ? heading : undoButton).focus();
		say(`Undid: ${label}${endAfter(label)}`);
		schedule();
	}

	// Safari does not focus a button it taps or clicks. Focusing it before any handler runs (in the capture phase) keeps
	// focus among the cards for the press, so a reply arriving after a tapped Use is held as it is everywhere else, and a
	// handler that moves focus on (to an editor's error, a card's next button) still has the last word.
	root.addEventListener(
		"click",
		(event) => {
			// Enter and Escape in a card editor press Save or Cancel from the script; focus stays where the handler puts it.
			if (!event.isTrusted) return;

			// The press ends here; focus on the pressed button (below) holds a reply from now where it should.
			const wasPressing = pressing;

			pressing = false;

			const pressed =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("button")
					: null;

			// A press that ended off a button: what it held is looked at again now.
			if (!pressed || !root.contains(pressed)) {
				if (wasPressing) left();

				return;
			}

			if (document.activeElement !== pressed)
				pressed.focus({ preventScroll: true });

			// A reply held while the owner was among the cards lands before a press outside them (Suggest, Undo), not
			// just after it, so the press's own message is said last and a request includes the waiting cards. Only when
			// nothing else holds it: not under a resting pointer, not while a card editor is open, and not for a price
			// row's button (focus there holds it, since applying a reply redraws the row).
			if (held && !interacting()) apply(held);
		},
		true,
	);

	root.addEventListener("click", (event) => {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("button")
				: null;

		if (!target || !root.contains(target)) return;
		const node = target.closest<HTMLElement>("[data-card]");
		const card = cardOf(node?.dataset.card);

		if (target.dataset.priceUse !== undefined) {
			useRange(Number(target.dataset.low), Number(target.dataset.high), target);

			return;
		}

		if (target.dataset.bringBack) {
			const id = target.dataset.bringBack;
			const back = cardOf(id);
			const next = bringBackIn(OFFER_LANE_CONFIG, board, id);

			if (next === board) {
				say(
					back
						? `“${offerLaneLabels[back.lane]}” is full. Use “Not this” on one of its cards first.`
						: "That list is full.",
				);

				return;
			}

			board = next;
			render();
			(
				nodes.get(id)?.querySelector<HTMLElement>("button") ?? asideSummary
			).focus();
			say(`Brought back “${back?.text ?? ""}”${endAfter(back?.text ?? "")}`);
			schedule();

			return;
		}

		if (!card || !node) return;

		switch (target.dataset.act) {
			case "use":
			case "use-fee": {
				// Words typed in the card's open editor are the owner's: they are saved or cancelled first, never lost.
				const editing = unsavedEdit(card);

				if (editing) {
					showEditError(
						editing.node,
						editing.input,
						card.id,
						`Save or Cancel your edit first, then ${card.lane === "drivers" ? "keep the card" : card.lane === "questions" ? "copy the question" : "use the card"}.`,
					);

					break;
				}

				use(card, target.dataset.act === "use-fee");

				break;
			}

			case "fee":
				setFee(card);

				break;
			case "aside": {
				const editing = unsavedEdit(card);

				if (editing) {
					showEditError(
						editing.node,
						editing.input,
						card.id,
						"Save or Cancel your edit first, then set the card aside.",
					);

					break;
				}

				const near = node.nextElementSibling ?? node.previousElementSibling;
				const wasUsed = used.has(card.id);
				board = setAside(board, card.id);
				render();
				(near?.querySelector<HTMLElement>("button") ?? asideSummary).focus();
				say(
					wasUsed && card.lane === "questions"
						? `Set aside “${card.text}”${endAfter(card.text)} It stays in Ask a question; remove it there if you don’t want to ask it. Undo or Bring back restores the card.`
						: wasUsed && card.lane !== "drivers"
							? `Set aside “${card.text}”${endAfter(card.text)} It stays in the offer; remove it there if you don’t want it. Undo or Bring back restores the card.`
							: `Set aside “${card.text}”${endAfter(card.text)} Undo or Bring back restores it.`,
				);
				schedule();

				break;
			}

			case "edit": {
				const editor = node.querySelector<HTMLElement>("[data-card-editor]")!;

				const input =
					node.querySelector<HTMLInputElement>("[data-card-input]")!;

				// Already open: what the owner typed there stays.
				if (editor.hidden) {
					editor.hidden = false;
					input.value = card.text;
				}

				input.focus();

				break;
			}
		}

		if (target.matches("[data-card-save], [data-card-cancel]")) {
			const input = node.querySelector<HTMLInputElement>("[data-card-input]")!;

			const error = node.querySelector<HTMLElement>("[data-card-error]")!;

			if (target.matches("[data-card-save]") && !input.value.trim()) {
				const message =
					"A card needs some words. Use Cancel to keep it as it was, or Not this to set it aside.";

				showEditError(node, input, card.id, message);

				return;
			}

			clearEditError(node);

			node.querySelector<HTMLElement>("[data-card-editor]")!.hidden = true;

			if (target.matches("[data-card-save]")) {
				const next = editCardIn(OFFER_LANE_CONFIG, board, card.id, input.value);

				if (next === board) say("No change to the card.");
				else {
					board = next;
					render();
					say("Saved your words on the card. Undo puts the old ones back.");
					schedule();
				}
			} else say("Kept the card as it was.");

			const drawn = nodes.get(card.id);

			(
				drawn?.querySelector<HTMLElement>('[data-act="edit"]') ??
				drawn?.querySelector<HTMLElement>("[data-card-actions] button") ??
				heading
			).focus();
		}
	});

	/** The card's open editor and field when they hold words other than the card's: the owner's, not to be lost. */
	function unsavedEdit(card: OfferCard) {
		const node = nodes.get(card.id);
		const editor = node?.querySelector<HTMLElement>("[data-card-editor]");
		const input = node?.querySelector<HTMLInputElement>("[data-card-input]");

		return node &&
			editor &&
			input &&
			!editor.hidden &&
			oneLine(input.value) !== card.text
			? { node, input }
			: null;
	}

	/**
	 * Whether a change to `next` must wait for an open editor: it would remove or reword a card whose editor holds the
	 * owner's unsaved words. If so, says so by that field and moves focus to it.
	 */
	function stopForEdit(next: OfferBoard, message: string) {
		for (const card of board.cards) {
			const after = next.cards.find((each) => each.id === card.id);

			if (after && after.text === card.text && after.status !== "dismissed")
				continue;
			const editing = unsavedEdit(card);

			if (editing) {
				showEditError(editing.node, editing.input, card.id, message);

				return true;
			}
		}

		return false;
	}

	/** Says what is wrong next to the card's field, marks the field and moves focus to it. */
	function showEditError(
		node: HTMLElement,
		input: HTMLInputElement,
		id: string,
		message: string,
	) {
		const error = node.querySelector<HTMLElement>("[data-card-error]")!;

		error.id = `offer-card-error-${id}`;
		error.textContent = message;
		error.hidden = false;
		input.setAttribute("aria-invalid", "true");
		input.setAttribute("aria-describedby", `${error.id} offer-card-hint-${id}`);
		say(message);
		input.focus();
	}

	/** The card editor's error line and the field's invalid mark go together. */
	function clearEditError(node: HTMLElement) {
		const error = node.querySelector<HTMLElement>("[data-card-error]");
		const input = node.querySelector<HTMLInputElement>("[data-card-input]");

		if (error) {
			error.hidden = true;
			error.textContent = "";
		}

		input?.removeAttribute("aria-invalid");

		const hint = node.querySelector<HTMLElement>("[data-card-hint]");

		if (hint?.id) input?.setAttribute("aria-describedby", hint.id);
		else input?.removeAttribute("aria-describedby");
	}

	root.addEventListener("input", (event) => {
		const input =
			event.target instanceof HTMLInputElement &&
			event.target.matches("[data-card-input]")
				? event.target
				: null;

		const node = input?.closest<HTMLElement>("[data-card]");

		if (node && input?.getAttribute("aria-invalid")) clearEditError(node);
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
		autoAsk = true;
		lastSent = "";
		void ask(true);
	});
	undoButton.addEventListener("click", undoLast);
	heldButton.addEventListener("click", () => {
		if (!held) return;

		const preview = applyReplyIn(
			OFFER_LANE_CONFIG,
			board,
			held.cards,
			held.n,
			"",
			false,
			held.refs,
		);

		if (
			stopForEdit(
				preview.board,
				"The updates would change this card. Save or Cancel your edit first, then show them.",
			)
		)
			return;

		apply(held, true);
		heading.focus();
	});

	// A finger on the cards, or the cards scrolling by finger or wheel, holds replies until the cards have been still for a
	// moment (as the living brief's board). A tap on the header's buttons (Suggest, Show updates, Undo) does not count, so
	// the reply a tap on Suggest asks for is not held; nor does a scroll the page makes itself (moving focus, keeping a card
	// in place).
	const noteTouch = () => {
		touchedAt = Date.now();
		clearTimeout(quietTimer);
		quietTimer = setTimeout(() => left(), QUIET + 50);
	};

	cardsBox.addEventListener("pointerdown", (event) => {
		if (event.pointerType === "touch") noteTouch();
	});
	// A finger resting on the cards holds replies for as long as it is down; the moment begins when it lifts.
	cardsBox.addEventListener(
		"touchstart",
		() => {
			fingerDown = true;
			noteTouch();
		},
		{ passive: true },
	);

	const lifted = (event: TouchEvent) => {
		if (!fingerDown || event.touches.length > 0) return;
		fingerDown = false;
		noteTouch();
	};

	document.addEventListener("touchend", lifted, {
		capture: true,
		passive: true,
	});
	document.addEventListener("touchcancel", lifted, {
		capture: true,
		passive: true,
	});
	// A finger lifted while the window is in the background is never reported, so leaving the window ends the hold.
	window.addEventListener("blur", () => {
		fingerDown = false;
	});
	cardsBox.addEventListener("wheel", noteTouch, { passive: true });
	cardsBox.addEventListener("touchmove", noteTouch, { passive: true });

	cardsBox.addEventListener("pointerenter", (event) => {
		if (event.pointerType === "mouse" || event.pointerType === "pen")
			hovering = true;
	});

	// The price rows are redrawn by a reply too, so a mouse resting on them holds one.
	const prices = root
		.querySelector<HTMLElement>("[data-price-day]")
		?.closest("dl");

	prices?.addEventListener("pointerenter", (event) => {
		if (event.pointerType === "mouse" || event.pointerType === "pen")
			hoveringPrices = true;
	});

	/** Once the owner leaves the cards: a held reply applies, or a sentence held back while they were there is shown. */
	const left = () => {
		if (interacting()) return;

		if (held) apply(held);
		else if (pendingFull) {
			const text = pendingFull;

			// Already announced when it came; shown now, not announced twice.
			pendingFull = null;
			status.style.minHeight = "";
			status.textContent = text;
		}
	};

	cardsBox.addEventListener("pointerleave", () => {
		hovering = false;
		left();
	});
	prices?.addEventListener("pointerleave", () => {
		hoveringPrices = false;
		left();
	});

	// A press in progress, from pointer down to its click, holds a reply (Safari and Firefox clear focus on mousedown,
	// which would otherwise apply a waiting reply before the click lands and could redraw the button being pressed).
	root.addEventListener(
		"pointerdown",
		(event) => {
			if (
				event.button === 0 &&
				event.target instanceof Element &&
				event.target.closest("button, summary, a")
			) {
				pressNumber++;
				pressing = true;
			}
		},
		true,
	);

	/** A press that ends without a click (dragged off, cancelled, or a tap whose click comes later) ends here. */
	const released = () => {
		if (!pressing) return;

		const press = pressNumber;

		setTimeout(() => {
			// Ended already by its click, or a later press has begun: that one ends itself.
			if (!pressing || press !== pressNumber) return;
			pressing = false;
			left();
		}, 600);
	};

	const dropped = () => {
		pressing = false;
		left();
	};

	document.addEventListener("pointerup", released, true);
	document.addEventListener("pointercancel", released, true);
	document.addEventListener("contextmenu", dropped, true);
	window.addEventListener("blur", dropped);
	root.addEventListener("focusout", () => {
		// Decided once focus has settled: drawing a card can replace the focused button and move focus to its neighbour.
		setTimeout(left, 0);
	});

	// Once the owner has asked, the board keeps up with the draft.
	form.addEventListener("input", (event) => {
		// Set its fee is offered only while the milestone's row holds its name.
		if (
			event.target instanceof HTMLInputElement &&
			(event.target.name === "milestoneName" || event.target.name === "fee")
		)
			render();

		schedule();
	});
	form.addEventListener("change", () => schedule());

	// A milestone row added or removed in the editor (Remove milestone fires no input event) changes which used milestones
	// the day-value estimate counts, so the prices are redrawn.
	const milestoneList = form.querySelector("[data-milestones]");

	if (milestoneList)
		new MutationObserver(() => render()).observe(milestoneList, {
			childList: true,
		});

	render();
}
