import { expect } from "vitest";

// Punctuation that Biome puts without surrounding spaces in the TS code this helper reads.
const PUNCTUATION = "()\\[\\]{}<>,;:=+\\-*/!?&|.";

const CLOSING_COMMA = /,(?=[)\]}])/g;

function normaliseCode(code: string): string {
	return code
		.replace(/\s+/g, " ")
		.replace(/\((\w+)\) ?=>/g, "$1 =>")
		.replace(new RegExp(` ?([${PUNCTUATION}]) ?`, "g"), "$1")
		.replace(CLOSING_COMMA, "");
}

/** End index (exclusive) of the string or template literal that starts at `start`. */
function literalEnd(text: string, start: number): number {
	const quote = text[start];
	let i = start + 1;

	while (i < text.length) {
		const char = text[i];

		if (char === "\\") {
			i += 2;
		} else if (char === quote) {
			return i + 1;
		} else if (char === "\n" && quote !== "`") {
			return i;
		} else {
			i += 1;
		}
	}

	return text.length;
}

/** End index (exclusive) of the comment that starts at `start`, or `start` when there is none. */
function commentEnd(text: string, start: number): number {
	if (text.startsWith("//", start)) {
		const newline = text.indexOf("\n", start);

		return newline === -1 ? text.length : newline;
	}

	if (text.startsWith("/*", start)) {
		const close = text.indexOf("*/", start + 2);

		return close === -1 ? text.length : close + 2;
	}

	return start;
}

/**
 * Source text as the tests compare it, for Biome-formatted TypeScript only: the file and the
 * expected snippet pass through the same reduction, so line layout, quote style, trailing
 * commas, the parentheses around a single arrow parameter and spaces beside punctuation do not
 * decide a test. In code, whitespace runs collapse to one space, a space next to punctuation is
 * dropped, a trailing comma before a closing bracket is dropped, and `(x) =>` reads as `x =>`.
 * The contents of string and template literals are kept exactly, so user-facing copy is
 * asserted as written; only the quotes around a string literal become single quotes, so either
 * quote style matches. Comments are normalised like code and never open a string.
 *
 * Do not use this for `.astro` markup or CSS: those keep exact raw assertions, because a
 * descendant selector or a `calc()` operand changes meaning with its spaces.
 */
export function sourceText(text: string): string {
	let out = "";
	let code = "";

	const flush = () => {
		out += normaliseCode(code);
		code = "";
	};

	let i = 0;

	while (i < text.length) {
		const char = text[i];
		const comment = commentEnd(text, i);

		if (comment > i) {
			code += text.slice(i, comment);
			i = comment;
		} else if (char === "'" || char === '"' || char === "`") {
			flush();
			const end = literalEnd(text, i);
			const literal = text.slice(i, end);
			out +=
				char === "`"
					? literal
					: `'${literal.slice(1, literal.endsWith(char) ? -1 : undefined)}'`;
			i = end;
		} else {
			code += char;
			i += 1;
		}
	}

	flush();

	return out.trim();
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
