// The owner's pricing page (src/pages/owner/pricing.astro): each form is sent as JSON to /api/owner/pricing with the
// version the page last saw. A saved form takes the new version (both forms do), so the next save is not refused. New
// research reloads the page to show its table, unless either form holds unsaved changes (the research box included, when
// it changed while the save was on its way), which a reload would lose.
import * as Predicate from "effect/Predicate";
import type { RawValue } from "../lib/fields";

type Status = HTMLElement | null;

/** What the page sends: a change to the values or to the research, with the version it was rendered at. */
type PricingRequest =
	| {
			readonly action: "values";
			readonly dayValue: number | null;
			readonly contingencyPercent: number;
			readonly expectedVersion: number;
	  }
	| {
			readonly action: "market";
			readonly market: RawValue;
			readonly expectedVersion: number;
	  };

/** A field of the route's answer, unread; undefined when the answer is not an object or lacks it. */
const field = (answer: RawValue, name: string): RawValue =>
	Predicate.isObject(answer) &&
	!Array.isArray(answer) &&
	Object.hasOwn(answer, name)
		? answer[name]
		: undefined;

/** Whether a form holds changes not yet saved: a field whose value differs from the one the page was drawn with. */
const unsaved = (form: HTMLFormElement) =>
	[
		...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
			"input, textarea",
		),
	].some((input) => input.value !== input.defaultValue);

/** Marks a value field as refused, described by its hint and the form's status line, or clears the mark. */
function markValue(input: HTMLInputElement | null, invalid: boolean) {
	if (!input) return;

	const hint =
		input.dataset.hint ??
		input.getAttribute("aria-describedby")?.split(" ")[0] ??
		"";

	input.dataset.hint = hint;

	if (invalid) {
		input.setAttribute("aria-invalid", "true");
		input.setAttribute("aria-describedby", `${hint} pricing-values-status`);
	} else {
		input.removeAttribute("aria-invalid");
		input.setAttribute("aria-describedby", hint);
	}
}

/** Marks the research box as refused, described by its form's status line, or clears the mark. */
function markResearch(invalid: boolean) {
	const box = document.querySelector<HTMLTextAreaElement>(
		"[data-pricing-market]",
	);

	if (!box) return;

	if (invalid) {
		box.setAttribute("aria-invalid", "true");
		box.setAttribute(
			"aria-describedby",
			"pricing-market-hint pricing-market-status",
		);
	} else {
		box.removeAttribute("aria-invalid");
		box.setAttribute("aria-describedby", "pricing-market-hint");
	}
}

const BUSY = "A save is on its way. Try again when it answers.";

/**
 * Says that a save is on its way, keeping what the line said before: a refusal there (its field still marked) comes back
 * when the save answers, so a marked field never points at an empty line.
 */
function sayBusy(status: Status) {
	if (!status) return;

	if (status.textContent !== BUSY)
		status.dataset.before = status.textContent ?? "";
	status.textContent = BUSY;
}

/** Where the page notes, across the reload new research triggers, that it was saved. */
const SAVED_KEY = "owner-pricing-saved";

/** Whether Clear research is offered in this form (only while research is saved). */
const clearOffered = (form: HTMLFormElement) =>
	form.querySelector<HTMLElement>("[data-pricing-clear]")?.hidden === false;

/** Whether a save from this page is on its way. */
let saving = false;

/**
 * Whether a save's answer was lost: it may have reached the store, so this page's version may be old and another save
 * would be refused as if another page had saved (verification/pricing-save.qnt, mutant retry-after-lost).
 */
let needsReload = false;

const RELOAD_FIRST =
	"The last save’s answer did not arrive, so it may have been saved. Reload the page before saving again.";

/** How long a save waits for its answer before the page treats it as lost. */
const SAVE_TIMEOUT_MS = 30000;

/**
 * One save at a time for the whole page: a second save sent before the first answers would carry the version the first
 * replaces, and be refused as if another page had saved (verification/pricing-save.qnt, mutant parallel-saves). Every
 * Save button waits while one is on its way, and the next save reads the version the last one answered.
 */
