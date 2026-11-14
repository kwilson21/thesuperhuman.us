import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { tagPlayback } from "../../src/server/rules/campaign-tag";

// The campaign tag rule as stories: what the player named, what the owner defined for those names, and whether the
// playback is tagged (the answer is the tag, or null). Only a combination the owner defined for an active campaign counts.

const named = {
	campaignId: "old-news",
	channel: "instagram",
	creative: "lyric-clip",
};

const defined = (status: string) => ({ ...named, status });

describe("tagging a playback", () => {
	it("tags it with a combination the owner defined for an active campaign", () => {
		expect(
			Effect.runSync(tagPlayback.decide(named, defined("active"))),
		).toEqual(named);
	});

	it.each(["draft", "complete"])(
		"does not tag it for a %s campaign",
		(status) => {
			expect(
				Effect.runSync(tagPlayback.decide(named, defined(status))),
			).toBeNull();
		},
	);

	it("does not tag it when the owner defined no such combination", () => {
		expect(Effect.runSync(tagPlayback.decide(named, null))).toBeNull();
	});

	it.each([
		["no names", {}],
		["only a campaign", { campaignId: "old-news" }],
		["no creative", { campaignId: "old-news", channel: "instagram" }],
	])("does not tag it with %s", (_name, partial) => {
		expect(
			Effect.runSync(tagPlayback.decide(partial, defined("active"))),
		).toBeNull();
	});
});
