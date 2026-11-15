// The owner's pricing page (src/pages/owner/pricing.astro): each form is sent as JSON to /api/owner/pricing with the
// version the page was rendered at, and the page reloads once it is saved, so what it shows is what is stored.
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

async function send(body: PricingRequest, status: Status) {
	if (status) status.textContent = "Saving…";

	try {
		const response = await fetch("/api/owner/pricing", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const answer: RawValue = await response.json().catch(() => null);
		const error = field(answer, "error");

		if (response.ok && field(answer, "ok") === true) {
			if (status) status.textContent = "Saved.";
			location.reload();

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
		const expectedVersion = Number(form.dataset.version ?? "0");

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
						expectedVersion,
					},
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

			void send({ action: "market", market, expectedVersion }, status);
		});

		form
			.querySelector<HTMLButtonElement>("[data-pricing-clear]")
			?.addEventListener("click", () => {
				if (!confirm("Clear the saved market research?")) return;
				void send({ action: "market", market: null, expectedVersion }, status);
			});
	}
}
