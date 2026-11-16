import { describe, expect, it } from "vitest";
import {
	readEventInput,
	readInterestInput,
	readVisitor,
} from "../../src/server/music-input";

// What the music routes read at the edge, in the words a listener sees. The differential test in
// validators-differential.test.ts holds these readers to the Zod schemas they replaced; this file is the readable part.

const said = {
	releaseId: "old-news-single",
	email: " Fan@Example.com ",
	interest: "both",
	merchandise: ["shirts", "digital-art"],
	suggestion: "Blue design",
	cityRegion: " Nashville, Tennessee ",
	consent: true,
	turnstileToken: "token",
};

describe("an interest body", () => {
	it("normalizes the email and the city, and ignores what it does not know", () => {
		expect(readInterestInput({ ...said, releaseUpdates: true })).toMatchObject({
			ok: true,
			value: { email: "fan@example.com", cityRegion: "Nashville, Tennessee" },
		});
		expect(
			readInterestInput({ ...said, releaseUpdates: true }),
		).not.toHaveProperty("value.releaseUpdates");
	});

	it.each([
		[{ consent: false }, "consent"],
		[{ merchandise: ["vinyl"] }, "merchandise"],
		[{ suggestion: "x".repeat(501) }, "suggestion"],
		[{ interest: "song" }, "merchandise"],
		[{ cityRegion: "x".repeat(121) }, "cityRegion"],
	])("refuses %j at %s", (over, field) => {
		const read = readInterestInput({ ...said, ...over });

		expect(read.ok).toBe(false);
		expect(!read.ok && Object.keys(read.errors)).toContain(field);
	});

	it("explains how to resolve missing consent and verification", () => {
		expect(
			readInterestInput({ ...said, consent: false, turnstileToken: "" }),
		).toMatchObject({
			ok: false,
			errors: {
				consent:
					"Check the box to confirm I may email you about your selection.",
				turnstileToken: "Complete the verification and try again.",
			},
		});
	});

	it("says a body that is not an object is not one", () => {
		expect(readInterestInput(null)).toEqual({
			ok: false,
			errors: { _form: "Expected object, received null" },
		});
	});
});

describe("an event body", () => {
	const event = {
		releaseId: "old-news-single",
		recordingId: "old-news-recording",
		sessionId: "22222222-2222-4222-8222-222222222222",
		playthroughId: "33333333-3333-4333-8333-333333333333",
		eventId: "00000000-0000-4000-8000-000000000001",
		sequence: 1,
		medium: "audio",
		event: "start",
		accumulatedSeconds: 0,
		mediaDurationSeconds: 160,
	};

	it("is read, with the campaign names optional", () => {
		expect(readEventInput(event).ok).toBe(true);
		expect(readEventInput({ ...event, campaignId: "spring-launch" }).ok).toBe(
			true,
		);
	});

	it.each([
		{ sequence: 0 },
		{ sequence: 1.5 },
		{ medium: "text" },
		{ eventId: "x" },
		{ campaignId: 3 },
		{ campaignId: null },
	])("refuses %j", (over) => {
		expect(readEventInput({ ...event, ...over }).ok).toBe(false);
	});
});

describe("who is playing", () => {
	it("is read from Cloudflare's own fields and the user agent", () => {
		const request = new Request("https://thesuperhuman.us/api/music-event", {
			headers: { "user-agent": "Googlebot/2.1" },
		});

		expect(readVisitor(request)).toEqual({
			verifiedBot: false,
			userAgent: "Googlebot/2.1",
			country: undefined,
			region: undefined,
			city: undefined,
		});
	});
});
