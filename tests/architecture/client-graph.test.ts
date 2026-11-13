import {
	globSync,
	mkdirSync,
	symlinkSync,
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
	hydratedDirectives,
	type Reached,
	serverUsesIn,
} from "../helpers/client-graph";

// Effect, src/server and the server-only packages never reach the browser: src/scripts/** and the <script> blocks of
// .astro files stay plain TypeScript. This walks the static import graph from those entries and fails when any module
// they reach imports `effect`, `@xstate/effect`, `xstate`, `zod` (v4), `stripe`, `resend`, `pdf-lib` (or a package that
// depends on one), or anything under src/server. Type-only imports are erased, so they do not count.
//
// "Server-only" for a src/lib module cannot be told from its path, so the rule is a reviewed allowlist of exactly the
// src/lib (and src/data) modules a browser entry may reach. A module that is not on it, because someone imported a
// server module from a script, fails with an instruction to split the module. Adding a name to the list is a review
// decision: it must be pure (no binding, secret or server package) and is reviewed as such. The allowlist covers the
// modules under src/lib and src/data; the other checks below cover every reached file and every browser entry.
//
// What is checked in every reached file and entry (all the code extensions the walker follows, and the <script> blocks
// of .astro entries): no load of a Node built-in (`node:*` or a bare name like `fs`), of `cloudflare:*` or of
// `astro:env/server` (static import, re-export, `import()`, `require`); no identifier `D1Database`, `R2Bucket` or
// `KVNamespace`; no `.prepare(` call. All of these are read from the syntax tree, so comments, strings, property keys and
// member names (`{ R2Bucket: 1 }`, `o.KVNamespace`) never count; a real reference, a shorthand property or a computed key does.
//
// By design: an npm package named like a Node built-in (`events`, `buffer`, `url`, `util`) fails the built-in rule and
// needs an explicit allowance if it is ever wanted; an Astro virtual module such as `astro:transitions/client` fails
// as unresolved today; and `.prepare(` is flagged on any object in browser-reachable code, not only on a D1 handle.
//
// The reached set includes data files a reached module imports (JSON, and anything imported with `?raw` or `?url`, such
// as .txt, .svg or .css): they are listed, not read, so the allowlist names them too. A file of an installed package
// reached by a relative path or an alias into node_modules (pnpm's `.pnpm/<name>@<version>/node_modules/<name>` layout
// and symlinks included) counts as that package, so the forbidden-package and dependency checks and the package list
// apply to it however the specifier was written.
//
// Hydrated framework components: a component used with a `client:*` directive is browser code this walk does not read.
// The site installs no UI framework (astro.config.mjs lists the sitemap only; package.json has no React, Preact, Vue,
// Svelte, Solid or Lit), so any `client:*` directive in an .astro file (read as an attribute name on a tag with
// Astro's compiler; text and attribute values never count) fails the test outright, with a message to extend
// the walk (take the component's frontmatter import as an entry) before such components are introduced. That is cheaper
// and stricter than walking components that cannot exist yet.
//
// Known gap: a D1 handle that is typed through an owner interface other than the Cloudflare names (so no identifier
// above appears) and run through a method other than `.prepare(` (for example `.batch(` or `.exec(`) is not found.
// A renamed alias of the Cloudflare types with a `.prepare(` call is found. The allowlist review is the control for the
// rest: a module added to BROWSER_MODULES must be read for server work.

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
	"src/data/project-stories/threadline-review.json",
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
		// astro/zod is Zod v3, still used by three browser validators across four modules (audio-intake, software-inquiry, agreement-client-fields,
		// agreement-draft-fields); the Zod to Effect Schema PR removes it, and this test
		// then expects no package at all.
		expect([...reach().packages].sort()).toEqual(["astro"]);
	});

	it("has no hydrated framework component in any .astro file", async () => {
		// The site installs no UI framework integration (astro.config.mjs lists the sitemap only, and package.json has no
		// React, Preact, Vue, Svelte, Solid or Lit), so a `client:*` directive hydrates nothing today. If one appears, the
		// component is browser code this walk does not read: extend the walk to take the component's frontmatter import as
		// an entry before removing this check.
		const holding = (
			await Promise.all(
				globSync("src/**/*.astro", { cwd: repository }).map(async (file) =>
					(
						await hydratedDirectives(
							file,
							readFileSync(join(repository, file), "utf8"),
						)
					).map((use) => `${file}: ${use}`),
				),
			)
		).flat();

		expect(
			holding,
			"A client:* directive hydrates a component in the browser, and the browser import graph guard does not walk it. Extend the guard (take the component's import as a browser entry) before introducing hydrated components.",
		).toEqual([]);
	});

	it("names no Cloudflare binding type and makes no .prepare() call, in any reached file or entry", () => {
		const holding = [...reach().files]
			.filter((file) => /\.([cm]?[jt]sx?|astro)$/.test(file))
			.flatMap((file) =>
				serverUsesIn(file, readFileSync(join(repository, file), "utf8")).map(
					(use) => `${file}: ${use}`,
				),
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

		it("finds a Node built-in, a cloudflare: module and astro:env/server, in every form of load", () => {
			expect(
				found({
					"src/scripts/a.ts": [
						'import "node:path";',
						'import { randomUUID } from "node:crypto";',
						'import fs from "fs";',
						'export * from "node:os";',
						'export const load = () => import("cloudflare:workers");',
						'export const r = require("node:buffer");',
						'import { SECRET } from "astro:env/server";',
					].join("\n"),
				}),
			).toEqual([
				"node:path",
				"node:crypto",
				"fs",
				"node:os",
				"cloudflare:workers",
				"node:buffer",
				"astro:env/server",
			]);
		});

		it("finds a Node built-in in an .astro script block and in a module a script reaches", () => {
			expect(
				found({
					"src/pages/a.astro":
						'---\nimport { x } from "node:fs";\n---\n<script>import "~/lib/b";\nimport "node:crypto";</script>',
					"src/lib/b.ts": 'import "node:path";',
				}),
			).toEqual(["node:crypto", "node:path"]);
		});

		it("does not count a type-only import of a built-in", () => {
			expect(
				found({
					"src/scripts/a.ts": 'import type { Buffer } from "node:buffer";',
				}),
			).toEqual([]);
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
					'import "~/lib/b";\nimport "left-pad";\nimport type { T } from "~/lib/types-only";',
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

	describe("server-only uses in a file's own text", () => {
		it("finds binding types and .prepare() calls, in .ts and in .astro script blocks", () => {
			expect(
				serverUsesIn(
					"a.ts",
					'import type { D1Database as Db } from "x";\nlet a: R2Bucket;\nconst k: KVNamespace = 1;\ndb.prepare("select 1");',
				),
			).toEqual([
				"D1Database at line 1",
				"R2Bucket at line 2",
				"KVNamespace at line 3",
				".prepare() call at line 4",
			]);
			expect(
				serverUsesIn(
					"a.astro",
					"---\nlet a: D1Database;\n---\n<script>\nlet b: R2Bucket;\n</script>",
				),
			).toEqual(["R2Bucket at line 5"]);
		});

		it("still counts a real reference: a type, a value, a shorthand property and a computed key", () => {
			expect(
				serverUsesIn(
					"a.ts",
					"let a: D1Database;\nconst b = { R2Bucket };\nconst c = { [KVNamespace]: 1 };",
				),
			).toEqual([
				"D1Database at line 1",
				"R2Bucket at line 2",
				"KVNamespace at line 3",
			]);
		});

		it("does not count a comment, a string, an object key or free text that says the same", () => {
			expect(
				serverUsesIn(
					"a.ts",
					[
						"// the DOM node: a D1Database is not used here, nor db.prepare(x)",
						'const note = "node: R2Bucket KVNamespace .prepare(";',
						"const o = { node: el, prepare: 1, R2: 2, R2Bucket: 'Storage', 'KVNamespace': 1 };",
						"const v = o.KVNamespace + o.D1Database;",
						"interface Names { D1Database: string; R2Bucket?: number }",
						"class C { KVNamespace = 1; D1Database() {} }",
						"o.node = el;",
						"const f = o.prepare;",
						"/* import 'node:fs' */",
					].join("\n"),
				),
			).toEqual([]);
		});
	});

	describe("data files and packages reached by path", () => {
		const reachedOf = (
			files: Record<string, string>,
			options?: Parameters<typeof scratch>[1],
			allow: readonly string[] = [],
		) => {
			const reached: Reached = { files: new Set(), packages: new Set() };

			const violations = clientGraphViolations(
				scratch(files, options),
				allow,
				reached,
			);

			return { reached, violations };
		};

		it("puts a JSON, text, SVG or other data file a reached module imports in the reached set, without reading it", () => {
			const { reached, violations } = reachedOf({
				"src/scripts/a.ts": [
					'import story from "~/data/story.json";',
					'import notes from "~/lib/notes.txt?raw";',
					'import logo from "~/lib/logo.svg?url";',
					'import "~/lib/style.css";',
				].join("\n"),
				"src/data/story.json": '{ "import": "effect" }',
				"src/lib/notes.txt": 'import "effect";',
				"src/lib/logo.svg": "<svg/>",
				"src/lib/style.css": "a{}",
			});

			expect(violations).toEqual([]);
			expect([...reached.files].sort()).toEqual([
				"src/data/story.json",
				"src/lib/logo.svg",
				"src/lib/notes.txt",
				"src/lib/style.css",
				"src/scripts/a.ts",
			]);
		});

		it("reaches a data file through a code file, and through an alias", () => {
			const { reached } = reachedOf(
				{
					"src/scripts/a.ts": 'import "@d/x.json";\nimport "~/lib/b";',
					"src/lib/b.ts": 'import "../data/y.json";',
					"src/data/x.json": "{}",
					"src/data/y.json": "{}",
				},
				{ paths: { "@d/*": ["src/data/*"] } },
			);

			expect(
				[...reached.files].filter((f) => f.endsWith(".json")).sort(),
			).toEqual(["src/data/x.json", "src/data/y.json"]);
		});

		it("counts a package reached through a relative path into node_modules, whatever the specifier looked like", () => {
			const files = {
				"node_modules/stripe/index.js": "export const s = 1;",
				"node_modules/left-pad/index.js": "export const p = 1;",
				"node_modules/@effect/platform/index.js": "export const e = 1;",
				"node_modules/.pnpm/resend@1.0.0/node_modules/resend/index.js":
					"export const r = 1;",
			};

			for (const [specifier, name] of [
				["../../node_modules/stripe/index.js", "stripe"],
				["../../node_modules/@effect/platform/index.js", "@effect/platform"],
				[
					"../../node_modules/.pnpm/resend@1.0.0/node_modules/resend/index.js",
					"resend",
				],
			])
				expect(
					clientGraphViolations(
						scratch({ ...files, "src/scripts/a.ts": `import "${specifier}";` }),
					).map((v) => v.import),
					name,
				).toEqual([specifier]);

			const { reached, violations } = reachedOf({
				...files,
				"src/scripts/a.ts": 'import "../../node_modules/left-pad/index.js";',
			});

			expect(violations).toEqual([]);
			expect([...reached.packages]).toEqual(["left-pad"]);
		});

		it("counts a package reached through a paths alias and through a symlink", () => {
			const root = scratch(
				{
					"node_modules/.pnpm/stripe@1.0.0/node_modules/stripe/index.js":
						"export const s = 1;",
					"src/scripts/a.ts": 'import "@s";\nimport "../lib-link/index.js";',
				},
				{
					paths: {
						"@s": [
							"node_modules/.pnpm/stripe@1.0.0/node_modules/stripe/index.js",
						],
					},
				},
			);

			symlinkSync(
				join(root, "node_modules/.pnpm/stripe@1.0.0/node_modules/stripe"),
				join(root, "src/lib-link"),
			);

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				"@s",
				"../lib-link/index.js",
			]);
		});

		it("applies the dependency check to a package reached by path", () => {
			const root = scratch(
				{
					"node_modules/dep/index.js": "export const d = 1;",
					"node_modules/dep/package.json": JSON.stringify({
						dependencies: { stripe: "1" },
					}),
					"src/scripts/a.ts": 'import "../../node_modules/dep/index.js";',
				},
				{ packages: ["stripe"] },
			);

			expect(clientGraphViolations(root).map((v) => v.import)).toEqual([
				"stripe",
			]);
		});
	});

	describe("hydrated framework components", () => {
		it("finds every client: directive on a component, in any attribute position", async () => {
			expect(
				await hydratedDirectives(
					"a.astro",
					[
						"---",
						"import Counter from '~/components/Counter.tsx';",
						"---",
						"<Counter client:load />",
						"<Widget",
						"  title='a > b'",
						"  client:visible",
						"/>",
						'<Chart client:only="react" />',
						"<Idle client:idle />",
						'<Media client:media="(min-width: 50em)" />',
					].join("\n"),
				),
			).toEqual([
				"client:load at line 4",
				"client:visible at line 7",
				"client:only at line 9",
				"client:idle at line 10",
				"client:media at line 11",
			]);
		});

		it("does not count a comment, frontmatter, a script or style block, text, an attribute value, or a name that is not a directive", async () => {
			expect(
				await hydratedDirectives(
					"a.astro",
					[
						'---\nconst s = "client:load";\n---',
						"<!-- <A client:load /> -->",
						'<script>const s = "<A client:load />";</script>',
						"<style>.a::after { content: 'client:idle'; }</style>",
						"<B client:other data-client:load2 myclient:load />",
						"<p>Use client:load</p>",
						'<p title="client:load example">Use client:only="react"</p>',
						"<Foo label='client:idle' data-note=\"x client:visible y\" />",
					].join("\n"),
				),
			).toEqual([]);
		});

		it("finds the plain cases and the awkward ones", async () => {
			expect(
				await hydratedDirectives("a.astro", "<Foo client:load />"),
			).toEqual(["client:load at line 1"]);
			expect(
				await hydratedDirectives("a.astro", '<Foo client:only="react" />'),
			).toEqual(["client:only at line 1"]);
			expect(
				await hydratedDirectives(
					"a.astro",
					'<Foo\n  title="x"\n  client:idle\n/>',
				),
			).toEqual(["client:idle at line 3"]);
			expect(
				await hydratedDirectives(
					"a.astro",
					'<Foo title="a > b" other={1 > 0} client:visible />',
				),
			).toEqual(["client:visible at line 1"]);
			// A lower-case HTML element carrying the attribute counts too: Astro does not hydrate it, but a stray directive
			// is a mistake worth failing on.
			expect(
				await hydratedDirectives("a.astro", "<div client:load></div>"),
			).toEqual(["client:load at line 1"]);
		});

		it("is empty for a file that is not .astro", async () => {
			expect(await hydratedDirectives("a.ts", "<A client:load />")).toEqual([]);
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
