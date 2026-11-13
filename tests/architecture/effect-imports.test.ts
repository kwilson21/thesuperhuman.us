import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Each Effect module is imported by its own path (`effect/Effect`, `effect/Schema`), never from the bare `effect`
// specifier, so what ships is the module that was named and a reader sees which one each file uses.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|astro)$/;

/** An import, re-export, dynamic import or require of exactly "effect" (either quote). */
const BARE_EFFECT = /(?:from|import|require)\s*\(?\s*["'`]effect["'`]/;

/** Every source file under `directory`, skipping what is not ours to lint. */
function sourcesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		if (entry.isDirectory())
			return entry.name === "node_modules" ? [] : sourcesUnder(path);

		return SOURCE.test(entry.name) ? [path] : [];
	});
}

describe("how Effect is imported", () => {
	it("recognizes a bare import and not a module path", () => {
		expect(BARE_EFFECT.test('import { Effect } from "effect";')).toBe(true);
		expect(BARE_EFFECT.test("export * from 'effect'")).toBe(true);
		expect(BARE_EFFECT.test('const e = await import("effect")')).toBe(true);
		expect(BARE_EFFECT.test('import * as Effect from "effect/Effect";')).toBe(
			false,
		);
		expect(BARE_EFFECT.test('import "@xstate/effect";')).toBe(false);
	});

	it("never imports from the bare effect specifier", () => {
		const offenders = ["src", "tests", "scripts"]
			.flatMap((name) => sourcesUnder(join(repository, name)))
			.flatMap((file) =>
				file !== fileURLToPath(import.meta.url) &&
				BARE_EFFECT.test(readFileSync(file, "utf8"))
					? [relative(repository, file)]
					: [],
			);

		expect(offenders).toEqual([]);
	});
});
