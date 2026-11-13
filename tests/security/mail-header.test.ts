import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendAudioMessage } from "~/lib/audio-resend";
import { sendMail } from "~/lib/resend";
import { ownerRequestForIntake, validateIntake } from "~/lib/audio-intake";
import { headerText, stripControls } from "~/lib/mail-header";

// Text a visitor typed never reaches an email subject or address header with a line break or another control character,
// and a control character in an intake answer is refused where the form is checked, so it cannot swell a stored request.

describe_headerText();

function describe_headerText() {
	it.each([
		["Ada Lovelace", "Ada Lovelace"],
		["Ada\r\nBcc: someone@example.com", "Ada Bcc: someone@example.com"],
		["Ada\nBob", "Ada Bob"],
		["Ada\u0000Bob", "Ada Bob"],
		["Ada Bob Cy", "Ada Bob Cy"],
		["Ada\u0085Bob", "Ada Bob"],
		["Ada\u007fBob", "Ada Bob"],
		["\u0001\u0002 Ada \u0003", "Ada"],
		["Ada   Bob", "Ada   Bob"],
	])("headerText(%j) is %j", (value, expected) => {
		expect(headerText(value)).toBe(expected);
	});

	it("strips controls from an address without leaving a space", () => {
		expect(stripControls("a@example.com\r\nBcc: x@example.com")).toBe(
			"a@example.comBcc: x@example.com",
		);
		expect(stripControls("a\u0000@example.com")).toBe("a@example.com");
	});
}

type Sent = {
	subject: string;
	reply_to?: string;
	to: string[];
	from: string;
};

let sent: Sent[];

beforeEach(() => {
	sent = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: { body: string }) => {
			sent.push(JSON.parse(init.body));

			return new Response("{}", { status: 200 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

it("sendAudioMessage sends a subject and addresses with no control character", async () => {
	await sendAudioMessage({
		apiKey: "key",
		payload: {
			from: "site@example.test",
			to: ["a@example.com\r\nBcc: x@example.com"],
			subject: "Song request from Ada\r\nBcc: x@example.com: Mix",
			reply_to: "ada@example.com\nBcc: x@example.com",
			text: "body\r\nstays as written",
		},
	});

	expect(sent[0].subject).toBe("Song request from Ada Bcc: x@example.com: Mix");
	expect(sent[0].to).toEqual(["a@example.comBcc: x@example.com"]);
	expect(sent[0].reply_to).toBe("ada@example.comBcc: x@example.com");
	expect(JSON.stringify(sent[0])).toContain("body\\r\\nstays as written");
});

it("sendMail sends a subject and addresses with no control character", async () => {
	await sendMail("key", {
		from: "site@example.test",
		to: ["owner@example.test"],
		subject: "New message from Ada Bcc: x@example.com",
		reply_to: "ada@example.com\r\nBcc: x@example.com",
		text: "body",
	});

	expect(sent[0].subject).toBe("New message from Ada Bcc: x@example.com");
	expect(sent[0].reply_to).toBe("ada@example.comBcc: x@example.com");
});

const base = {
	service: "vocal-mix",
	title: "My song",
	direction: "judgment",
	preferences: {},
	preserve: "",
	referenceUrl: "",
	referenceNote: "",
	name: "Artist",
	email: "artist@example.com",
	permission: true,
	turnstileToken: "test",
	fileLink: "https://drive.google.com/example",
};

const control = "Remove control characters.";

it.each([
	["title", "My\u0000song"],
	["name", "Ar\u0007tist"],
	["preserve", "keep\u001bthe vocal"],
	["referenceNote", "see\u0000this"],
	["preserve", "a lone surrogate \ud800"],
])("refuses a control character in %s", (field, value) => {
	expect(validateIntake({ ...base, [field]: value })).toEqual({
		ok: false,
		errors: { [field]: control },
	});
});

it.each([
	["referenceUrl", "https://example.com/a\u0001b"],
	["fileLink", "https://example.com/a\u0000b"],
])("refuses a control character in the link %s", (field, value) => {
	const answer = validateIntake({ ...base, [field]: value });

	expect(answer.ok).toBe(false);
});

it("keeps line breaks and tabs in the two free-text answers", () => {
	const text = "line one\nline two\r\n\tindented";

	expect(
		validateIntake({ ...base, preserve: text, referenceNote: text }).ok,
	).toBe(true);
});

it("never stores more than the request limit for the most expensive answers it accepts", () => {
	const cost = (character: string) => {
		const answer = validateIntake({
			...base,
			title: character.repeat(120),
			name: character.repeat(100),
			preserve: character.repeat(1200),
			referenceNote: character.repeat(2000),
		});

		return answer.ok
			? JSON.stringify(ownerRequestForIntake(answer.value).details).length
			: 0;
	};

	// Quotes and backslashes double in JSON; control characters (which would be six times larger) are refused above.
	for (const character of ['"', "\\", "\n", " ", "😀"])
		expect(cost(character), JSON.stringify(character)).toBeLessThanOrEqual(
			16_000,
		);
});