async function send(
	body: PricingRequest,
	form: HTMLFormElement,
	status: Status,
) {
	if (saving) {
		sayBusy(status);

		return;
	}

	if (needsReload) {
		if (status) status.textContent = RELOAD_FIRST;

		return;
	}

	saving = true;

	// Marked, not disabled: a disabled button would drop keyboard focus to the page. `saving` refuses a second press.
	const buttons = [
		...document.querySelectorAll<HTMLButtonElement>(
			"[data-pricing-form] button",
		),
	];

	for (const button of buttons) button.setAttribute("aria-disabled", "true");

	// What the form held when it was sent. The fields stay editable while the save is on its way, and the answer marks
	// only this as saved: text typed meanwhile still counts as unsaved, and a clear empties the box only if it still
	// holds this.
	const sent = new Map(
		[
			...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
				"input, textarea",
			),
		].map((input) => [input, input.value]),
	);

	try {
		await save(body, form, status, sent);
	} finally {
		saving = false;

		for (const button of buttons) button.removeAttribute("aria-disabled");

		// A press made while it was on its way said so; that is no longer true.
		for (const line of document.querySelectorAll<HTMLElement>(
			"[data-pricing-status]",
		))
			if (line.textContent === BUSY)
				line.textContent = line
					.closest("form")
					?.querySelector('[aria-invalid="true"]')
					? (line.dataset.before ?? "")
					: "";
	}
}

