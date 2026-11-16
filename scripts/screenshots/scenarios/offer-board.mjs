// The offer board (docs/plans/2026-11-offer-board.md) on a fictional website brief, at both widths: the board before
// the owner asks, the suggestions a scripted stand-in gives (../offer-board-script.mjs), and the offer after the owner
// uses an outcome and a milestone. No model is called and nothing is saved or sent. No pricing is saved in the preview,
// so the prices say where to set them: the owner's numbers never appear in a capture.
import { scriptedOfferReply } from "../offer-board-script.mjs";

const BRIEF = {
	path: "website",
	purpose:
		"A home for my band on the web. Fans should hear new music, see upcoming shows near them and join the mailing list. Venues need a quick way to book us.",
	currentUrl: "",
	existing: "Photos from tour are ready; no page text yet.",
	updates: "self",
	company: "",
	timing: "flexible",
	timingDate: "",
	budgetNote: "",
	clientCopyStatus: "sent",
};

export default {
	title: "Offer board",
	async run({ capture, sql }) {
		sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES ('screenshot-offer','software','website','Sam Example','sam@example.com','A home for my band on the web.',
      '${JSON.stringify(BRIEF).replaceAll("'", "''")}','new','','2026-11-15T12:00:00.000Z','2026-11-15T12:00:00.000Z','00000000-0000-4000-8000-000000000043')`);
		const steps = [];

		const suggest = async (page) => {
			await page.route("**/api/owner/requests/*/offer-board", (route) =>
				route.fulfill({
					json: scriptedOfferReply(route.request().postData()),
				}),
			);
			await page
				.getByRole("button", { name: "Suggest an offer with AI" })
				.click();
			await page.waitForFunction(() =>
				document
					.querySelector("[data-offer-status]")
					?.textContent?.startsWith("Up to date"),
			);
			await page.waitForFunction(
				() => !document.querySelector(".offer-card.is-new"),
			);
		};

		for (const viewport of ["desktop", "phone"]) {
			const shot = async (name, caption, prepare) =>
				steps.push({
					title: `${caption}, ${viewport}`,
					images: [
						{
							file: await capture({
								file: `offer-board-${name}-${viewport}.png`,
								path: "/owner/requests/screenshot-offer",
								viewport,
								owner: true,
								prepare: async (page) => {
									await prepare?.(page);
									await page
										.locator("[data-offer-board]")
										.scrollIntoViewIfNeeded();
								},
							}),
							caption,
						},
					],
				});

			await shot("start", "The offer board before the owner asks");
			await shot(
				"suggested",
				"Suggestions for each part of the offer",
				suggest,
			);
			await shot(
				"used",
				"An outcome and a milestone used in the offer",
				async (page) => {
					await suggest(page);
					await page
						.locator('[data-offer-lane="outcome"] .offer-card')
						.first()
						.getByRole("button", { name: /^Use as outcome/ })
						.click();
					await page
						.locator('[data-offer-lane="milestones"] .offer-card')
						.first()
						.getByRole("button", { name: /^Add to the offer/ })
						.click();

					if (
						!(await page.locator('[name="outcome"]').inputValue()).startsWith(
							"A website for the band",
						)
					)
						throw new Error("Use did not fill the offer's outcome");
				},
			);

			steps.push({
				title: `The private pricing page, empty, ${viewport}`,
				images: [
					{
						file: await capture({
							file: `owner-pricing-${viewport}.png`,
							path: "/owner/pricing",
							viewport,
							owner: true,
						}),
						caption: "Where the owner sets their day value and research",
					},
				],
			});
		}

		return steps;
	},
};
