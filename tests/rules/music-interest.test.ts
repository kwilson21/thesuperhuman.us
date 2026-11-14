import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { InterestInput } from "../../src/server/music-input";
import { recordInterest } from "../../src/server/rules/music-interest";
import { write } from "../helpers/rule-answers";

// The interest rule as stories: what a listener said, and the standing interest and owner requests that opens.

const said: InterestInput = {
	releaseId: "old-news-single",
	email: "fan@example.com",
	interest: "both",
	merchandise: ["shirts", "stickers"],
	suggestion: "Please make hoodies",
	cityRegion: "Roanoke, VA",
	consent: true,
	turnstileToken: "token",
};

const saved = (over: Partial<InterestInput>) =>
	write(Effect.runSync(recordInterest.decide({ ...said, ...over }, {})));

describe("what an interest opens", () => {
	it("a song opens a purchase request with no details", () => {
		expect(
			saved({ interest: "song", merchandise: [], suggestion: "" }),
		).toMatchObject({
			save: {
				requests: [
					{
						kind: "purchase",
						summary: "Purchase interest · old-news-single",
						detailsJson: "{}",
					},
				],
			},
		});
	});

	it("merchandise opens a merchandise request with what was asked for", () => {
		expect(saved({ interest: "merchandise" })).toMatchObject({
			save: {
				requests: [
					{
						kind: "merchandise",
						summary: "Merchandise interest · old-news-single",
						detailsJson:
							'{"merchandise":["shirts","stickers"],"suggestion":"Please make hoodies"}',
					},
				],
			},
		});
	});

	it("both open a purchase and a merchandise request, in that order", () => {
		const answer = saved({});

		expect(
			answer.kind === "write" && answer.save.requests.map((r) => r.kind),
		).toEqual(["purchase", "merchandise"]);
	});

	it("keeps each merchandise kind once, in the order chosen", () => {
		expect(
			saved({ merchandise: ["shirts", "hoodies", "shirts"] }),
		).toMatchObject({
			save: { merchandiseJson: '["shirts","hoodies"]' },
		});
	});

	it("states the consent text the listener agreed to", () => {
		expect(saved({})).toMatchObject({
			save: { consentVersion: "availability-v1" },
		});
	});
});
