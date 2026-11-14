import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	alwaysWrites,
	check,
	decided,
	rule,
	term,
	unless,
} from "../../src/server/terms";
import { answerOf, nothingToDo, refuse, write } from "../helpers/rule-answers";

class TooLong extends Data.TaggedError("TooLong") {
	readonly say = "That is too long.";
}

class Empty extends Data.TaggedError("Empty") {
	readonly say = "That is empty.";
}

type Given = { text: string; already: boolean };

const notEmpty = term<Given>("the text is not empty", (g) => g.text !== "");

const shortEnough = term<Given>(
	"the text has at most 5 characters",
	(g) => g.text.length <= 5,
);

const alreadySaved = term<Given>("the text is already saved", (g) => g.already);

const saveText = rule({
	name: "save the text",
	given: (request: { text: string }, facts: { saved: string }): Given => ({
		text: request.text,
		already: facts.saved === request.text,
	}),
	nothingToDoIf: alreadySaved,
	refusals: [
		unless(notEmpty, () => new Empty()),
		unless(shortEnough, () => new TooLong()),
	],
	writes: (g) => ({ text: g.text }),
	writesText: "saves the text",
});

describe("term", () => {
	it("keeps its English text as its name", () => {
		expect(notEmpty.text).toBe("the text is not empty");
		expect(notEmpty.holds({ text: "a", already: false })).toBe(true);
		expect(notEmpty.holds({ text: "", already: false })).toBe(false);
	});
});

describe("check", () => {
	it("passes when every term holds", () => {
		const answer = check({ text: "abc", already: false }, [
			unless(notEmpty, () => new Empty()),
		]);

		expect(Effect.runSync(answer)).toBeUndefined();
	});

	it("fails with the first refusal whose term does not hold", () => {
		const answer = check({ text: "", already: false }, [
			unless(notEmpty, () => new Empty()),
			unless(shortEnough, () => new TooLong()),
		]);

		expect(Effect.runSync(Effect.flip(answer))._tag).toBe("Empty");
	});
});

describe("rule", () => {
	it("answers what to save when every check passes", () => {
		expect(answerOf(saveText.decide({ text: "abc" }, { saved: "" }))).toEqual(
			write({ text: "abc" }),
		);
	});

	it("names the refusal and its sentence, checked in order", () => {
		expect(answerOf(saveText.decide({ text: "" }, { saved: "x" }))).toEqual(
			refuse("Empty", "That is empty."),
		);
		expect(
			answerOf(saveText.decide({ text: "abcdef" }, { saved: "x" })),
		).toEqual(refuse("TooLong", "That is too long."));
	});

	it("has nothing to do when what was asked is already true, before any refusal", () => {
		expect(answerOf(saveText.decide({ text: "" }, { saved: "" }))).toEqual(
			nothingToDo(),
		);
	});

	it("keeps its name and its words for the rule sheet", () => {
		expect(saveText.name).toBe("save the text");
		expect(saveText.writesText).toBe("saves the text");
	});
});

describe("alwaysWrites", () => {
	const storeText = alwaysWrites({
		name: "store the text",
		given: (request: { text: string }, _facts: Record<string, never>) => ({
			text: request.text,
			already: false,
		}),
		refusals: [unless(shortEnough, () => new TooLong())],
		writes: (g) => ({ text: g.text }),
		writesText: "stores the text",
	});

	const keepText = alwaysWrites({
		name: "keep the text",
		given: (request: { text: string }, _facts: Record<string, never>) =>
			request.text,
		refusals: [],
		writes: (text) => text,
		writesText: "keeps the text",
	});

	it("answers what to save, never nothing", () => {
		expect(Effect.runSync(storeText.decide({ text: "abc" }, {}))).toEqual({
			text: "abc",
		});
	});

	it("fails with the first refusal whose term does not hold", () => {
		expect(
			Effect.runSync(Effect.flip(storeText.decide({ text: "abcdef" }, {})))
				._tag,
		).toBe("TooLong");
	});

	it("cannot fail when it refuses nothing, so its answer needs no unwrapping", () => {
		expect(Effect.runSync(keepText.decide({ text: "x" }, {}))).toBe("x");
	});
});

describe("decided", () => {
	it("gives a rule's answer as a plain value", () => {
		expect(decided(saveText.decide({ text: "abc" }, { saved: "" }))).toEqual({
			kind: "write",
			save: { text: "abc" },
		});
		expect(decided(saveText.decide({ text: "abc" }, { saved: "abc" }))).toEqual(
			{ kind: "nothingToDo" },
		);
		expect(decided(saveText.decide({ text: "" }, { saved: "x" }))).toEqual({
			kind: "refuse",
			refusal: new Empty(),
		});
	});
});
