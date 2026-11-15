import { setupFormSubmission } from "~/scripts/form-submission";

/**
 * The confirmation's reply line, in three parts so the address can be set apart. The route answers ok only once the
 * owner's copy is accepted for delivery, with the visitor's address as its Reply-To, so the reply goes to what they typed.
 */
export function contactReplyLine(name: string, email: string) {
	const firstName = name.trim().split(/\s+/)[0] || "there";

	return [
		`Thanks, ${firstName}. I’ll read it myself and reply by email to `,
		email.trim(),
		".",
	] as const;
}

export function setupContactForm() {
	// ContactForm.astro, which loads this script, always renders #contact-form; a missing form still fails later, as before.
	const form = document.querySelector<HTMLFormElement>("#contact-form")!;
	const success = document.getElementById("contact-success")!;

	setupFormSubmission({
		form,
		endpoint: "/api/contact",
		success,
		payload: (data) => ({
			name: String(data.get("name") ?? ""),
			email: String(data.get("email") ?? ""),
			company: String(data.get("company") ?? ""),
			description: String(data.get("description") ?? ""),
		}),
		onSuccess: () => {
			const data = new FormData(form);
			const reply = success.querySelector("[data-contact-reply]");

			const [before, email, after] = contactReplyLine(
				String(data.get("name") ?? ""),
				String(data.get("email") ?? ""),
			);

			// Without an address the page keeps its general sentence.
			if (!reply || !email) return;

			const address = document.createElement("strong");
			address.textContent = email;
			reply.replaceChildren(before, address, after);
		},
	});
}
