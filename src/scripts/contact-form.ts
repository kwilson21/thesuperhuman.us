import { setupFormSubmission } from "~/scripts/form-submission";

export function setupContactForm() {
	const form = document.getElementById("contact-form") as HTMLFormElement;
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
