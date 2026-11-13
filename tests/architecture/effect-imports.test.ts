import { execFileSync } from "node:child_process";
import {
	type Dirent,
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

/**
 * The scan reads a tree that other tests write into: one of them makes a scratch directory at the root and removes it
 * again, so a path listed here can be gone by the time it is read. The rule, decided from what the scan must cover:
 *
 * - A root-level directory whose name starts with a dot and that holds no tracked file (a scratch or cache directory,
 *   never source) is skipped. The tracked dot-directories (`.github`, `.agents` and the like) are scanned as before.
 * - A file or directory that is not tracked by Git and has vanished since it was listed is skipped. A tracked path that
 *   vanishes still fails the test with the system's own error: tracked source must always be readable.
 *
 * `tracked` is the set of tracked files (relative, "/"-separated); outside a Git checkout it is empty.
 */
type Walk = {
	excluded: typeof EXCLUDED;
	tracked: ReadonlySet<string>;
	/** Lists a directory (readdirSync, or a stand-in in a test). */
	list: (directory: string) => Dirent[];
};

/** The files Git tracks under `root`, relative and "/"-separated, or none when `root` is not a checkout. */
function trackedFiles(root: string): Set<string> {
	try {
		return new Set(
			execFileSync("git", ["ls-files", "-z"], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				maxBuffer: 64 * 1024 * 1024,
			})
				.split("\0")
				.filter(Boolean),
		);
	} catch {
		return new Set();
	}
}

/** True when a tracked file is `path` or is under it. */
function holdsTracked(path: string, tracked: ReadonlySet<string>): boolean {
	if (tracked.has(path)) return true;

	for (const file of tracked) if (file.startsWith(`${path}/`)) return true;

	return false;
}

/** True when the error is a path that is gone. */
function isMissing(error: Error): boolean {
	return "code" in error && error.code === "ENOENT";
}

/** Every source file under `root` that the walk does not skip. */
function sourcesUnder(root: string, walk: Walk, directory = root): string[] {
	let entries: Dirent[];

	try {
		entries = walk.list(directory);
	} catch (error) {
		if (
			error instanceof Error &&
			isMissing(error) &&
			!holdsTracked(
				relative(root, directory).split(sep).join("/"),
				walk.tracked,
			)
		)
			return [];

		throw error;
	}

	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		const shown = relative(root, path).split(sep).join("/");

		if (isExcluded(shown, walk.excluded)) return [];

		if (
			entry.isDirectory() &&
			directory === root &&
			entry.name.startsWith(".") &&
			!holdsTracked(shown, walk.tracked)
		)
			return [];

		if (entry.isDirectory()) return sourcesUnder(root, walk, path);

		return SOURCE.test(entry.name) ? [path] : [];
	});
}

/** True when the source text imports, re-exports, requires or dynamically imports exactly "effect". */
function usesBareEffect(file: string, text: string): boolean {
	return specifiersOf(file, text).includes("effect");
}

/** The files under `root` (relative paths) that import from the bare effect specifier. */
function offendersUnder(
	root: string,
	excluded: typeof EXCLUDED,
	walk: Partial<Walk> = {},
): string[] {
	const full: Walk = {
		excluded,
		tracked: walk.tracked ?? trackedFiles(root),
		list:
			walk.list ??
			((directory) => readdirSync(directory, { withFileTypes: true })),
	};

	return sourcesUnder(root, full).flatMap((file) => {
		const shown = relative(root, file).split(sep).join("/");

		let text: string;

		try {
			text = readFileSync(file, "utf8");
		} catch (error) {
			if (
				error instanceof Error &&
				isMissing(error) &&
				!full.tracked.has(shown)
			)
				return [];

			throw error;
		}

		return usesBareEffect(file, text) ? [shown] : [];
	});
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

	it("survives a scratch directory that appears and disappears during the walk", () => {
		const root = mkdtempSync(join(tmpdir(), "effect-imports-"));

		roots.push(root);
		const bare = 'import { Effect } from "effect";';

		for (const path of [
			"src/a.ts",
			".render-tmp/layout.mjs",
			".github/scripts/tracked.mjs",
			"scratch/out/file.ts",
			"scratch/gone.ts",
		]) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), bare);
		}

		const tracked = new Set(["src/a.ts", ".github/scripts/tracked.mjs"]);

		// The scratch directories are listed, then removed before the walk reads them, as another test does.
		const racing = (directory: string) => {
			const entries = readdirSync(directory, { withFileTypes: true });

			if (directory === root)
				for (const name of [".render-tmp", "scratch"])
					rmSync(join(root, name), { recursive: true, force: true });

			return entries;
		};

		expect(
			offendersUnder(root, EXCLUDED, { tracked, list: racing }).sort(),
		).toEqual([".github/scripts/tracked.mjs", "src/a.ts"]);

		// A tracked file that vanishes is a real failure.
		writeFileSync(join(root, "src/b.ts"), bare);
		const gone = new Set([...tracked, "src/b.ts"]);

		const vanishing = (directory: string) => {
			const entries = readdirSync(directory, { withFileTypes: true });

			if (directory === join(root, "src"))
				rmSync(join(root, "src/b.ts"), { force: true });

			return entries;
		};

		expect(() =>
			offendersUnder(root, EXCLUDED, { tracked: gone, list: vanishing }),
		).toThrow(/ENOENT/);
	});

	it("never imports from the bare effect specifier", () => {
		const offenders = offendersUnder(repository, EXCLUDED).filter(
			(file) => file !== "tests/architecture/effect-imports.test.ts",
		);

		expect(offenders).toEqual([]);
	});
});
