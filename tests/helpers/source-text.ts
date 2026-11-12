import { expect } from "vitest";

/**
 * Source text as the tests compare it. Quote style, line layout, trailing commas and the
 * parentheses around a single arrow parameter are formatting, not behaviour, so the file and
 * the expected snippet pass through the same reduction: double quotes become single quotes,
 * whitespace is removed, trailing commas before a closing bracket are dropped, and `(x) =>`
 * reads as `x =>`. A test that expects `foo('bar')` still fails when that call is
 * removed, whichever of those layouts the formatter chose.
 */
export function sourceText(text: string): string {
	return text
		.replace(/"/g, "'")
		.replace(/\s+/g, "")
		.replace(/,(?=[)\]}])/g, "")
		.replace(/\((\w+)\)=>/g, "$1=>");
}

/**
 * `expect` for source text: `toContain` normalises the snippet as well as the file, and
 * `toMatch` runs on the normalised file, so write patterns without spaces or double quotes.
 */
export function expectSource(text: string) {
	const source = sourceText(text);
	return {
		toContain: (snippet: string) =>
			expect(source).toContain(sourceText(snippet)),
		toMatch: (pattern: RegExp) => expect(source).toMatch(pattern),
		not: {
			toContain: (snippet: string) =>
				expect(source).not.toContain(sourceText(snippet)),
			toMatch: (pattern: RegExp) => expect(source).not.toMatch(pattern),
		},
	};
}