async function save(
	body: PricingRequest,
	form: HTMLFormElement,
	status: Status,
	sent: ReadonlyMap<HTMLInputElement | HTMLTextAreaElement, string>,
) {
	const clearing = body.action === "market" && body.market === null;

	if (status) status.textContent = clearing ? "Clearing…" : "Saving…";

	if (body.action === "market") markResearch(false);

	try {
		const response = await fetch("/api/owner/pricing", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
		});

		const answer: RawValue = await response.json().catch(() => null);
		const error = field(answer, "error");

		// No readable answer (a timeout at the edge, a cut connection): the save may or may not have been written.
		if (answer === null) {
			needsReload = true;

			if (status) status.textContent = RELOAD_FIRST;

			return;
		}

		const version = field(answer, "version");

		if (
			response.ok &&
			field(answer, "ok") === true &&
			Predicate.isNumber(version)
		) {
			const forms = [
				...document.querySelectorAll<HTMLFormElement>("[data-pricing-form]"),
			];

			for (const each of forms) each.dataset.version = String(version);

			const lastSaved = document.querySelector<HTMLElement>(
				"[data-pricing-last-saved]",
			);

			if (lastSaved)
				lastSaved.textContent = `Last saved just now (version ${version}).`;

			// What was sent is now what is saved; anything typed since still differs from it.
			for (const [input, value] of sent) input.defaultValue = value;

			const changedSince = unsaved(form);

			// A research save reloads to show its ranges, unless that would lose changes not yet saved in either form.
			if (body.action === "market" && !forms.some(unsaved)) {
				// The reloaded page says it was saved: the status here would go with the page.
				try {
					sessionStorage.setItem(
						SAVED_KEY,
						body.market === null ? "cleared" : "saved",
					);
				} catch {
					// Without storage the reloaded table is the confirmation.
				}

				// Nothing is unsaved here (checked above), so the leave-page warning, which runs as the reload starts, does
				// not ask. Text typed while the new page loads is not kept; the status says the page is reloading.
				if (status)
					status.textContent = clearing
						? "Research cleared. Reloading the page…"
						: "Saved. Reloading the page to show the new ranges…";
				location.reload();

				return;
			}

			// Cleared without a reload: the box and the research it showed go too, so a later Save research never puts back
			// what was just cleared.
			if (body.action === "market" && body.market === null) {
				const box = form.querySelector<HTMLTextAreaElement>(
					"[data-pricing-market]",
				);

				// Text typed in the box while the clear was on its way stays, and counts as not saved.
				if (box) {
					if (box.value === sent.get(box)) box.value = "";
					box.defaultValue = "";
				}

				const shown = document.querySelector<HTMLElement>(
					"[data-pricing-research]",
				);

				if (shown) shown.hidden = true;

				const empty = document.querySelector<HTMLElement>(
					"[data-pricing-empty]",
				);

				if (empty) empty.hidden = false;

				const clear = form.querySelector<HTMLElement>("[data-pricing-clear]");

				// Focus on the button about to hide (or already fallen to the page) goes to Save research. Focus the owner
				// moved elsewhere while the answer was on its way stays where they put it.
				if (clear) {
					if (
						document.activeElement === clear ||
						document.activeElement === document.body ||
						document.activeElement === null
					)
						form
							.querySelector<HTMLElement>('button[type="submit"]')
							?.focus({ preventScroll: true });
					clear.hidden = true;
				}

				const editCopy = document.querySelector<HTMLElement>(
					"[data-pricing-edit-copy]",
				);

				if (editCopy) editCopy.hidden = true;
			}

			// Saved without a reload: research is stored now, so the empty line goes and Clear research is offered.
			if (body.action === "market" && body.market !== null) {
				const empty = document.querySelector<HTMLElement>(
					"[data-pricing-empty]",
				);

				if (empty) empty.hidden = true;

				const clear = form.querySelector<HTMLElement>("[data-pricing-clear]");

				if (clear) clear.hidden = false;
			}

			if (status)
				status.textContent =
					clearing && unsaved(form)
						? "Research cleared. What you typed in the box since is not saved."
						: clearing
							? "Research cleared."
							: changedSince && body.action === "market"
								? "Saved the research as it was when you pressed Save research. You changed the box since; save again to keep those changes, then reload the page to see the new ranges."
								: changedSince
									? "Saved what this form held when you pressed Save. You changed it since; save again to keep those changes."
									: body.action === "market"
										? "Saved. Save or undo your day value and contingency changes, then reload the page to see the new ranges."
										: "Saved.";

			return;
		}

		const refusedResearch =
			body.action === "market" &&
			(response.status === 400 || response.status === 413);

		const box = form.querySelector<HTMLTextAreaElement>(
			"[data-pricing-market]",
		);

		// The reason is about what was sent. A box changed since is not marked for it; the reason says so instead.
		const boxChangedSince = box !== null && box.value !== sent.get(box);

		const reason =
			response.status === 413
				? "The research file is too large to save (the limit is 96 KB). Shorten the caveats or source titles, then save again."
				: Predicate.isString(error)
					? error
					: "Your pricing could not be saved. Try again.";

		if (status)
			status.textContent =
				refusedResearch && boxChangedSince
					? `${reason} (This is about the research as it was when you pressed Save research; you changed the box since.)`
					: reason;

		// A research file the route refused: the box is marked with the reason beside it, if it still holds that file.
		if (refusedResearch && !boxChangedSince) markResearch(true);
	} catch {
		// The request or its answer was lost on the way: the save may have reached the store.
		needsReload = true;

		if (status) status.textContent = RELOAD_FIRST;
	}
}

