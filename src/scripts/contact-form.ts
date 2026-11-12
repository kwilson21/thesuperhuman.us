import { setupFormSubmission } from "~/scripts/form-submission";

export function setupContactForm() {
	const form = document.querySelector<HTMLFormElement>("#contact-form")!;
	setupFormSubmission({
		form,
		endpoint: "/api/contact",
		success: document.getElementById("contact-success")!,
		payload: (data) => ({
			name: String(data.get("name") ?? ""),
			email: String(data.get("email") ?? ""),
			company: String(data.get("company") ?? ""),
			description: String(data.get("description") ?? ""),
		}),
	});
}
