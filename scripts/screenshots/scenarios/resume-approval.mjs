// A fictional request gets a protected owner confirmation page, then an expired-request
// answer when approved. The link cannot match a stored request in the local preview.
const path = "/owner/resume-approve?id=00000000-0000-4000-8000-000000000000";

export default {
	title: "Resume approval",
	async run({ capture }) {
		const steps = [];

		for (const [title, name, expired] of [
			["Confirm resume delivery", "confirm", false],
			["Expired approval after submitting", "expired", true],
		]) {
			const images = [];

			for (const viewport of ["desktop", "phone"]) {
				const file = await capture({
					file: `resume-approval-${name}-${viewport}.png`,
					path,
					viewport,
					owner: true,
					expectedResponses: expired
						? [{ path: "/owner/resume-approve", status: 404 }]
						: [],
					prepare: async (page) => {
						const button = page.getByRole("button", {
							name: "Approve and send resume",
						});

						await button.waitFor();

						if (!expired) return;

						const answer = page.waitForResponse(
							(response) =>
								new URL(response.url()).pathname === "/owner/resume-approve" &&
								response.request().method() === "POST",
						);

						await button.click();
						const response = await answer;

						if (response.status() !== 404)
							throw new Error("Expected the fictional request to be expired.");
						await page
							.getByRole("heading", {
								name: "Already processed or expired",
							})
							.waitFor();
					},
				});

				images.push({ file, caption: `${title} (${viewport})` });
			}

			steps.push({ title, images });
		}

		return steps;
	},
};
