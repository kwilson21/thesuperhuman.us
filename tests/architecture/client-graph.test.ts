import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	ALLOWED_BROWSER_MODULES,
	clientEntries,
	clientGraphViolations,
	FORBIDDEN_MODULES,
	type Reached,
} from "../helpers/client-graph";

// Effect, src/server and the server-only packages never reach the browser: src/scripts/** and the <script> blocks of
// .astro files stay plain TypeScript. This walks the static import graph from those entries and fails when any module
// they reach imports `effect`, `@xstate/effect`, `xstate`, `zod` (v4), `stripe`, `resend`, `pdf-lib` (or a package that
// depends on one), or anything under src/server. Type-only imports are erased, so they do not count.
//
// "Server-only" for a src/lib module cannot be told from its path, so the rule is a reviewed allowlist of exactly the
// src/lib (and src/data) modules a browser entry may reach. A module that is not on it, because someone imported a
// server module from a script, fails with an instruction to split the module. Adding a name to the list is a review
// decision: it must be pure (no binding, secret or server package) and is reviewed as such.

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

	it("never reaches effect, xstate, zod, stripe, resend, pdf-lib or src/server", () => {
		expect(clientGraphViolations(repository, ALLOWED_BROWSER_MODULES)).toEqual(
			[],
		);
	});
});

// Every module under src/lib or src/data that a browser entry reaches, reviewed one by one: each is pure (constants,
// types, validators and formatting) and imports nothing server-side. The failure message below says what to do.
const BROWSER_MODULES = [
	"src/lib/agreement-client-fields.ts",
	"src/lib/agreement-draft-fields.ts",
	"src/lib/audio-intake.ts",
	"src/lib/audio-peaks.ts",
	"src/lib/business-days.ts",
	"src/lib/home-motion.ts",
	"src/lib/line-diff.ts",
	"src/lib/project-story.ts",
	"src/lib/scroll-scenes.ts",
	"src/lib/software-inquiry.ts",
	"src/lib/software-project-display.ts",
	"src/lib/type-guards.ts",
	"src/lib/waveform.ts",
];

describe("what the browser entries reach", () => {
	const reach = () => {
		const reached: Reached = { files: new Set(), packages: new Set() };

		clientGraphViolations(repository, ALLOWED_BROWSER_MODULES, reached);

		return reached;
	};

	const reachedModules = () =>
		[...reach().files]
			.filter(
				(file) => file.startsWith("src/lib/") || file.startsWith("src/data/"),
			)
			.sort();

	it("is the reviewed allowlist of src/lib modules, and nothing else", () => {
		const reached = reachedModules();

		const added = reached.filter((file) => !BROWSER_MODULES.includes(file));

		expect(
			added,
			`A browser entry now reaches ${added.join(", ")}. Browser code may import only pure modules. Split the module: move what the browser needs into a small module with no server imports (no stripe, resend, pdf-lib, xstate, zod, effect, src/server, D1 or other bindings) and import that. Only add a module to BROWSER_MODULES when it is pure.`,
		).toEqual([]);

		const dropped = BROWSER_MODULES.filter((file) => !reached.includes(file));

		expect(
			dropped,
			`BROWSER_MODULES lists ${dropped.join(", ")}, which no browser entry reaches any more. Remove it from the list.`,
		).toEqual([]);
	});

	it("loads no package but astro (for astro/zod)", () => {
		// astro/zod is Zod v3, still used by three browser validators; the Zod to Effect Schema PR removes it, and this test
		// then expects no package at all.
		expect([...reach().packages].sort()).toEqual(["astro"]);
	});

	it("reaches no module that names a Cloudflare binding, a Cloudflare or Node module, or server-only Astro env", () => {
		const server =
			/cloudflare:|astro:env\/server|\bD1Database\b|\bR2Bucket\b|\bKVNamespace\b|\bnode:/;

		const holding = reachedModules()
			.filter((file) => /\.(m?ts|mjs)$/.test(file))
			.filter((file) =>
				server.test(readFileSync(join(repository, file), "utf8")),
			);

		expect(holding).toEqual([]);
	});
});

