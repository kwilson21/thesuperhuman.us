import { describe, expect, it } from "vitest";
import { type Visitor, classifyVisitor } from "../../src/server/rules/visitor";
import { answerOf } from "../helpers/rule-answers";

// The visitor rule as stories: Cloudflare's verdict, the user agent and the location, and what the playback table keeps.

const person: Visitor = {
	verifiedBot: false,
	userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0",
	country: undefined,
	region: undefined,
	city: undefined,
};

const kept = (over: Partial<Visitor>) =>
	answerOf(classifyVisitor.decide({ ...person, ...over }, {}));

describe("who played", () => {
	it("is a person with a browser's user agent and no location", () => {
		expect(kept({})).toEqual({
			kind: "write",
			save: { trafficClass: "human", country: "", region: "", city: "" },
		});
	});

	it.each([
		["Googlebot/2.1"],
		["Slackbot-LinkExpanding (preview)"],
		["a web crawler"],
		["Yahoo! Slurp"],
		["a Spider"],
	])("is automated for the user agent %s", (userAgent) => {
		expect(kept({ userAgent })).toMatchObject({
			save: { trafficClass: "automated" },
		});
	});

	it("is automated when Cloudflare verified a bot", () => {
		expect(kept({ verifiedBot: true })).toMatchObject({
			save: { trafficClass: "automated" },
		});
	});

	it("keeps location parts that are plain text, unicode and exactly 80 characters included", () => {
		expect(
			kept({ country: "JP", region: "Tōkyō", city: "c".repeat(80) }),
		).toMatchObject({
			save: { country: "JP", region: "Tōkyō", city: "c".repeat(80) },
		});
	});

	it.each([
		["over 80 characters", "c".repeat(81)],
		["with a control character", "Vir\u0007ginia"],
	])("blanks a location part %s", (_name, bad) => {
		// A location that is not text at all is covered by the golden corpus ("a country that is a number is blanked").
		expect(kept({ city: bad })).toMatchObject({ save: { city: "" } });
	});
});
