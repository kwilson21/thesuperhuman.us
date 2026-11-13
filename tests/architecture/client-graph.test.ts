import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { clientEntries, clientGraphViolations } from "../helpers/client-graph";

// Effect and src/server never reach the browser: src/scripts/** and the <script> blocks of .astro files stay plain
// TypeScript. This walks the static import graph from those entries and fails when any module they reach imports
// `effect`, `effect/*`, `@xstate/effect` or anything under src/server. Type-only imports are erased, so they do not count.

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the browser's import graph", () => {
	it("has client entries to walk", () => {
		const entries = clientEntries(repository);

		expect(entries.length).toBeGreaterThan(50);
		expect(entries.some((entry) => entry.endsWith("form-submission.ts"))).toBe(
			true,
		);
		expect(entries.some((entry) => entry.endsWith(".astro"))).toBe(true);
	});

	it("never reaches effect, @xstate/effect or src/server", () => {
		expect(clientGraphViolations(repository)).toEqual([]);
	});
});

describe("the walker finds what it should", () => {
	const roots: string[] = [];

	/** A scratch repository: the tsconfig alias and the given files, each at a path under it. */
	const scratch = (files: Record<string, string>) => {
		const root = mkdtempSync(join(tmpdir(), "client-graph-"));

		roots.push(root);
		writeFileSync(
			join(root, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { baseUrl: ".", paths: { "~/*": ["src/*"] } },
			}),
		);

		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}

		return root;
	};

	afterEach(() => {
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});

	it("passes a client graph that stays plain", () => {
		const root = scratch({
			"src/scripts/a.ts": 'import { b } from "~/lib/b";\nexport const a = b;',
			"src/lib/b.ts": 'import { z } from "zod";\nexport const b = z;',
		});

		expect(clientGraphViolations(root)).toEqual([]);
	});

	it("finds effect imported two files away, through the ~/ alias", () => {
		const root = scratch({
			"src/scripts/a.ts": 'import { b } from "~/lib/b";\nexport const a = b;',
			"src/lib/b.ts": 'import { c } from "./c";\nexport const b = c;',
			"src/lib/c.ts":
				'import * as Schema from "effect/Schema";\nexport const c = Schema;',
		});

		expect(clientGraphViolations(root)).toEqual([
			{
				import: "effect/Schema",
				chain: ["src/scripts/a.ts", "src/lib/b.ts", "src/lib/c.ts"],
			},
		]);
	});

	it("finds each forbidden module", () => {
		for (const specifier of [
			"effect",
			"effect/Effect",
			"@xstate/effect",
			"~/server/edge",
			"../server/edge",
			"../server",
		]) {
			const root = scratch({
				"src/scripts/a.ts": `import "${specifier}";`,
				"src/server/edge.ts": "export const edge = 1;",
				"src/server/index.ts": "export const index = 1;",
			});

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				specifier,
			]);
		}
	});

	it("finds a re-export, a dynamic import and a mixed import", () => {
		const root = scratch({
			"src/scripts/a.ts": [
				'export * from "effect/Option";',
				'export const load = () => import("effect/Effect");',
				'import { type T, value } from "effect/Schema";',
			].join("\n"),
		});

		expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
			"effect/Option",
			"effect/Effect",
			"effect/Schema",
		]);
	});

	it("does not count a type-only import", () => {
		const root = scratch({
			"src/scripts/a.ts": [
				'import type { Effect } from "effect/Effect";',
				'import { type A, type B } from "effect/Schema";',
				'export type { C } from "~/server/edge";',
				'import type { D } from "~/server/edge";',
			].join("\n"),
			"src/server/edge.ts": "export type C = 1; export type D = 2;",
		});

		expect(clientGraphViolations(root)).toEqual([]);
	});

	it("walks the script blocks of an .astro file and not its frontmatter", () => {
		const root = scratch({
			"src/pages/server-only.astro":
				'---\nimport { Effect } from "effect/Effect";\nimport { edge } from "~/server/edge";\n---\n<p>hello</p>',
			"src/pages/with-script.astro":
				'---\nconst x = 1;\n---\n<script>\n\timport "~/lib/b";\n</script>',
			"src/lib/b.ts": 'import "effect/Schema";',
			"src/server/edge.ts": "export const edge = 1;",
		});

		expect(clientEntries(root)).toEqual([
			join(root, "src/pages/with-script.astro"),
		]);
		expect(clientGraphViolations(root)).toEqual([
			{
				import: "effect/Schema",
				chain: ["src/pages/with-script.astro", "src/lib/b.ts"],
			},
		]);
	});

	it("is not fooled by a cycle", () => {
		const root = scratch({
			"src/scripts/a.ts": 'import "./b";',
			"src/scripts/b.ts": 'import "./a";',
		});

		expect(clientGraphViolations(root)).toEqual([]);
	});
});
