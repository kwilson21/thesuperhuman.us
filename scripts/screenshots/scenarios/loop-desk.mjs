// The A/B comparison's listening desk on the audio portfolio, at both widths: Loop on with its passage shaded on the
// waveforms, then Loop and Flip on with the shortest length, then Match loudness on with the loudness meters closing
// the gap. Nothing plays; the desk is set before Play.
const VIEWPORTS = ["desktop", "phone"];
const PATH = "/audio/portfolio";

export default {
	title: "Listening desk",
	async run({ capture }) {
		const steps = [];

		const shot = async (title, name, prepare) => {
			const images = [];

			for (const viewport of VIEWPORTS) {
				images.push({
					file: await capture({
						file: `loop-desk-${name}-${viewport}.png`,
						path: PATH,
						viewport,
						selector: '[data-comparison][data-initialized="true"]',
						prepare: async (page) => {
							await page.waitForSelector(
								'[data-comparison][data-initialized="true"] [data-loop]',
							);
							await prepare(page);
						},
					}),
					caption: title,
				});
			}

			steps.push({ title, images });
		};

		await shot(
			"Loop on: 8 seconds from where the visitor is",
			"loop",
			async (page) => {
				await page.locator("[data-loop]").first().click();
			},
		);
		await shot("Loop and Flip on, 4 seconds", "flip", async (page) => {
			await page.locator("[data-loop]").first().click();
			await page.locator("[data-loop-length]").first().selectOption("4");
			await page.locator("[data-loop-flip]").first().check();
		});

		await shot(
			"Match loudness on: the master's meter comes down to the mix's",
			"matched",
			async (page) => {
				await page.locator("[data-match-level]").first().check();
			},
		);

		return steps;
	},
};
