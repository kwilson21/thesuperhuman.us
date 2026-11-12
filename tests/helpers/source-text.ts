import { expect } from "vitest";

// Punctuation that Biome puts without surrounding spaces in the TS code this helper reads.
const PUNCTUATION = "()\\[\\]{}<>,;:=+\\-*/!?&|.";

/**
 * Source text as the tests compare it, for Biome-formatted TypeScript only: the file and the
 * expected snippet pass through the same reduction, so line layout, quote style, trailing
 * commas, the parentheses around a single arrow parameter and spaces beside punctuation do not
 * decide a test. Whitespace runs collapse to one space, a space next to punctuation is dropped,
 * double quotes become single quotes, a trailing comma before a closing bracket is dropped, and
 * `(x) =>` reads as `x =>`. Word spacing inside prose is kept.
 *
 * Do not use this for `.astro` markup or CSS: those keep exact raw assertions, because a
 * descendant selector or a `calc()` operand changes meaning with its spaces.
 */
export function sourceText(text: string): string {
	return text
		.replace(/"/g, "'")
		.replace(/\s+/g, " ")
		.replace(new RegExp(` ?([${PUNCTUATION}]) ?`, "g"), "$1")
		.replace(/,(?=[)\]}])/g, "")
		.replace(/\((\w+)\)=>/g, "$1=>")
		.trim();
}

/**
 * `expect` for Biome-formatted source text: `toContain` normalises the snippet as well as the
 * file, and `toMatch` runs on the normalised file, so write patterns in the normalised form.
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
