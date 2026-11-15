import { greetingName, setupFormSubmission } from "~/scripts/form-submission";

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
	// The fields stay editable while a send is in flight, so the confirmation names what was sent, not what the fields hold now.
	let sent = { name: "", email: "" };

	setupFormSubmission({
		form,
		endpoint: "/api/contact",
		success,
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
