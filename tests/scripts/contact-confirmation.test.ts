import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	CONTACT_HOLD_SECONDS,
	contactReplyLine,
	holdCountText,
	holdFromText,
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

/** What /api/contact answers, as src/pages/api/contact.ts writes it. */
type ContactAnswer = {
	ok: boolean;
	error?: string;
	errors?: Record<string, string>;
};

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
	disabled = false;
	click() {
		this.dispatchEvent(new Event("click"));
	}
}

/**
 * The contact form as the script finds it, with a fetch that answers when the test says so. `valid` is what the
 * browser's own field checks say; `token` is the security check's; `panel: false` leaves the hold's markup out.
 */
function mount({
	valid = true,
	token = "token",
	panel: withPanel = true,
} = {}) {
	const values = new Map([
		["name", "Alex Example"],
		["email", "alex@example.com"],
		["company", ""],
		["description", "Hello"],
		["cf-turnstile-response", token],
	]);

	const button = { ...element(), textContent: "Send message" };
	const status = element();
	const email = element();
	const reply = { textContent: "" };
	const page = { ...element(), hidden: true, querySelector: () => reply };
	const undo = new Clickable();
	const sendNow = new Clickable();

	const texts = new Map(
		[
			"[data-hold-count]",
			"[data-hold-email]",
			"[data-hold-from]",
			"[data-hold-message]",
		].map((selector) => [selector, { textContent: "" }]),
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

	const documentEvents = Object.assign(new EventTarget(), {
		visibilityState: "visible",
		querySelector: () => form,
		getElementById: (id: string) =>
			({
				"contact-success": page,
				"contact-hold": withPanel ? panel : null,
			})[id] ?? null,
	});

	vi.stubGlobal("window", windowEvents);
	vi.stubGlobal("document", documentEvents);
	vi.stubGlobal(
		"FormData",
		class {
			get(key: string) {
				return values.get(key) ?? null;
			}
		},
	);

	const fetch = vi.fn(
		(_url: string, init: { body: string; keepalive?: boolean }) =>
			new Promise<Response>((resolve) => {
				answers.push(resolve);
				void init;
			}),
	);

	vi.stubGlobal("fetch", fetch);
	setupContactForm();

	const sentBodies = () =>
		fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

	return {
		values,
		form,
		panel,
		page,
		status,
		email,
		reply,
		undo,
		sendNow,
		text,
		fetch,
		sentBodies,
		leave: () => windowEvents.dispatchEvent(new Event("pagehide")),
		switchAway: () => {
			documentEvents.visibilityState = "hidden";
			documentEvents.dispatchEvent(new Event("visibilitychange"));
		},
		submit: () => submit!(),
		answer: (body: ContactAnswer = { ok: true }, status = 200) =>
			answers.shift()!(Response.json(body, { status })),
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

	contact.values.set("company", "Example Studio");
	const sending = contact.submit();

	expect(contact.fetch).not.toHaveBeenCalled();
	expect(contact.form.hidden).toBe(true);
	expect(contact.panel.hidden).toBe(false);
	expect(contact.panel.focus).toHaveBeenCalled();
	expect(contact.text("[data-hold-count]")).toBe(
		holdCountText(CONTACT_HOLD_SECONDS),
	);
	expect(contact.text("[data-hold-email]")).toBe("alex@example.com");
	expect(contact.text("[data-hold-from]")).toBe("Alex Example, Example Studio");
	expect(contact.text("[data-hold-message]")).toBe("Hello");

	await vi.advanceTimersByTimeAsync(CONTACT_HOLD_SECONDS * 1000 - 1000);
	expect(contact.text("[data-hold-count]")).toBe("Sending in 1 second.");
	expect(contact.fetch).not.toHaveBeenCalled();

	await vi.advanceTimersByTimeAsync(1000);
	expect(contact.fetch).toHaveBeenCalledTimes(1);
	expect(contact.fetch.mock.calls[0][1].keepalive).toBe(true);
	// While it sends, the panel stays up and can no longer be undone; the form does not come back.
	expect(contact.text("[data-hold-count]")).toBe("Sending…");
	expect(contact.panel.hidden).toBe(false);
	expect(contact.form.hidden).toBe(true);
	expect(contact.undo.disabled).toBe(true);
	expect(contact.sendNow.disabled).toBe(true);
	contact.answer();
	await sending;

	expect(contact.panel.hidden).toBe(true);
	expect(contact.page.hidden).toBe(false);
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

	contact.values.set("email", "alex@example.org");
	contact.panel.focus.mockClear();

	const second = contact.submit();

	expect(contact.undo.disabled).toBe(false);
	expect(contact.text("[data-hold-email]")).toBe("alex@example.org");
	contact.sendNow.click();
	await vi.advanceTimersByTimeAsync(0);
	expect(contact.sentBodies()).toEqual([
		expect.objectContaining({ email: "alex@example.org" }),
	]);
	// Focus stays on the panel, not on the button that Send now disabled.
	expect(contact.panel.focus).toHaveBeenCalled();
	contact.answer();
	await second;
	expect(contact.reply.textContent).toContain("alex@example.org");
});

it("sends at once when the visitor leaves or switches away, since Undo only works on the page", async () => {
	for (const away of ["leave", "switchAway"] as const) {
		const contact = mount();
		const sending = contact.submit();

		contact[away]();
		await vi.advanceTimersByTimeAsync(0);
		expect(contact.fetch).toHaveBeenCalledTimes(1);
		expect(contact.fetch.mock.calls[0][1].keepalive).toBe(true);
		contact.answer();
		await sending;
		vi.unstubAllGlobals();
	}
});

it("ignores a second send while a message is held", async () => {
	const contact = mount();
	const first = contact.submit();

	await contact.submit();
	await vi.advanceTimersByTimeAsync(CONTACT_HOLD_SECONDS * 1000);
	expect(contact.fetch).toHaveBeenCalledTimes(1);
	contact.answer();
	await first;
});

it("returns to the form when the held message is refused, where the message shows", async () => {
	const contact = mount();
	const sending = contact.submit();

	contact.sendNow.click();
	await vi.advanceTimersByTimeAsync(0);
	contact.answer({ ok: false, error: "Captcha failed." }, 403);
	await sending;

	expect(contact.panel.hidden).toBe(true);
	expect(contact.form.hidden).toBe(false);
	expect(contact.status.textContent).toBe("Captcha failed.");
	expect(contact.status.focus).toHaveBeenCalled();
});

it("does not hold a form the server would refuse at once", async () => {
	for (const options of [{ valid: false }, { token: "" }, { panel: false }]) {
		const contact = mount(options);
		const sending = contact.submit();

		await vi.advanceTimersByTimeAsync(0);
		expect(contact.fetch, JSON.stringify(options)).toHaveBeenCalledTimes(1);
		expect(contact.panel.hidden).toBe(true);
		contact.answer();
		await sending;
		vi.unstubAllGlobals();
	}
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

it("gives the hold every part the script fills, with a fixed label and no other address", () => {
	for (const hook of [
		'<h3 id="contact-hold-title">Check it before it sends.</h3>',
		`<p class="contact-hold-count" role="timer" data-hold-count>${holdCountText(CONTACT_HOLD_SECONDS)}</p>`,
		'aria-labelledby="contact-hold-title" aria-describedby="contact-hold-about"',
		"I’ll reply to <span data-hold-email></span>. If anything needs fixing, undo and edit it. Leaving this page sends it right away.",
		"data-hold-undo>Undo and edit</button>",
		"data-hold-send>Send now</button>",
		"data-hold-from></p>",
		"data-hold-message></p>",
	])
		expect(holdPanel).toContain(hook);

	expect(holdFromText(" Alex ", "")).toBe("Alex");
	expect(holdFromText("Alex", " Example Studio ")).toBe("Alex, Example Studio");
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
