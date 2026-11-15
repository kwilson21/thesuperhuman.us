import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSource } from "../helpers/source-text";

const contact = readFileSync(
	new URL("../../src/components/ContactForm.astro", import.meta.url),
	"utf8",
);

const message = readFileSync(
	new URL("../../src/scripts/contact-message.ts", import.meta.url),
	"utf8",
);

const page = readFileSync(
	new URL("../../src/pages/contact.astro", import.meta.url),
	"utf8",
);

it("loads the Contact Turnstile SDK only when the message line opens the form", () => {
	expect(contact).not.toContain(
		'src="https://challenges.cloudflare.com/turnstile/v0/api.js"',
	);
	expect(page).not.toContain("challenges.cloudflare.com");
	expect(page).toContain(
		'<section id="message" class="message-panel" aria-labelledby="message-title" data-message-panel hidden>',
	);
	expectSource(message).toContain(
		"function open() { const wasHidden = panel.hidden; panel.hidden = false; void loadContactTurnstile()",
	);
	expect(message).toContain(
		"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
	);
});

it("clears the retry warning when the widget successfully renders", () => {
	expectSource(message).toContain(
		"if (error) { error.textContent = ''; error.hidden = true; }",
	);
});
