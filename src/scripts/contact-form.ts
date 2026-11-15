import { greetingName, setupFormSubmission } from "~/scripts/form-submission";

/** How long a message waits in the browser, where it can still be undone, before it is sent. */
export const CONTACT_HOLD_SECONDS = 15;

export const holdCountText = (seconds: number) =>
	`Sending in ${seconds} second${seconds === 1 ? "" : "s"}.`;

/** Whole seconds left before a hold that ends at `deadline` sends, never below zero. */
export const secondsLeft = (deadline: number, now: number) =>
	Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * The confirmation's reply line, or null without an address. The route answers ok only once the owner's copy is
 * accepted for delivery, with the visitor's address as its Reply-To, so the reply goes to what they typed.
 */
export function contactReplyLine(name: string, email: string) {
	const address = email.trim();

	return address
		? `Thanks, ${greetingName(name)}. I’ll read it myself and reply by email to ${address}.`
		: null;
}

/** Who the message is from, as the hold shows it: the name, and the company when there is one. */
export const holdFromText = (name: string, company: string) =>
	[name.trim(), company.trim()].filter(Boolean).join(", ");

export function setupContactForm() {
	// ContactForm.astro, which loads this script, always renders #contact-form; a missing form still fails later, as before.
	const form = document.querySelector<HTMLFormElement>("#contact-form")!;
	const success = document.getElementById("contact-success")!;
	const panel = document.getElementById("contact-hold");
	const status = form.querySelector<HTMLElement>("[data-form-status]");
	const count = panel?.querySelector<HTMLElement>("[data-hold-count]");
	const undo = panel?.querySelector<HTMLButtonElement>("[data-hold-undo]");
	const sendNow = panel?.querySelector<HTMLButtonElement>("[data-hold-send]");
	// The fields stay editable while a send is in flight, so the confirmation names what was sent, not what the fields hold now.
	let sent = { name: "", email: "" };
	let notSent: ReturnType<typeof setTimeout> | undefined;

	const showCount = (text: string) => {
		// Only a change is written, so the timer's text is not rewritten under a screen reader every tick.
		if (count && count.textContent !== text) count.textContent = text;
	};

	/**
	 * Shows the message as it will be sent and waits CONTACT_HOLD_SECONDS before sending it. Nothing reaches the server
	 * until then: Undo and edit brings the form back unchanged, and Send now skips the wait. Undo only works on the page,
	 * so leaving it, or switching away from it, sends at once (the request is kept alive past the page). Not held: a form
	 * the browser's own field checks refuse, or one whose security check has no token yet, so the server's messages show
	 * at once. The server refuses some addresses the browser accepts; those are held, then refused.
	 */
	const hold = () =>
		new Promise<boolean>((resolve) => {
			const data = new FormData(form);

			if (
				!panel ||
				!form.checkValidity() ||
				!String(data.get("cf-turnstile-response") ?? "")
			) {
				resolve(true);

				return;
			}

			const listening = new AbortController();
			const deadline = Date.now() + CONTACT_HOLD_SECONDS * 1000;
			let timer: ReturnType<typeof setInterval> | undefined;
			let done = false;

			const finish = (send: boolean) => {
				if (done) return;
				done = true;
				clearInterval(timer);
				listening.abort();

				if (send) {
					// The panel stays up while the message sends; the form comes back only if the send fails. Focus inside the
					// panel moves to the count, so "Sending…" is read out and focus does not drop with the buttons this
					// disables; focus elsewhere on the page stays where it is.
					const focusHere =
						panel.contains(document.activeElement) ||
						document.activeElement === document.body;

					showCount("Sending…");

					for (const button of [undo, sendNow])
						if (button) button.disabled = true;

					if (focusHere) count?.focus();
				} else {
					panel.hidden = true;
					form.hidden = false;
					form.querySelector<HTMLElement>('[name="email"]')?.focus();
					// Set once the form is back in view, so the status is read out as it appears.
					notSent = setTimeout(() => {
						if (status)
							status.textContent =
								"Not sent. Edit your message, then send it again.";
					}, 100);
				}

				resolve(send);
			};

			const tick = () => {
				const left = secondsLeft(deadline, Date.now());
				showCount(holdCountText(left));

				if (left === 0) finish(true);
			};

			for (const [selector, value] of [
				["[data-hold-email]", String(data.get("email") ?? "").trim()],
				[
					"[data-hold-from]",
					holdFromText(
						String(data.get("name") ?? ""),
						String(data.get("company") ?? ""),
					),
				],
				["[data-hold-message]", String(data.get("description") ?? "")],
			] as const) {
				const node = panel.querySelector<HTMLElement>(selector);

				if (node) node.textContent = value;
			}

			const { signal } = listening;
			undo?.addEventListener("click", () => finish(false), { signal });
			sendNow?.addEventListener("click", () => finish(true), { signal });
			window.addEventListener("pagehide", () => finish(true), { signal });
			document.addEventListener(
				"visibilitychange",
				() => {
					if (document.visibilityState === "hidden") finish(true);
				},
				{ signal },
			);

			for (const button of [undo, sendNow]) if (button) button.disabled = false;

			clearTimeout(notSent);

			if (status) status.textContent = "";
			tick();
			timer = setInterval(tick, 250);
			form.hidden = true;
			panel.hidden = false;
			// The form was taller than the panel, so the panel's top can open above the screen: bring the heading and
			// count into view before focusing, which would not scroll a panel that is already partly in view.
			panel.querySelector("h3")?.scrollIntoView({ block: "nearest" });
			panel.focus({ preventScroll: true });
		});

	setupFormSubmission({
		form,
		endpoint: "/api/contact",
		success,
		hold,
		keepalive: true,
		payload: (data) => {
			const body = {
				name: String(data.get("name") ?? ""),
				email: String(data.get("email") ?? ""),
				company: String(data.get("company") ?? ""),
				description: String(data.get("description") ?? ""),
			};

			sent = body;

			return body;
		},
		onSendingChange: (sending) => {
			// A send that did not succeed returns to the form, where its messages show.
			if (sending || !success.hidden || !panel) return;
			panel.hidden = true;
			form.hidden = false;
		},
		onSuccess: () => {
			if (panel) panel.hidden = true;
			const reply = success.querySelector("[data-contact-reply]");
			const line = contactReplyLine(sent.name, sent.email);

			// Without an address the page keeps its general sentence.
			if (reply && line) reply.textContent = line;
		},
	});
}
