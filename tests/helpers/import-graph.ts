// The local modules a script loads, found by reading its source: every spelling of a static import, a re-export, a
// dynamic import() and a require(), with single or double quotes, over several lines, and relative paths up or down.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SPECIFIER = String.raw`(["'\`])([^"'\`\n]+)\1`;

const PATTERNS = [
	// import x from "y", import { a } from "y", import * as n from "y", export { a } from "y", export * from "y"
	new RegExp(
		String.raw`\b(?:import|export)\b[^;]*?\bfrom\s*${SPECIFIER}`,
		"gs",
	),
	// import "y"
	new RegExp(String.raw`\bimport\s*${SPECIFIER}`, "g"),
	// import("y"), require("y")
	new RegExp(String.raw`\b(?:import|require)\s*\(\s*${SPECIFIER}\s*\)`, "g"),
];

/** Every module specifier a source file names. */
export function specifiersOf(source: string): string[] {
	const found = new Set<string>();

	for (const pattern of PATTERNS)
		for (const match of source.matchAll(pattern))
			if (match[2]) found.add(match[2]);

	return [...found];
}

/**
 * The local files a script needs, transitively: absolute paths. A specifier that is neither relative nor a Node built-in
 * (`node:` or a bare built-in name is returned in `others`) is listed there, since it would need an install.
 */
export function localGraph(entry: string) {
	const files = new Set<string>();
	const others = new Set<string>();

	const walk = (file: string) => {
		if (files.has(file)) return;

		files.add(file);

		for (const specifier of specifiersOf(readFileSync(file, "utf8")))
			if (specifier.startsWith(".")) walk(resolve(dirname(file), specifier));
			else others.add(specifier);
	};

	walk(resolve(entry));

	return { files: [...files], others: [...others] };
}
