// The Get in touch switchboard at both widths: a line reached by the plug, then the message line
// connected with its form open. Captures run with reduced motion, so the plug lands without animating.
import { stubTurnstile } from "../turnstile-stub.mjs";

const VIEWPORTS = ["desktop", "phone"];

export default {
	title: "Get in touch switchboard",
	async run({ capture }) {
		const reached = [];
		const connected = [];

		for (const viewport of VIEWPORTS) {
			reached.push({
				file: await capture({
					file: `contact-switchboard-reach-${viewport}.png`,
					path: "/contact",
					viewport,
					// A fine pointer reaches on hover; a phone reaches on keyboard focus.
					prepare: async (page) => {
						const song = page.locator('a[data-line="song"]');

						if (viewport === "desktop")
							await song.locator(".line-title").hover();
						else await song.focus();
						await page.waitForTimeout(100);
					},
				}),
				caption: `The plug reaching toward Start your song (${viewport})`,
			});

			connected.push({
				file: await capture({
					file: `contact-switchboard-message-${viewport}.png`,
					path: "/contact",
					viewport,
					prepare: async (page) => {
						await stubTurnstile(page);
						await page.locator('a[data-line="message"] .line-title').click();
						await page
							.locator("[data-message-panel]")
							.waitFor({ state: "visible" });
						await page.waitForTimeout(100);
					},
				}),
				caption: `Send a message connected, its lamp lit and the form open (${viewport})`,
			});
		}

		return [
			{ title: "A line reached", images: reached },
			{ title: "The message line connected", images: connected },
		];
	},
};
