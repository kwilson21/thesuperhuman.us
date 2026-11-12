import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { expectSource } from "../helpers/source-text";

const contact = readFileSync(
	new URL("../../src/components/ContactForm.astro", import.meta.url),
	"utf8",
);

const home = readFileSync(
	new URL("../../src/scripts/home-contact.ts", import.meta.url),
	"utf8",
);

it("loads the Contact Turnstile SDK only after the collapsed disclosure opens", () => {
	expect(contact).not.toContain(
		'src="https://challenges.cloudflare.com/turnstile/v0/api.js"',
	);
	expectSource(home).toContain("message.addEventListener('toggle'");
	expectSource(home).toContain(
		"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
	);
});

it("clears the retry warning when the widget successfully renders", () => {
	expectSource(home).toContain(
		"if (error) { error.textContent = ''; error.hidden = true; }",
	);
});
