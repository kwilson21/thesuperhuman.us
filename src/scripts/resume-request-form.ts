import { setupFormSubmission } from "~/scripts/form-submission";

export function setupResumeRequestForm() {
	const form = document.querySelector<HTMLFormElement>("#resume-request-form")!;

	setupFormSubmission({
		form,
		endpoint: "/api/resume-request",
		success: document.getElementById("resume-request-success")!,
		payload: (data) => ({
			name: String(data.get("name") ?? ""),
			email: String(data.get("email") ?? ""),
			company: String(data.get("company") ?? ""),
			audience: "general",
			note: String(data.get("note") ?? ""),
		}),
	});
}
