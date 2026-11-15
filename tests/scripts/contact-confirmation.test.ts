import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	CONTACT_HOLD_SECONDS,
	contactReplyLine,
	holdCountText,
	secondsLeft,
	setupContactForm,
} from "~/scripts/contact-form";
import { greetingName } from "~/scripts/form-submission";
import { contactOwnerMessage, contactReplyMessage } from "~/lib/resend";
import type { ContactInput } from "~/server/contact-input";

const markup = readFileSync("src/components/ContactForm.astro", "utf8");
const success = markup.slice(markup.indexOf('<div id="contact-success"'));

const holdPanel = markup.slice(
	markup.indexOf('<div id="contact-hold"'),
	markup.indexOf('<div id="contact-success"'),
);

/** A stand-in element: the members the contact script and the shared form helper touch. */
const element = () => ({
	textContent: "",
	hidden: false,
	disabled: false,
	focus: vi.fn(),
	setAttribute: vi.fn(),
	removeAttribute: vi.fn(),
});

/** A button the script listens to; EventTarget gives addEventListener its signal option. */
class Clickable extends EventTarget {
	click() {
		this.dispatchEvent(new Event("click"));
	}
}

/**
 * The contact form as the script finds it, with a fetch that answers when the test says so. `valid` is what the
 * browser's own field checks say.
 */
