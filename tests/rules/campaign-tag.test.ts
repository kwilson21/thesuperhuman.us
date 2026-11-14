import { describe, expect, it } from "vitest";
import { tagPlayback } from "../../src/server/rules/campaign-tag";
import { answerOf, nothingToDo, write } from "../helpers/rule-answers";

// The campaign tag rule as stories: what the player named, what the owner defined for those names, and whether the
// playback is tagged. Only a combination the owner defined for an active campaign counts.

const named = {
	campaignId: "old-news",
	channel: "instagram",
	creative: "lyric-clip",
};

const defined = (status: string) => ({ ...named, status });

describe("tagging a playback", () => {
	it("tags it with a combination the owner defined for an active campaign", () => {
		expect(answerOf(tagPlayback.decide(named, defined("active")))).toEqual(
			write(named),
		);
	});

	it.each(["draft", "complete"])(
		"does not tag it for a %s campaign",
		(status) => {
			expect(answerOf(tagPlayback.decide(named, defined(status)))).toEqual(
				nothingToDo(),
			);
		},
	);

	it("does not tag it when the owner defined no such combination", () => {
		expect(answerOf(tagPlayback.decide(named, null))).toEqual(nothingToDo());
	});

	it.each([
		["no names", {}],
		["only a campaign", { campaignId: "old-news" }],
		["no creative", { campaignId: "old-news", channel: "instagram" }],
	])("does not tag it with %s", (_name, partial) => {
		expect(answerOf(tagPlayback.decide(partial, defined("active")))).toEqual(
			nothingToDo(),
		);
	});
});
