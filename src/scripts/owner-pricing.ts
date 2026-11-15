// The owner's pricing page (src/pages/owner/pricing.astro): each form is sent as JSON to /api/owner/pricing with the
// version the page last saw. A saved form takes the new version (both forms do), so the next save is not refused. New
// research reloads the page to show its table, unless the other form holds unsaved changes, which a reload would lose.
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

/** Where the page notes, across the reload new research triggers, that it was saved. */
const SAVED_KEY = "owner-pricing-saved";

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
		if (status)
			status.textContent = "A save is on its way. Try again when it answers.";

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

	try {
		await save(body, form, status);
	} finally {
		saving = false;

		for (const button of buttons) button.removeAttribute("aria-disabled");
	}
}

async function save(
	body: PricingRequest,
	form: HTMLFormElement,
	status: Status,
) {
	if (status) status.textContent = "Saving…";

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

			// What was saved is now what the page was drawn with.
			for (const input of form.querySelectorAll<
				HTMLInputElement | HTMLTextAreaElement
			>("input, textarea"))
				input.defaultValue = input.value;

			const others = forms.filter((each) => each !== form && unsaved(each));

			if (body.action === "market" && others.length === 0) {
				// The reloaded page says it was saved: the status here would go with the page.
				try {
					sessionStorage.setItem(
						SAVED_KEY,
						body.market === null ? "cleared" : "saved",
					);
				} catch {
					// Without storage the reloaded table is the confirmation.
				}

				location.reload();

				return;
			}

			if (status)
				status.textContent =
					body.action === "market"
						? "Saved. Save or undo your day value and contingency changes, then reload the page to see the new ranges."
						: "Saved.";

			return;
		}

		if (status)
			status.textContent = Predicate.isString(error)
				? error
				: "Your pricing could not be saved. Try again.";
	} catch {
		// The request or its answer was lost on the way: the save may have reached the store.
		needsReload = true;

		if (status) status.textContent = RELOAD_FIRST;
	}
}

export function setupOwnerPricing() {
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
		document
			.querySelector<HTMLElement>("#pricing-market-heading")
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

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const data = new FormData(form);

			if (form.dataset.part === "values") {
				const day = String(data.get("dayValue") ?? "").trim();

				void send(
					{
						action: "values",
						dayValue: day === "" ? null : Number(day),
						contingencyPercent: Number(data.get("contingencyPercent")),
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
					status.textContent =
						"Paste the research file, or use Clear research to remove it.";

				return;
			}

			let market: RawValue;

			try {
				market = JSON.parse(text);
			} catch {
				if (status)
					status.textContent =
						"That is not valid JSON. Check the file and paste it again.";

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
					if (status)
						status.textContent = needsReload
							? RELOAD_FIRST
							: "A save is on its way. Try again when it answers.";

					return;
				}

				if (!confirm("Clear the saved market research?")) return;
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
