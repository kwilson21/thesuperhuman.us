import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { specifiersOf } from "../helpers/client-graph";

// Each Effect module is imported by its own path (`effect/Effect`, `effect/Schema`), never from the bare `effect`
// specifier, so what ships is the module that was named and a reader sees which one each file uses.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|astro)$/;

/**
 * The whole repository is scanned (src, tests, scripts, tools, db, migrations, templates, publicist, the root config
 * files and anything added later) except these paths, relative to the root with "/" separators. A path names a file or
 * a directory and everything under it. Each one is excluded for the reason beside it; nothing else is skipped.
 */
export const EXCLUDED: readonly { path: string; reason: string }[] = [
	{ path: "node_modules", reason: "installed packages, not ours" },
	{ path: "dist", reason: "build output" },
	{ path: ".astro", reason: "Astro's generated types and cache" },
	{ path: ".wrangler", reason: "Wrangler's local state and bundles" },
	{ path: ".git", reason: "Git's own files" },
	{
		path: ".claude",
		reason: "agent tooling and its worktrees, each a copy of this repository",
	},
	{
		path: ".agents",
		reason:
			"vendored agent skills (Hallmark, the publicist), kept byte for byte as upstream",
	},
	{ path: ".jolli", reason: "local Jolli memory, untracked" },
	{
		path: "tools/oxlint/anti-slop",
		reason:
			"third-party lint rules kept byte for byte as upstream; they name no Effect module specifier (checked, none)",
	},
];

/** True when `path` (relative to the root, "/"-separated) is excluded or under an excluded path. */
function isExcluded(path: string, excluded: typeof EXCLUDED): boolean {
	return excluded.some(
		({ path: skipped }) => path === skipped || path.startsWith(`${skipped}/`),
	);
}

/** Every source file under `root` that `excluded` does not cover. */
function sourcesUnder(
	root: string,
	excluded: typeof EXCLUDED,
	directory = root,
): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		if (isExcluded(relative(root, path).split(sep).join("/"), excluded))
			return [];

		if (entry.isDirectory()) return sourcesUnder(root, excluded, path);

		return SOURCE.test(entry.name) ? [path] : [];
	});
}

/** True when the source text imports, re-exports, requires or dynamically imports exactly "effect". */
function usesBareEffect(file: string, text: string): boolean {
	return specifiersOf(file, text).includes("effect");
}

/** The files under `root` (relative paths) that import from the bare effect specifier. */
function offendersUnder(root: string, excluded: typeof EXCLUDED): string[] {
	return sourcesUnder(root, excluded).flatMap((file) =>
		usesBareEffect(file, readFileSync(file, "utf8"))
			? [relative(root, file).split(sep).join("/")]
			: [],
	);
}

describe("how Effect is imported", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});

	it("recognizes a bare import and not a module path", () => {
		for (const text of [
			'import { Effect } from "effect";',
			'import type { Effect } from "effect";',
			'import "effect";',
			'import /* reason */ "effect";',
			'import(/* @vite-ignore */ "effect")',
			'const e = await import("effect")',
			"const e = await import(`effect`)",
			"export * from 'effect'",
			'export { Effect } from "effect";',
			'const e = require("effect");',
			'const e = require(/* x */ "effect");',
			'import e = require("effect");',
		])
			expect(usesBareEffect("a.ts", text), text).toBe(true);

		for (const text of [
			'import * as Effect from "effect/Effect";',
			'import "@xstate/effect";',
			'import "effect-utils";',
			"const s = 'import { Effect } from \"effect\"';",
			'// import { Effect } from "effect"\nexport const a = 1;',
			'/* require("effect") */ export const a = 1;',
			'export const note = `from "effect"`;',
			'const e = require("effect/Effect");',
		])
			expect(usesBareEffect("a.ts", text), text).toBe(false);
	});

	it("reads an .astro file's frontmatter and script blocks", () => {
		expect(
			usesBareEffect(
				"a.astro",
				'---\nimport { Effect } from "effect";\n---\n<p/>',
			),
		).toBe(true);
		expect(
			usesBareEffect("a.astro", '---\n---\n<script>import "effect";</script>'),
		).toBe(true);
		expect(usesBareEffect("a.astro", '---\n---\n<p>import "effect"</p>')).toBe(
			false,
		);
	});

	it("scans root config files, tools and every other directory, and skips only what the list names", () => {
		const root = mkdtempSync(join(tmpdir(), "effect-imports-"));

		roots.push(root);
		const bare = 'import { Effect } from "effect";';

		for (const path of [
			"vitest.config.ts",
			"astro.config.mjs",
			"oxlint.config.ts",
			"tools/own/rule.ts",
			"templates/page.astro",
			"src/a.ts",
			"node_modules/pkg/index.js",
			"dist/out.js",
			".claude/worktrees/w/src/a.ts",
			"tools/oxlint/anti-slop/rule.ts",
		]) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(
				join(root, path),
				path.endsWith(".astro") ? `---\n${bare}\n---\n` : bare,
			);
		}

		expect(offendersUnder(root, EXCLUDED).sort()).toEqual([
			"astro.config.mjs",
			"oxlint.config.ts",
			"src/a.ts",
			"templates/page.astro",
			"tools/own/rule.ts",
			"vitest.config.ts",
		]);
	});

	it("never imports from the bare effect specifier", () => {
		const offenders = offendersUnder(repository, EXCLUDED).filter(
			(file) => file !== "tests/architecture/effect-imports.test.ts",
		);

		expect(offenders).toEqual([]);
	});
});
