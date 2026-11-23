// The market refresh's buttons on /owner/pricing (docs/plans/2026-11-market-refresh.md, section 1): ask for a search,
// use the proposed figures, or discard them. One request at a time; a request whose answer never arrives asks for a
// reload before another. Use sends the version the research form holds at the press (src/scripts/owner-pricing.ts keeps
// it current after a save), so a save from this page is never mistaken for one from another tab.
import * as Predicate from "effect/Predicate";
import type { RawValue } from "../lib/fields";

/** A field of the route's answer, unread; undefined when the answer is not an object or lacks it. */
const field = (answer: RawValue, name: string): RawValue =>
	Predicate.isObject(answer) &&
	!Array.isArray(answer) &&
	Object.hasOwn(answer, name)
		? answer[name]
		: undefined;

export function setupPricingRefresh() {
	const section = document.querySelector<HTMLElement>("[data-pricing-refresh]");

	if (!section) return;

	const status = section.querySelector<HTMLElement>("[data-refresh-status]");

	const heading = section.querySelector<HTMLElement>(
		"#pricing-refresh-heading",
	);

	const endpoint = section.dataset.endpoint ?? "/api/owner/pricing-refresh";

	const proposalId =
		section.querySelector<HTMLElement>("[data-proposal]")?.dataset.proposal ??
		"";

	let busy = false;
	let needsReload = false;

	const say = (text: string) => {
		if (status) status.textContent = text;
	};

	const send = async (
		button: HTMLButtonElement,
		body: Record<string, string | number>,
		done: () => void,
	) => {
		if (needsReload) {
			say(
				"The last request got no answer, so it may have gone through. Reload the page before trying again.",
			);

			return;
		}

		if (busy) {
			say("A request is on its way. Try again when it answers.");

			return;
		}

		busy = true;
		button.setAttribute("aria-disabled", "true");
		say("Sending…");

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});

			const answer: RawValue = await response.json().catch(() => null);
			const error = field(answer, "error");

			if (response.ok && field(answer, "ok") === true) done();
			else
				say(
					Predicate.isString(error) && error
						? error
						: "That did not go through. Try again.",
				);
		} catch {
			needsReload = true;
			say(
				"The request got no answer, so it may have gone through. Reload the page before trying again.",
			);
		} finally {
			busy = false;
			button.removeAttribute("aria-disabled");
		}
	};

	section.addEventListener("click", (event) => {
		const button =
			event.target instanceof Element
				? event.target.closest<HTMLButtonElement>("button")
				: null;

		if (!button) return;

		if (button.matches("[data-refresh-ask]"))
			void send(button, { action: "ask" }, () => {
				button.hidden = true;
				heading?.focus();
				say("Asked. The site searches at its next daily check, within a day.");
			});
		else if (button.matches("[data-refresh-use]")) {
			const form = document.querySelector<HTMLElement>(
				'[data-pricing-form][data-part="market"]',
			);

			void send(
				button,
				{
					action: "use",
					proposalId,
					expectedVersion: Number(form?.dataset.version ?? "0"),
				},
				() => {
					say("These figures are now your research. Reloading the page…");
					location.reload();
				},
			);
		} else if (button.matches("[data-refresh-discard]"))
			void send(button, { action: "discard", proposalId }, () => {
				say("Discarded. Reloading the page…");
				location.reload();
			});
	});
}
