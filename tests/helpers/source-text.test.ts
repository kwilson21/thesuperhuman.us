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

	it("keeps the contents of string literals exact", () => {
		const copy = "line: 'I build web apps people can try, or a tool'";
		expect(sourceText(copy)).toContain(
			"'I build web apps people can try, or a tool'",
		);
		expect(sourceText(copy)).not.toContain("try,or");
		expect(sourceText("const a = 'try, or';")).not.toContain(
			sourceText("const a = 'try,or';"),
		);
		expect(sourceText('label: "Start a project"')).not.toContain(
			sourceText('label: "Starta project"'),
		);
		expect(sourceText('x = "a  b"')).toBe("x='a  b'");
	});

	it("keeps the contents of template literals exact", () => {
		expect(sourceText("const t = `a , b ${x + y}`;")).toBe(
			"const t=`a , b ${x + y}`;",
		);
	});

	it("reads either quote style as the same string", () => {
		expect(sourceText('f("a, b")')).toBe(sourceText("f('a, b')"));
	});

	it("does not end a string at an escaped quote", () => {
		expect(sourceText("f('it\\'s , ok' , 1)")).toBe("f('it\\'s , ok',1)");
	});

	it("does not treat an apostrophe in a comment as a string", () => {
		expect(sourceText("// don't\nf( 1 , 2 )")).toBe("//don't f(1,2)");
		expect(sourceText("/* it's */ f( 1 )")).toBe("/*it's*/f(1)");
	});

	it("still matches code needles across formatting differences", () => {
		const formatted = 'media.forEach((audio) => {\n\tplay( "a, b" ,\n);\n});';
		expect(sourceText(formatted)).toContain(
			sourceText("media.forEach(audio => { play('a, b') ; });"),
		);
	});
});
