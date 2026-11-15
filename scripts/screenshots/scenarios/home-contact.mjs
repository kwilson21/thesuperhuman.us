// The homepage contact form after a message is sent, at both widths. The send is answered locally, as the route
// answers once the owner's copy is accepted; no email is sent and the visitor is fictional.
import { stubTurnstile } from "../turnstile-stub.mjs";

export default {
	title: "Homepage contact confirmation",
	async run({ capture }) {
		const images = [];

		for (const viewport of ["desktop", "phone"]) {
			const file = await capture({
				file: `home-contact-sent-${viewport}.png`,
				path: "/",
				viewport,
				selector: "#contact",
				prepare: async (page) => {
					await stubTurnstile(page);
					await page.route("**/api/contact", (route) =>
						route.fulfill({ json: { ok: true } }),
					);
					await page.locator(".contact-disclosure summary").click();
					await page.waitForFunction(
						() =>
							!!document.querySelector(
								'#contact-form [name="cf-turnstile-response"]',
							),
					);
					await page.fill("#cf-name", "Alex Example");
					await page.fill("#cf-email", "alex@example.com");
					await page.fill(
						"#cf-description",
						"I run a small studio and would like to talk about a booking tool.",
					);
					await page.click('#contact-form button[type="submit"]');
					await page.locator("#contact-success").waitFor();
				},
			});

			images.push({
				file,
				caption: `Contact confirmation after sending (${viewport})`,
			});
		}

		return [{ title: "Message sent", images }];
	},
};
