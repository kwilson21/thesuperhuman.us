// The market refresh's buttons on /owner/pricing (docs/plans/2026-11-market-refresh.md, section 1): ask for a search,
// use the proposed figures, or discard them. One request at a time for the whole page, through the lock the pricing
// forms use (./owner-pricing-lock.ts), since Use saves the same record; a request whose answer never arrives asks for a
// reload before any other. Use sends the version the research form holds at the press (src/scripts/owner-pricing.ts
// keeps it current after a save), so a save from this page is never mistaken for one from another tab.
import * as Predicate from "effect/Predicate";
import type { RawValue } from "../lib/fields";
import {
	claimPage,
	markLost,
	pageWait,
	releasePage,
} from "./owner-pricing-lock";

/** A field of the route's answer, unread; undefined when the answer is not an object or lacks it. */
const field = (answer: RawValue, name: string): RawValue =>
	Predicate.isObject(answer) &&
	!Array.isArray(answer) &&
	Object.hasOwn(answer, name)
		? answer[name]
		: undefined;

/** How long a request waits for its answer before the page treats it as lost, as the pricing forms do. */
const ANSWER_TIMEOUT_MS = 30000;

const NO_ANSWER =
	"The request got no answer, so it may have gone through. Reload the page before trying again.";

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

	const say = (text: string) => {
		if (status) status.textContent = text;
	};

	const send = async (
		button: HTMLButtonElement,
		body: Record<string, string | number>,
		done: () => void,
	) => {
		if (pageWait() === "reload") {
			say(
				"The last request got no answer, so it may have gone through. Reload the page before trying again.",
			);

			return;
		}

		if (!claimPage()) {
			say("A request is on its way. Try again when it answers.");

			return;
		}

		button.setAttribute("aria-disabled", "true");
		say("Sending…");

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
			});

			const answer: RawValue = await response.json().catch(() => null);
			const error = field(answer, "error");

			// No readable answer (a timeout at the edge, a cut connection): the request may or may not have gone through.
			if (answer === null) {
				markLost();
				say(NO_ANSWER);
			} else if (response.ok && field(answer, "ok") === true) done();
			else
				say(
					Predicate.isString(error) && error
						? error
						: "That did not go through. Try again.",
				);
		} catch {
			markLost();
			say(NO_ANSWER);
		} finally {
			releasePage();
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
