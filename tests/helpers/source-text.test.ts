import { describe, expect, it } from "vitest";
import { sourceText } from "./source-text";

describe("sourceText", () => {
	it("keeps word spacing inside string prose", () => {
		expect(sourceText("const a = 'I build web apps';")).toContain(
			"'I build web apps'",
		);
		expect(sourceText("'I build web apps'")).not.toBe("'Ibuildwebapps'");
	});

	it("collapses whitespace runs to one space", () => {
		expect(sourceText("a \n\t  b")).toBe("a b");
	});

	it("ignores whitespace at the edges of a snippet", () => {
		expect(sourceText("\n  stage.add(x);\n")).toBe("stage.add(x);");
	});

	it("drops spaces next to punctuation", () => {
		expect(sourceText("calc(100% - var(--p))")).toBe("calc(100%-var(--p))");
		expect(sourceText("x = [ 1 , 2 ]")).toBe("x=[1,2]");
	});

	it("reads double quotes as single quotes", () => {
		expect(sourceText('a="b"')).toBe("a='b'");
	});

	it("drops a trailing comma before a closing bracket", () => {
		expect(sourceText("f(a,\n)")).toBe("f(a)");
		expect(sourceText("[a,\n]")).toBe("[a]");
	});

	it("keeps the word before an arrow when an async keyword precedes it", () => {
		expect(sourceText("const f = async (x) => x")).toBe(
			sourceText("const f = async x => x"),
		);
		expect(sourceText("const f = async (x) => x")).toContain("async x=>x");
	});

	it("reads a single arrow parameter with or without parentheses alike", () => {
		expect(sourceText("(x) => x")).toBe(sourceText("x => x"));
		expect(sourceText("(x) => x")).toBe("x=>x");
	});
});
