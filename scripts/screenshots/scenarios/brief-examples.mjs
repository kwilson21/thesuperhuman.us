// The project brief's example answers, opened on each written question, so their wording can be reviewed.
// It opens on the starting points, as software-brief does: a ?path= link lands on a written question, whose
// suggestion pass would call the real Turnstile before the stub is in place. Suggestions are off, so nothing is
// sent and no suggestion shows.
import { stubTurnstile } from "../turnstile-stub.mjs";

const questions = [
	["workflow", 1, "desktop"],
	["workflow", 1, "phone"],
	["workflow", 2, "desktop"],
	["webapp", 1, "desktop"],
	["webapp", 2, "desktop"],
	["website", 1, "desktop"],
];

export default {
	title: "Project brief example answers",
	async run({ capture }) {
		const images = [];

		for (const [path, question, viewport] of questions) {
			const file = await capture({
				file: `brief-examples-${path}-${question}-${viewport}.png`,
				path: "/software/start",
				viewport,
				prepare: async (page) => {
					await stubTurnstile(page);
					await page.addInitScript(() => {
						localStorage.removeItem("software-brief-draft");
						localStorage.setItem("software-suggestions", "off");
					});
					await page.reload();
					await page.waitForFunction(() => !!window.turnstile);
					await page.locator(`[name=path][value=${path}]`).check();

					if (question === 2) {
						await page
							.locator('[data-step="1"] textarea')
							.fill("A short first answer.");
						await page.click("[data-next]");
					}

					await page
						.locator(`[data-step="${question}"] [data-examples-toggle]`)
						.click();
					// Show the toggle at rest, not in its hover colour.
					await page.mouse.move(0, 0);
				},
			});

			images.push({
				file,
				caption: `${path} question ${question} with its example answers open (${viewport})`,
			});
		}

		return [{ title: "Example answers", images }];
	},
};