describe("the walker finds what it should", () => {
	const roots: string[] = [];

	/**
	 * A scratch repository: a tsconfig with the `~/` alias (and any more `paths`), a package.json when given, the
	 * packages the tests import as empty directories under node_modules, and the given files, each at a path under it.
	 */
	const scratch = (
		files: Record<string, string>,
		options: {
			paths?: Record<string, string[]>;
			packageJson?: object;
			packages?: string[];
		} = {},
	) => {
		const root = mkdtempSync(join(tmpdir(), "client-graph-"));

		roots.push(root);
		writeFileSync(
			join(root, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					baseUrl: ".",
					paths: { "~/*": ["src/*"], ...options.paths },
				},
			}),
		);

		if (options.packageJson)
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify(options.packageJson),
			);

		for (const name of options.packages ?? [
			"zod",
			"left-pad",
			"@effect-like/other",
			"stripe",
			"resend",
			"pdf-lib",
			"xstate",
			"astro",
		])
			mkdirSync(join(root, "node_modules", name), { recursive: true });

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
			"src/lib/b.ts": 'import { z } from "left-pad";\nexport const b = z;',
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

	it("does not count a re-export whose named elements are all type-only", () => {
		const root = scratch({
			"src/scripts/a.ts": [
				'export { type Schema } from "effect/Schema";',
				'export { type A, type B } from "effect/Effect";',
			].join("\n"),
		});

		expect(clientGraphViolations(root)).toEqual([]);
	});

	it("still counts export * and a re-export with a value among its names", () => {
		const root = scratch({
			"src/scripts/a.ts": [
				'export * from "effect/Option";',
				'export * as O from "effect/Result";',
				'export { type A, value } from "effect/Schema";',
				'export { value } from "effect/Effect";',
			].join("\n"),
		});

		expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
			"effect/Option",
			"effect/Result",
			"effect/Schema",
			"effect/Effect",
		]);
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

	describe("evasions a page script could try", () => {
		const server = { "src/server/x.ts": "export const x = 1;" };

		const found = (text: string, extra: Record<string, string> = {}) =>
			clientGraphViolations(
				scratch({ "src/scripts/a.ts": text, ...server, ...extra }),
			).map((violation) => violation.import);

		it("finds a relative import written with a .js suffix that resolves to a .ts file", () => {
			expect(found('import "../server/x.js";')).toEqual(["../server/x.js"]);
		});

		it("finds a root-absolute path", () => {
			expect(found('import "/src/server/x";')).toEqual(["/src/server/x"]);
			expect(found('import "/src/server/x.ts";')).toEqual(["/src/server/x.ts"]);
		});

		it("finds import.meta.glob, eager or not, expanded against the file system", () => {
			expect(
				found(
					'export const all = import.meta.glob("../server/*.ts", { eager: true });',
				),
			).toEqual(["../server/*.ts"]);
			expect(
				found('export const all = import.meta.glob("../server/*");'),
			).toEqual(["../server/*"]);
			expect(
				found(
					'export const all = import.meta.glob(["../lib/*.ts", "/src/server/**/*.ts"]);',
					{
						"src/lib/ok.ts": "export const ok = 1;",
					},
				),
			).toEqual(["/src/server/**/*.ts"]);
		});

		it("does not flag a glob that matches nothing under src/server", () => {
			expect(
				found('export const all = import.meta.glob("../lib/*.ts");', {
					"src/lib/ok.ts": "export const ok = 1;",
				}),
			).toEqual([]);
		});

		it("finds a load of a non-code file under src/server, whatever its extension", () => {
			const data = { "src/server/settings.json": '{ "a": 1 }' };

			expect(
				found('import settings from "../server/settings.json";', data),
			).toEqual(["../server/settings.json"]);
			expect(
				found('import text from "../server/notes.txt?raw";', {
					"src/server/notes.txt": "notes",
				}),
			).toEqual(["../server/notes.txt?raw"]);
			expect(
				found('import url from "../server/schema.sql?url";', {
					"src/server/schema.sql": "select 1;",
				}),
			).toEqual(["../server/schema.sql?url"]);
			expect(found('import "/src/server/settings.json";', data)).toEqual([
				"/src/server/settings.json",
			]);
		});

		it("finds a glob that matches a non-code file under src/server", () => {
			expect(
				found('export const all = import.meta.glob("../server/*.json");', {
					"src/server/settings.json": "{}",
				}),
			).toEqual(["../server/*.json"]);
		});

		it("does not flag a non-code file outside src/server", () => {
			expect(
				found('import data from "../data/x.json";', {
					"src/data/x.json": "{}",
				}),
			).toEqual([]);
		});

		it("finds a template-literal dynamic import without substitutions", () => {
			expect(
				found("export const load = () => import(`../server/x.ts`);"),
			).toEqual(["../server/x.ts"]);
		});

		it("finds import x = require(...) and require(...)", () => {
			expect(
				found('import x = require("../server/x");\nexport { x };'),
			).toEqual(["../server/x"]);
			expect(found('export const x = require("effect/Effect");')).toEqual([
				"effect/Effect",
			]);
		});

		it("finds new Worker(new URL(..., import.meta.url))", () => {
			expect(
				found(
					'export const w = new Worker(new URL("../server/x.ts", import.meta.url));',
				),
			).toEqual(["../server/x.ts"]);
		});

		it("finds .cts and .mts files and follows them", () => {
			expect(
				found('import "../lib/m.mts";', {
					"src/lib/m.mts": 'import "../server/x";',
				}),
			).toEqual(["../server/x"]);
			expect(
				found('import "../lib/c.cjs";', {
					"src/lib/c.cts": 'import "effect/Effect";',
				}),
			).toEqual(["effect/Effect"]);
			expect(
				clientEntries(
					scratch({ "src/scripts/e.cts": "", "src/scripts/f.mts": "" }),
				).length,
			).toBe(2);
		});

		it("finds packages under @effect/", () => {
			expect(found('import "@effect/platform";')).toEqual(["@effect/platform"]);
			expect(found('import "@effect/platform/HttpClient";')).toEqual([
				"@effect/platform/HttpClient",
			]);
			expect(found('import "@effect-like/other";')).toEqual([]);
		});

		it("fails on a load it cannot resolve statically, naming the file and line", () => {
			const root = scratch({
				"src/scripts/a.ts":
					'const name = "x";\nexport const load = () => import(`../server/${name}`);',
				...server,
			});

			expect(clientGraphViolations(root)).toEqual([
				{
					import: "<unresolved>",
					chain: ["src/scripts/a.ts"],
					line: 2,
					reason: "import() with an argument that is not a literal",
				},
			]);
			expect(
				found("declare const n: string;\nexport const l = () => require(n);"),
			).toEqual(["<unresolved>"]);
			expect(found("export const g = import.meta.glob(pattern);")).toEqual([
				"<unresolved>",
			]);
		});
	});

	describe("evasions through aliases, import maps and script tags", () => {
		const server = { "src/server/x.ts": "export const x = 1;" };

		const found = (
			files: Record<string, string>,
			options?: Parameters<typeof scratch>[1],
		) =>
			clientGraphViolations(scratch({ ...server, ...files }, options)).map(
				(violation) => violation.import,
			);

		it("finds an exact tsconfig path alias", () => {
			expect(
				found(
					{ "src/scripts/a.ts": 'import "@srv";' },
					{ paths: { "@srv": ["src/server/x.ts"] } },
				),
			).toEqual(["@srv"]);
		});

		it("finds an alias whose later target is under src/server", () => {
			expect(
				found(
					{ "src/scripts/a.ts": 'import "@m/x";', "src/other/x.ts": "" },
					{ paths: { "@m/*": ["src/other/*", "src/server/*"] } },
				),
			).toEqual(["@m/x"]);
		});

		it("finds an alias written with a ./ target", () => {
			expect(
				found(
					{ "src/scripts/a.ts": 'import "@s/x";' },
					{ paths: { "@s/*": ["./src/server/*"] } },
				),
			).toEqual(["@s/x"]);
		});

		it("finds a glob through an alias with more than one target", () => {
			expect(
				found(
					{
						"src/scripts/a.ts": 'import.meta.glob("@m/*.ts");',
						"src/other/y.ts": "",
					},
					{ paths: { "@m/*": ["src/other/*", "src/server/*"] } },
				),
			).toEqual(["@m/*.ts"]);
		});

		it("finds a package.json imports entry, exact or with a wildcard", () => {
			expect(
				found(
					{ "src/scripts/a.ts": 'import "#srvpkg";\nimport "#dir/x";' },
					{
						packageJson: {
							imports: {
								"#srvpkg": "./src/server/x.ts",
								"#dir/*": { default: "./src/server/*.ts" },
							},
						},
					},
				),
			).toEqual(["#srvpkg", "#dir/x"]);
		});

		it("finds an imports entry that names a forbidden package", () => {
			expect(
				found(
					{ "src/scripts/a.ts": 'import "#fx";' },
					{ packageJson: { imports: { "#fx": ["effect/Schema"] } } },
				),
			).toEqual(["#fx"]);
		});

		it("finds a <script src> in an .astro file", () => {
			expect(
				found({
					"src/pages/a.astro":
						'---\n---\n<script src="../server/x.ts"></script>',
				}),
			).toEqual(["../server/x.ts"]);
			expect(
				found({
					"src/pages/a.astro":
						"---\n---\n<script type='module' src='../lib/b.ts'></script>",
					"src/lib/b.ts": 'import "effect/Effect";',
				}),
			).toEqual(["effect/Effect"]);
		});

		it("reads only the real src attribute of a <script>", () => {
			const lazy = { "public/lazy.js": 'import "effect/Effect";' };

			// data-src and ng-src are not src: the inline body stays in the graph and /lazy.js is not followed.
			expect(
				found({
					"src/pages/a.astro":
						'---\n---\n<script data-src="/lazy.js">import "effect/Schema";</script>',
					...lazy,
				}),
			).toEqual(["effect/Schema"]);
			expect(
				found({
					"src/pages/a.astro":
						'---\n---\n<script ng-src="/lazy.js">import "left-pad";</script>',
					...lazy,
				}),
			).toEqual([]);

			// The real attribute is followed, in any case, quoted or not, before or after other attributes.
			for (const open of [
				'<script src="/lazy.js">',
				"<script SRC='/lazy.js'>",
				"<script src=/lazy.js>",
				'<script type="module" async src="/lazy.js" defer>',
				'<script data-src="/other.js" src="/lazy.js">',
				'<script\n\tsrc = "/lazy.js"\n>',
			])
				expect(
					found({ "src/pages/a.astro": `---\n---\n${open}</script>`, ...lazy }),
				).toEqual(["effect/Effect"]);
		});

		it("reads a root-relative <script src> from public/ and walks that file", () => {
			const root = scratch({
				"src/pages/a.astro": '---\n---\n<script src="/client.js"></script>',
				"public/client.js": 'import "./helper.js";',
				"public/helper.js": 'import "effect/Effect";',
			});

			expect(clientGraphViolations(root)).toEqual([
				{
					import: "effect/Effect",
					chain: ["src/pages/a.astro", "public/client.js", "public/helper.js"],
				},
			]);
		});

		it("passes a root-relative <script src> that names a plain file in public/", () => {
			const root = scratch({
				"src/pages/a.astro": '---\n---\n<script src="/client.js"></script>',
				"public/client.js": "document.title = 'x';",
			});

			expect(clientGraphViolations(root)).toEqual([]);
		});

		it("fails on a root-relative <script src> with no file in public/, naming the line", () => {
			const root = scratch({
				"src/pages/a.astro":
					'---\n---\n<p>x</p>\n<script src="/missing.js"></script>',
				"src/missing.js": "export {};",
			});

			expect(clientGraphViolations(root)).toMatchObject([
				{ import: "/missing.js", chain: ["src/pages/a.astro"], line: 4 },
			]);
		});

		it("does not follow a <script src> that names a URL", () => {
			expect(
				found({
					"src/pages/a.astro":
						'---\n---\n<script src="https://example.com/x.js"></script>',
				}),
			).toEqual([]);
		});

		it("fails on a bare specifier that is not a package in node_modules, naming the line", () => {
			const root = scratch({
				"src/scripts/a.ts": 'import "left-pad";\nimport "#nothing";',
			});

			expect(clientGraphViolations(root)).toEqual([
				{
					import: "#nothing",
					chain: ["src/scripts/a.ts"],
					line: 2,
					reason:
						'"#nothing" is not a relative path, an alias, a forbidden package or a package in node_modules',
				},
			]);
		});

		it("fails on an unresolved <script src> bare name, at the script's line", () => {
			const root = scratch({
				"src/pages/a.astro":
					'---\nconst a = 1;\n---\n<p>x</p>\n<script src="mystery-pkg"></script>',
			});

			expect(clientGraphViolations(root)).toMatchObject([
				{ import: "mystery-pkg", chain: ["src/pages/a.astro"], line: 5 },
			]);
		});

		it("reports a load in a script block at the line it has in the .astro file", () => {
			const root = scratch({
				"src/pages/a.astro":
					'---\nconst a = 1;\n---\n<p>x</p>\n<script>\n\timport "#nothing";\n</script>',
			});

			expect(clientGraphViolations(root)).toMatchObject([
				{ import: "#nothing", line: 6 },
			]);
		});

		it("lets a built-in module through", () => {
			expect(found({ "src/scripts/a.ts": 'import "node:path";' })).toEqual([]);
		});
	});

	describe("installed packages that depend on Effect", () => {
		const manifest = (
			name: string,
			dependencies: Record<string, Record<string, string>>,
		) => ({
			[`node_modules/${name}/package.json`]: JSON.stringify(dependencies),
		});

		const entry = { "src/scripts/a.ts": 'import "dep";' };

		it("finds a package browser code imports that depends on effect", () => {
			const root = scratch(
				{ ...entry, ...manifest("dep", { dependencies: { effect: "^4" } }) },
				{ packages: ["dep"] },
			);

			expect(clientGraphViolations(root)).toEqual([
				{
					import: "effect",
					chain: ["src/scripts/a.ts", "node_modules/dep/package.json"],
				},
			]);
		});

		it("finds a peer dependency on an @effect package", () => {
			const root = scratch(
				{
					...entry,
					...manifest("dep", { peerDependencies: { "@effect/platform": "*" } }),
				},
				{ packages: ["dep"] },
			);

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				"@effect/platform",
			]);
		});

		it("finds @xstate/effect two packages away, naming the packages between", () => {
			const root = scratch(
				{
					...entry,
					...manifest("dep", { dependencies: { mid: "1" } }),
					...manifest("mid", { dependencies: { "@xstate/effect": "1" } }),
				},
				{ packages: ["dep", "mid"] },
			);

			expect(clientGraphViolations(root)).toEqual([
				{
					import: "@xstate/effect",
					chain: [
						"src/scripts/a.ts",
						"node_modules/dep/package.json",
						"node_modules/mid/package.json",
					],
				},
			]);
		});

		it("finds a package that imports only effect/Predicate through its dependencies", () => {
			const root = scratch(
				{
					"src/scripts/a.ts": 'import "dep/sub";',
					...manifest("dep", { dependencies: { effect: "^4" } }),
				},
				{ packages: ["dep"] },
			);

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				"effect",
			]);
		});

		it("follows a dependency cycle once and passes when nothing in it uses effect", () => {
			const root = scratch(
				{
					...entry,
					...manifest("dep", { dependencies: { mid: "1" } }),
					...manifest("mid", { dependencies: { dep: "1" } }),
				},
				{ packages: ["dep", "mid"] },
			);

			expect(clientGraphViolations(root)).toEqual([]);
		});

		it("ignores devDependencies, a package browser code never imports, and a package with no manifest", () => {
			const root = scratch(
				{
					...entry,
					...manifest("dep", { devDependencies: { effect: "^4" } }),
					...manifest("unused", { dependencies: { effect: "^4" } }),
				},
				{ packages: ["dep", "unused"] },
			);

			expect(clientGraphViolations(root)).toEqual([]);
			expect(
				clientGraphViolations(
					scratch({ "src/scripts/a.ts": 'import "left-pad";' }),
				),
			).toEqual([]);
		});
	});

	describe("what a walk reached", () => {
		it("lists every file and package that any client entry loads, and nothing it does not", () => {
			const root = scratch({
				"src/scripts/a.ts":
					'import "~/lib/b";\nimport "left-pad";\nimport "node:path";\nimport type { T } from "~/lib/types-only";',
				"src/lib/b.ts": 'import "./c";',
				"src/lib/c.ts": "export const c = 1;",
				"src/lib/types-only.ts": "export type T = 1;",
				"src/lib/unused.ts": "export const u = 1;",
			});

			const reached: Reached = { files: new Set(), packages: new Set() };

			expect(clientGraphViolations(root, [], reached)).toEqual([]);
			expect([...reached.files].sort()).toEqual([
				"src/lib/b.ts",
				"src/lib/c.ts",
				"src/scripts/a.ts",
			]);
			expect([...reached.packages]).toEqual(["left-pad"]);
		});
	});

	describe("the allowlist", () => {
		it("names the forbidden modules in one list", () => {
			expect(FORBIDDEN_MODULES).toEqual([
				"effect",
				"@effect",
				"@xstate/effect",
				"xstate",
				"zod",
				"stripe",
				"resend",
				"pdf-lib",
			]);
			expect(ALLOWED_BROWSER_MODULES).toEqual(["astro/zod"]);
		});

		it("finds each server-only package, and a package that depends on one", () => {
			for (const name of ["xstate", "zod", "stripe", "resend", "pdf-lib"]) {
				const root = scratch({
					"src/scripts/a.ts": `import "${name}";\nimport "${name}/sub";`,
				});

				expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
					name,
					`${name}/sub`,
				]);
			}

			const root = scratch(
				{
					"src/scripts/a.ts": 'import "dep";',
					"node_modules/dep/package.json": JSON.stringify({
						dependencies: { stripe: "1" },
					}),
				},
				{ packages: ["dep", "stripe"] },
			);

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				"stripe",
			]);
		});

		it("lets astro/zod through, with astro's own dependency on zod, and nothing else of zod", () => {
			const files = {
				"src/scripts/a.ts": 'import { z } from "astro/zod";',
				"node_modules/astro/package.json": JSON.stringify({
					dependencies: { zod: "3" },
				}),
			};

			const options = { packages: ["astro", "zod"] };

			expect(
				clientGraphViolations(scratch(files, options), ALLOWED_BROWSER_MODULES),
			).toEqual([]);
			expect(
				clientGraphViolations(scratch(files, options)).map((v) => v.import),
			).toEqual(["zod"]);
			expect(
				clientGraphViolations(
					scratch({ ...files, "src/scripts/b.ts": 'import "zod";' }, options),
					ALLOWED_BROWSER_MODULES,
				).map((v) => v.import),
			).toEqual(["zod"]);
		});

		it("lets a named module through and nothing else", () => {
			const root = scratch({
				"src/scripts/a.ts": 'import "effect/Schema";\nimport "effect/Effect";',
			});

			expect(
				clientGraphViolations(root, ["effect/Schema"]).map((v) => v.import),
			).toEqual(["effect/Effect"]);
		});
	});
});
