import { setupFormSubmission } from "~/scripts/form-submission";

export function setupReleaseInterest() {
	const form = document.querySelector<HTMLFormElement>("#release-interest");

	if (form) {
		const merchandise = form.querySelector<HTMLFieldSetElement>(
			"[data-merch-fields]",
		)!;

		const update = () => {
			const enabled = new FormData(form).get("interest") !== "song";
			merchandise.hidden = !enabled;
			merchandise.disabled = !enabled;
		};

		form
			.querySelectorAll('[name="interest"]')
			.forEach((input) => input.addEventListener("change", update));
		update();
		setupFormSubmission({
			form,
			endpoint: "/api/music-interest",
			success: document.getElementById("interest-success")!,
			payload: (data) => ({
				releaseId: form.dataset.releaseId,
				email: String(data.get("email") ?? ""),
				interest: data.get("interest"),
				merchandise: data.getAll("merchandise").map(String),
				suggestion: String(data.get("suggestion") ?? ""),
				consent: data.get("consent") === "on",
			}),
		});
	}
}
