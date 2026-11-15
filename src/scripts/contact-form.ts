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

export function setupContactForm() {
	// ContactForm.astro, which loads this script, always renders #contact-form; a missing form still fails later, as before.
	const form = document.querySelector<HTMLFormElement>("#contact-form")!;
	const success = document.getElementById("contact-success")!;
	const panel = document.getElementById("contact-hold");
	const status = form.querySelector<HTMLElement>("[data-form-status]");
	// The fields stay editable while a send is in flight, so the confirmation names what was sent, not what the fields hold now.
	let sent = { name: "", email: "" };

	/**
	 * Shows the message as it will be sent and waits CONTACT_HOLD_SECONDS before sending it. Nothing reaches the server
	 * until then: Undo and edit brings the form back unchanged, Send now skips the wait, and leaving the page sends
	 * nothing, so the browser asks first. A form the server would refuse is not held, so its messages show at once.
	 */
	const hold = () =>
		new Promise<boolean>((resolve) => {
			if (!panel || !form.checkValidity()) {
				resolve(true);

				return;
			}

			const data = new FormData(form);
			const count = panel.querySelector<HTMLElement>("[data-hold-count]");
			const listening = new AbortController();
			const deadline = Date.now() + CONTACT_HOLD_SECONDS * 1000;
			let timer: ReturnType<typeof setInterval> | undefined;
			let done = false;

			const finish = (send: boolean) => {
				if (done) return;
				done = true;
				clearInterval(timer);
				listening.abort();
				panel.hidden = true;
				form.hidden = false;

				if (send) status?.focus();
				else {
					if (status)
						status.textContent =
							"Not sent. Edit your message, then send it again.";
					form.querySelector<HTMLElement>('[name="email"]')?.focus();
				}

				resolve(send);
			};

			const tick = () => {
				const left = secondsLeft(deadline, Date.now());

				if (count) count.textContent = holdCountText(left);

				if (left === 0) finish(true);
			};

			for (const [selector, value] of [
				["[data-hold-email]", String(data.get("email") ?? "").trim()],
				["[data-hold-message]", String(data.get("description") ?? "")],
			] as const) {
				const node = panel.querySelector<HTMLElement>(selector);

				if (node) node.textContent = value;
			}

			panel
				.querySelector("[data-hold-undo]")
				?.addEventListener("click", () => finish(false), {
					signal: listening.signal,
				});
			panel
				.querySelector("[data-hold-send]")
				?.addEventListener("click", () => finish(true), {
					signal: listening.signal,
				});
			window.addEventListener(
				"beforeunload",
				(event) => event.preventDefault(),
				{ signal: listening.signal },
			);

			if (status) status.textContent = "";
			tick();
			timer = setInterval(tick, 250);
			form.hidden = true;
			panel.hidden = false;
			panel.focus();
		});

	setupFormSubmission({
		form,
		endpoint: "/api/contact",
		success,
		hold,
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
		onSuccess: () => {
			const reply = success.querySelector("[data-contact-reply]");
			const line = contactReplyLine(sent.name, sent.email);

			// Without an address the page keeps its general sentence.
			if (reply && line) reply.textContent = line;
		},
	});
}
