// The homepage contact form while a message is held before sending, after Undo and edit, and after it is sent, at
// both widths. The capture clock is pinned, so the hold's count stays at its start; the sent images use Send now. The
// send is answered locally, as the route answers once the owner's copy is accepted; no email is sent and the visitor
// is fictional.
import { stubTurnstile } from "../turnstile-stub.mjs";

const holdAnd = (then) => async (page) => {
	await stubTurnstile(page);
	await page.route("**/api/contact", (route) =>
		route.fulfill({ json: { ok: true } }),
	);
	await page.locator(".contact-disclosure summary").click();
	await page.waitForFunction(
		() =>
			!!document.querySelector('#contact-form [name="cf-turnstile-response"]'),
	);
	await page.fill("#cf-name", "Alex Example");
	await page.fill("#cf-email", "alex@example.com");
	await page.fill(
		"#cf-description",
		"I run a small studio and would like to talk about a booking tool.",
	);
	await page.click('#contact-form button[type="submit"]');
	await page.locator("#contact-hold").waitFor();

	if (then === "send") {
		await page.click("[data-hold-send]");
		await page.locator("#contact-success").waitFor();
	}

	if (then === "undo") {
		await page.click("[data-hold-undo]");
		await page.waitForFunction(() =>
			document
				.querySelector("#cf-status")
				?.textContent?.startsWith("Not sent."),
		);
	}

	// Show the buttons at rest, not in their hover colours.
	await page.mouse.move(0, 0);
};

export default {
	title: "Homepage contact confirmation",
	async run({ capture }) {
		const steps = [];

		for (const [title, name, then] of [
			["Held before sending, with Undo and edit", "hold", "wait"],
			["Undo and edit: back to the form, not sent", "undo", "undo"],
			["Message sent", "sent", "send"],
		]) {
			const images = [];

			for (const viewport of ["desktop", "phone"]) {
				const file = await capture({
					file: `home-contact-${name}-${viewport}.png`,
					path: "/",
					viewport,
					selector: "#contact",
					prepare: holdAnd(then),
				});

				images.push({ file, caption: `${title} (${viewport})` });
			}

			steps.push({ title, images });
		}

		return steps;
	},
};