function mount({ valid = true } = {}) {
	const values = new Map([
		["name", "Alex Example"],
		["email", "alex@example.com"],
		["company", ""],
		["description", "Hello"],
	]);

	const button = { ...element(), textContent: "Send message" };
	const status = element();
	const email = element();
	const reply = { textContent: "" };
	const page = { ...element(), querySelector: () => reply };
	const undo = new Clickable();
	const sendNow = new Clickable();

	const texts = new Map(
		["[data-hold-count]", "[data-hold-email]", "[data-hold-message]"].map(
			(selector) => [selector, { textContent: "" }],
		),
	);

	const buttons = new Map([
		["[data-hold-undo]", undo],
		["[data-hold-send]", sendNow],
	]);

	const panel = {
		...element(),
		hidden: true,
		querySelector: (selector: string) =>
			texts.get(selector) ?? buttons.get(selector) ?? null,
	};

	const text = (selector: string) => texts.get(selector)?.textContent;

	let submit: (() => Promise<void>) | undefined;

	const form = {
		...element(),
		id: "contact-form",
		dataset: { available: "true" },
		elements: [],
		checkValidity: () => valid,
		querySelector: (selector: string) =>
			({
				'button[type="submit"]': button,
				"[data-form-status]": status,
				'[name="email"]': email,
			})[selector] ?? null,
		querySelectorAll: () => [],
		addEventListener: (
			type: string,
			listener: (event: { preventDefault(): void }) => Promise<void>,
		) => {
			if (type === "submit")
				submit = () => listener({ preventDefault: () => {} });
		},
	};

	const answers: ((response: Response) => void)[] = [];
	const windowEvents = new EventTarget();

	vi.stubGlobal("window", windowEvents);
	vi.stubGlobal("document", {
		querySelector: () => form,
		getElementById: (id: string) =>
			({ "contact-success": page, "contact-hold": panel })[id] ?? null,
	});
	vi.stubGlobal(
		"FormData",
		class {
			get(key: string) {
				return values.get(key) ?? null;
			}
		},
	);

	const fetch = vi.fn(
		(_url: string, init: { body: string }) =>
			new Promise<Response>((resolve) => {
				answers.push(resolve);
				void init;
			}),
	);

	vi.stubGlobal("fetch", fetch);
	setupContactForm();

	const sentBodies = () =>
		fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

	// Leaving the page during a hold is asked about; the test reads whether the event was held back.
	const leave = () => {
		const event = new Event("beforeunload", { cancelable: true });
		windowEvents.dispatchEvent(event);

		return event.defaultPrevented;
	};

	return {
		values,
		form,
		panel,
		status,
		email,
		reply,
		undo,
		sendNow,
		text,
		fetch,
		sentBodies,
		leave,
		submit: () => submit!(),
		answer: () => answers.shift()!(Response.json({ ok: true })),
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("names the visitor and the address the reply goes to", () => {
	expect(contactReplyLine("  Alex  Example ", " alex@example.com ")).toBe(
		"Thanks, Alex. I’ll read it myself and reply by email to alex@example.com.",
	);
	expect(contactReplyLine("   ", "alex@example.com")).toBe(
		"Thanks, there. I’ll read it myself and reply by email to alex@example.com.",
	);
	expect(contactReplyLine("Alex", "  ")).toBeNull();
});

it("greets by the first word of a name without doubling its punctuation", () => {
	expect(greetingName("Dr. Jane Q. Example")).toBe("Dr");
	expect(greetingName("J. Smith")).toBe("J");
	expect(greetingName("Smith, Jane")).toBe("Smith");
	expect(greetingName("Alex")).toBe("Alex");
	expect(greetingName(undefined)).toBe("there");
	expect(greetingName(" ... ")).toBe("there");
});

it("counts whole seconds down to zero", () => {
	expect(secondsLeft(15_000, 0)).toBe(15);
	expect(secondsLeft(15_000, 14_001)).toBe(1);
	expect(secondsLeft(15_000, 15_000)).toBe(0);
	expect(secondsLeft(15_000, 20_000)).toBe(0);
	expect(holdCountText(2)).toBe("Sending in 2 seconds.");
	expect(holdCountText(1)).toBe("Sending in 1 second.");
});

it("holds the message where the visitor can check it, then sends it when the time is up", async () => {
	const contact = mount();
	const sending = contact.submit();

	expect(contact.fetch).not.toHaveBeenCalled();
	expect(contact.form.hidden).toBe(true);
	expect(contact.panel.hidden).toBe(false);
	expect(contact.panel.focus).toHaveBeenCalled();
	expect(contact.text("[data-hold-count]")).toBe(
		holdCountText(CONTACT_HOLD_SECONDS),
	);
	expect(contact.text("[data-hold-email]")).toBe("alex@example.com");
	expect(contact.text("[data-hold-message]")).toBe("Hello");
	expect(contact.leave()).toBe(true);

	await vi.advanceTimersByTimeAsync(CONTACT_HOLD_SECONDS * 1000 - 1000);
	expect(contact.text("[data-hold-count]")).toBe("Sending in 1 second.");
	expect(contact.fetch).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(1000);
	expect(contact.fetch).toHaveBeenCalledTimes(1);
	expect(contact.panel.hidden).toBe(true);
	expect(contact.leave()).toBe(false);
	contact.answer();
	await sending;

	expect(contact.reply.textContent).toBe(
		"Thanks, Alex. I’ll read it myself and reply by email to alex@example.com.",
	);
});

it("sends nothing on Undo and edit, and sends at once on Send now", async () => {
	const contact = mount();
	const first = contact.submit();

	contact.undo.click();
	await first;
	await vi.advanceTimersByTimeAsync(60_000);

	expect(contact.fetch).not.toHaveBeenCalled();
	expect(contact.form.hidden).toBe(false);
	expect(contact.panel.hidden).toBe(true);
	expect(contact.status.textContent).toBe(
		"Not sent. Edit your message, then send it again.",
	);
	expect(contact.email.focus).toHaveBeenCalled();
	expect(contact.leave()).toBe(false);

	contact.values.set("email", "alex@example.org");

	const second = contact.submit();

	expect(contact.text("[data-hold-email]")).toBe("alex@example.org");
	contact.sendNow.click();
	await vi.advanceTimersByTimeAsync(0);
	expect(contact.sentBodies()).toEqual([
		expect.objectContaining({ email: "alex@example.org" }),
	]);
	contact.answer();
	await second;
	expect(contact.reply.textContent).toContain("alex@example.org");
});

it("does not hold a form the browser's field checks refuse, so the server's messages show at once", async () => {
	const contact = mount({ valid: false });
	const sending = contact.submit();

	await vi.advanceTimersByTimeAsync(0);
	expect(contact.fetch).toHaveBeenCalledTimes(1);
	expect(contact.panel.hidden).toBe(true);
	contact.answer();
	await sending;
});

it("names the address that was sent, even when the field changes while sending", async () => {
	const contact = mount();
	const sending = contact.submit();

	contact.sendNow.click();
	await vi.advanceTimersByTimeAsync(0);
	contact.values.set("name", "Sam Other");
	contact.values.set("email", "changed@example.com");
	contact.answer();
	await sending;

	expect(contact.reply.textContent).toBe(
		"Thanks, Alex. I’ll read it myself and reply by email to alex@example.com.",
	);
});

it("shows the hold's starting count in the page and offers no other address", () => {
	expect(holdPanel).toContain(
		`<h3 id="contact-hold-count" data-hold-count>${holdCountText(CONTACT_HOLD_SECONDS)}</h3>`,
	);
	expect(holdPanel).toContain(
		"I’ll reply to <span data-hold-email></span>. If anything needs fixing, undo and edit it. Stay on this page until it sends.",
	);
	expect(holdPanel).not.toContain("mailto:");
	expect(success).not.toContain("mailto:");
	expect(success).not.toMatch(/typo/i);
});

it("says what happens next without promising a reply time", () => {
	for (const sentence of [
		"<h3>Message received.</h3>",
		"Thanks for getting in touch. I’ll read it myself and reply by email.",
		"A short confirmation email should arrive soon. If it doesn’t, check your spam folder. Your message reached me either way.",
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
