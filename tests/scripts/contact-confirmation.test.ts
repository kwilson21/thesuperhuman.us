import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { contactReplyLine, setupContactForm } from "~/scripts/contact-form";
import { contactOwnerMessage, contactReplyMessage } from "~/lib/resend";
import type { ContactInput } from "~/server/contact-input";

const form = readFileSync("src/components/ContactForm.astro", "utf8");
const success = form.slice(form.indexOf('<div id="contact-success"'));

afterEach(() => {
	vi.unstubAllGlobals();
});

it("names the visitor and the address the reply goes to", () => {
	expect(contactReplyLine("  Alex  Example ", " alex@example.com ")).toEqual([
		"Thanks, Alex. I’ll read it myself and reply by email to ",
		"alex@example.com",
		".",
	]);
	expect(contactReplyLine("   ", "alex@example.com")[0]).toBe(
		"Thanks, there. I’ll read it myself and reply by email to ",
	);
});

it("names the address that was sent, even when the field changes while sending", async () => {
	const values = new Map([
		["name", "Alex Example"],
		["email", "alex@example.com"],
		["company", ""],
		["description", "Hello"],
	]);

	const element = () => ({
		textContent: "",
		hidden: false,
		disabled: false,
		focus: vi.fn(),
		setAttribute: vi.fn(),
		removeAttribute: vi.fn(),
	});

	const button = { ...element(), textContent: "Send message" };
	const status = element();
	const reply = { replaceChildren: vi.fn() };
	const page = { ...element(), querySelector: () => reply };

	let submit:
		| ((event: { preventDefault(): void }) => Promise<void>)
		| undefined;

	const contactForm = {
		...element(),
		id: "contact-form",
		dataset: { available: "true" },
		elements: [],
		querySelector: (selector: string) =>
			selector === 'button[type="submit"]'
				? button
				: selector === "[data-form-status]"
					? status
					: null,
		querySelectorAll: () => [],
		addEventListener: (type: string, listener: typeof submit) => {
			if (type === "submit") submit = listener;
		},
	};

	let respond: (response: Response) => void = () => {};

	vi.stubGlobal("window", {});
	vi.stubGlobal("document", {
		querySelector: () => contactForm,
		getElementById: () => page,
		createElement: () => ({ textContent: "" }),
	});
	vi.stubGlobal(
		"FormData",
		class {
			get(key: string) {
				return values.get(key) ?? null;
			}
		},
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		),
	);

	setupContactForm();
	const sending = submit!({ preventDefault: () => {} });
	values.set("name", "Sam Other");
	values.set("email", "changed@example.com");
	respond(Response.json({ ok: true }));
	await sending;

	expect(reply.replaceChildren).toHaveBeenCalledWith(
		"Thanks, Alex. I’ll read it myself and reply by email to ",
		{ textContent: "alex@example.com" },
		".",
	);
});

it("says what happens next without promising a reply time", () => {
	for (const sentence of [
		"<h3>Message received.</h3>",
		"Thanks for getting in touch. I’ll read it myself and reply by email.",
		"A short confirmation email should arrive soon. If it doesn’t, check your spam folder. Your message reached me either way.",
		'Typo in your address? Email me at <a href="mailto:kazon.wilson@thesuperhuman.us">kazon.wilson@thesuperhuman.us</a> so I can reach you.',
	])
		expect(success).toContain(sentence);

	expect(success).not.toMatch(/business day|within|hours|minutes|today/i);
});

it("rests on the flow the copy describes: the owner's copy replies to the visitor, and the visitor gets a confirmation", () => {
	const input: ContactInput = {
		name: "Alex Example",
		email: "alex@example.com",
		company: "",
		description: "Hello",
		turnstileToken: "token",
	};

	expect(
		contactOwnerMessage({
			input,
			from: "from@example.com",
			to: "owner@example.com",
		}).reply_to,
	).toBe("alex@example.com");
	expect(contactReplyMessage({ input, from: "from@example.com" }).to).toEqual([
		"alex@example.com",
	]);
	expect(readFileSync("src/server/flows/contact.ts", "utf8")).toMatch(
		/mail\s*\.send\(\s*contactReplyMessage\(\s*\{\s*input,\s*from\s*\}\s*\)\s*\)\s*\.pipe\(\s*Effect\.ignore\s*\)/,
	);
});