export function setupOwnerPricing() {
	// The page asks for a reload after a refusal or a lost answer: unsaved changes are not lost without a warning.
	window.addEventListener("beforeunload", (event) => {
		const forms = [
			...document.querySelectorAll<HTMLFormElement>("[data-pricing-form]"),
		];

		if (forms.some(unsaved)) event.preventDefault();
	});

	let reloaded: string | null = null;

	try {
		reloaded = sessionStorage.getItem(SAVED_KEY);
		sessionStorage.removeItem(SAVED_KEY);
	} catch {
		// Nothing to say without storage.
	}

	if (reloaded === "saved" || reloaded === "cleared") {
		const status = document.querySelector<HTMLElement>(
			'[data-part="market"] [data-pricing-status]',
		);

		// Focus where the owner was working, then say it, after the page is ready so the status region announces it.
		// The browser restores the scroll position, so focus goes back to Save research, which that view shows, with the
		// status line beside it saying what happened.
		document
			.querySelector<HTMLElement>('[data-part="market"] button[type="submit"]')
			?.focus({ preventScroll: true });

		if (status)
			setTimeout(() => {
				status.textContent =
					reloaded === "cleared" ? "Research cleared." : "Research saved.";
			}, 300);
	}

	for (const form of document.querySelectorAll<HTMLFormElement>(
		"[data-pricing-form]",
	)) {
		const status = form.querySelector<HTMLElement>("[data-pricing-status]");
		const expectedVersion = () => Number(form.dataset.version ?? "0");

		for (const input of form.querySelectorAll<HTMLInputElement>(
			'input[type="number"]',
		))
			input.addEventListener("input", () => markValue(input, false));

		// Typing in a refused research box clears its mark.
		form
			.querySelector("[data-pricing-market]")
			?.addEventListener("input", () => markResearch(false));

		form.addEventListener("submit", (event) => {
			event.preventDefault();

			// Answered before the fields are checked, so a refusal said now is not replaced by the earlier save's answer.
			if (saving || needsReload) {
				if (needsReload) {
					if (status) status.textContent = RELOAD_FIRST;
				} else sayBusy(status);

				return;
			}

			const data = new FormData(form);

			if (form.dataset.part === "values") {
				const day = String(data.get("dayValue") ?? "").trim();
				const contingency = String(data.get("contingencyPercent") ?? "").trim();

				const dayInput =
					form.querySelector<HTMLInputElement>('[name="dayValue"]');

				const contingencyInput = form.querySelector<HTMLInputElement>(
					'[name="contingencyPercent"]',
				);

				const problems: [HTMLInputElement | null, string][] = [];

				if (
					dayInput?.validity.badInput ||
					(day !== "" &&
						!(/^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 10000))
				)
					problems.push([
						dayInput,
						"The day value must be whole dollars from 1 to 10,000, or empty.",
					]);

				if (!/^\d+$/.test(contingency) || Number(contingency) > 100)
					problems.push([
						contingencyInput,
						"The contingency must be a whole number from 0 to 100.",
					]);

				for (const input of [dayInput, contingencyInput])
					markValue(
						input,
						problems.some(([field]) => field === input),
					);

				if (problems.length > 0) {
					if (status)
						status.textContent = problems.map(([, say]) => say).join(" ");
					problems[0]?.[0]?.focus();

					return;
				}

				void send(
					{
						action: "values",
						dayValue: day === "" ? null : Number(day),
						contingencyPercent: Number(contingency),
						expectedVersion: expectedVersion(),
					},
					form,
					status,
				);

				return;
			}

			const text = String(data.get("market") ?? "").trim();

			if (text === "") {
				if (status)
					status.textContent = clearOffered(form)
						? "Paste the research file, or use Clear research to remove it."
						: "Paste the research file to save it.";
				markResearch(true);

				return;
			}

			let market: RawValue;

			try {
				market = JSON.parse(text);
			} catch {
				if (status)
					status.textContent =
						"That is not valid JSON. Check the file and paste it again.";
				markResearch(true);

				return;
			}

			// A pasted null is not a research file: clearing goes through Clear research and its question.
			if (!Predicate.isObject(market) || Array.isArray(market)) {
				if (status)
					status.textContent = clearOffered(form)
						? "That is not a research file. To remove the saved research, use Clear research."
						: "That is not a research file. Paste the file the research produced.";
				markResearch(true);

				return;
			}

			void send(
				{ action: "market", market, expectedVersion: expectedVersion() },
				form,
				status,
			);
		});

		form
			.querySelector<HTMLButtonElement>("[data-pricing-clear]")
			?.addEventListener("click", () => {
				if (saving || needsReload) {
					if (needsReload) {
						if (status) status.textContent = RELOAD_FIRST;
					} else sayBusy(status);

					return;
				}

				const box = form.querySelector<HTMLTextAreaElement>(
					"[data-pricing-market]",
				);

				// Clearing empties the box too, so text the owner changed there and has not saved is named before it goes.
				const changed = box !== null && box.value !== box.defaultValue;

				if (
					!confirm(
						changed
							? "Clear the saved market research? What you changed in the research box is not saved and will be lost too."
							: "Clear the saved market research?",
					)
				)
					return;
				void send(
					{
						action: "market",
						market: null,
						expectedVersion: expectedVersion(),
					},
					form,
					status,
				);
			});
	}
}
