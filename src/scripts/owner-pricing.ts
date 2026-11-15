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

async function send(
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
		});

		const answer: RawValue = await response.json().catch(() => null);
		const error = field(answer, "error");

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

			// What was saved is now what the page was drawn with.
			for (const input of form.querySelectorAll<
				HTMLInputElement | HTMLTextAreaElement
			>("input, textarea"))
				input.defaultValue = input.value;

			const others = forms.filter((each) => each !== form && unsaved(each));

			if (body.action === "market" && others.length === 0) {
				location.reload();

				return;
			}

			if (status)
				status.textContent =
					body.action === "market"
						? "Saved. Save or clear your other changes, then reload the page to see the new ranges."
						: "Saved.";

			return;
		}

		if (status)
			status.textContent = Predicate.isString(error)
				? error
				: "Your pricing could not be saved. Try again.";
	} catch {
		if (status)
			status.textContent = "Your pricing could not be saved. Try again.";
	}
}

export function setupOwnerPricing() {
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
