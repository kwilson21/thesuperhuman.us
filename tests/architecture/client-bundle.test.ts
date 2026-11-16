import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	BROWSER_MODULES,
	BROWSER_PACKAGES,
	BROWSER_VIRTUAL_MODULES,
	PUBLIC_SCRIPTS,
} from "../helpers/browser-modules";
import {
	bundleViolations,
	inlinedScripts,
	type ClientManifest,
	MANIFEST_PATH,
	staleManifest,
} from "../helpers/client-manifest";

// The guarantee that server code stays out of the browser. client-graph.test.ts walks the source's import graph, a fast
// approximation that runs in plain `pnpm test`; this file asks the bundler itself. The client build (scripts/
// client-bundle-manifest.mjs, a Vite plugin) records every module that went into each browser chunk, the small page
// scripts Astro inlines included, and "the built browser bundle" below checks that list: the repository modules and
// the packages must equal reviewed lists, and no server module, forbidden package or Node/Cloudflare module may be
// in it. The text markers further down are a second, independent look at the emitted files.
//
// The independent backstop to client-graph.test.ts: that test walks the source's import graph, this one looks at what
// the build actually shipped. It reads every browser script under dist/ (dist/_astro/ and scripts copied from public/, not the server output dist/_worker.js/) and fails when a chunk holds anything of Effect beyond
// Effect Schema, @xstate/effect, Stripe, Zod (either version) or another reviewed-out runtime, however it got there
// (an import the walker cannot see, a glob, a plugin). It needs a build: run
// `pnpm run build` first. With no dist/ it skips, under a name that says so, unless REQUIRE_CLIENT_BUNDLE=1 is set:
// then a missing dist/ FAILS the test. CI sets it, in a step after the build (.github/workflows/validate.yml);
// the plain `pnpm test` step there runs before the build, so without it the test would skip in CI for good.
//
// The markers are string literals the libraries keep in their runtime, which a minifier cannot rename. They were
// chosen by bundling scratch entries with esbuild --bundle --minify (the minifier Astro's client build uses) and
// reading what survived:
//   "~effect/<Name>" the type id Effect keeps for each of its modules ("~effect/Cause", "~effect/Schema", and so on).
//                    Effect Schema is allowed in the browser, and its bundle holds 23 of these (SCHEMA_MARKERS: the
//                    Schema's own ids and the few runtime modules it is built on: Cause, Context, Effect, Equal, Exit,
//                    Fiber, Hash, Option, Redactable, Result and the Schema modules). Any other "~effect/<Name>" is a
//                    module the Schema bundle does not hold, so it fails: "~effect/Layer", "~effect/Scope" and
//                    "~effect/Deferred" are what a bundle that builds a Layer adds, and what `Effect.runSync` or
//                    `Effect.gen` alone adds is not distinguishable here (they use only modules Schema holds), so the
//                    source walker (client-graph.test.ts) carries that rule. A change of the pinned effect version can
//                    change this list: review it with the pin.
//   "EffectFailure"  the class tag of @xstate/effect's failure wrapper; in every bundle of @xstate/effect (3 times), which
//                    also pulls in the Effect runtime.
//   "api.stripe.com" and "Stripe-Version"
//                    the Stripe SDK's API host and its version header. Stripe is a server package: browser code never
//                    holds a Stripe client, so either string in a browser script means the SDK was bundled.
//   "$ZodType"       the base class of Zod v4 (`zod`, the package). Zod v4 is a server validator and does not reach the browser.
//   "ZodString" and "ZodEffects"
//                    the names of Zod v3's classes (`astro/zod` ships v3), kept as the strings of its
//                    `ZodFirstPartyTypeKind` enum; in every bundle of `astro/zod` (one or more of each). The browser
//                    validators are Effect Schema now, so Zod 3 no longer reaches the browser.
const RUNTIME_MARKERS = [
	"EffectFailure",
	"api.stripe.com",
	"Stripe-Version",
	"$ZodType",
	"ZodString",
	"ZodEffects",
] as const;

/** The `~effect/<Name>` type ids an Effect Schema bundle holds (the 23 the real client build has). */
const SCHEMA_MARKERS: readonly string[] = [
	"~effect/Cause",
	"~effect/Cause/AsyncFiberError",
	"~effect/Cause/Reason",
	"~effect/Context",
	"~effect/Context/Reference",
	"~effect/Context/Service",
	"~effect/Context/defaultValue",
	"~effect/Effect",
	"~effect/Effect/stackProbe",
	"~effect/Equal",
	"~effect/Exit",
	"~effect/Fiber",
	"~effect/Fiber/currentFiber",
	"~effect/Hash",
	"~effect/Option",
	"~effect/Redactable",
	"~effect/Result",
	"~effect/Schema",
	"~effect/Schema/Schema",
	"~effect/Schema/SchemaError",
	"~effect/SchemaIssue/Issue",
	"~effect/SchemaTransformation/Transformation",
	"~effect/Utils/internal",
];

const required = process.env.REQUIRE_CLIENT_BUNDLE === "1";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bundle = join(repository, "dist");

/** Every .js and .mjs file under `directory`. */
function chunksUnder(directory: string, skip: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);

		if (path === skip) return [];

		if (entry.isDirectory()) return chunksUnder(path, skip);

		return /\.m?js$/.test(entry.name) ? [path] : [];
	});
}

// What a build emits that is not browser code: dist/_worker.js/ is the server output (the Cloudflare Worker), which
// holds Effect on purpose. Everything else under dist/ is served to the browser, including a script copied from public/
// (a `<script src="/client.js">` lands at dist/client.js) and the chunks in dist/_astro/.
const SERVER_OUTPUT = "_worker.js";

/** Every .js and .mjs file a build serves to the browser: all of `dist` except the server output. */
function browserScripts(dist: string): string[] {
	return chunksUnder(dist, join(dist, SERVER_OUTPUT)).sort();
}

/** The markers a chunk's text holds that it must not: the runtime markers, and every `~effect/<Name>` Schema does not hold. */
function markersIn(text: string): string[] {
	const effect = [...new Set(text.match(/~effect\/[A-Za-z0-9_/]*/g) ?? [])]
		.filter((marker) => !SCHEMA_MARKERS.includes(marker))
		.sort();

	return [
		...RUNTIME_MARKERS.filter((marker) => text.includes(marker)),
		...effect,
	];
}

describe("the markers", () => {
	it("find each runtime and nothing in plain code", () => {
		expect(markersIn('x={_tag:"EffectFailure"}')).toEqual(["EffectFailure"]);
		expect(markersIn('fetch("https://api.stripe.com/v1/invoices")')).toEqual([
			"api.stripe.com",
		]);
		expect(markersIn('h={"Stripe-Version":"2026"}')).toEqual([
			"Stripe-Version",
		]);
		expect(markersIn("class a extends $ZodType{}")).toEqual(["$ZodType"]);
		expect(markersIn('var a="ZodString",b="ZodEffects";')).toEqual([
			"ZodString",
			"ZodEffects",
		]);
		expect(markersIn("const a = document.title;")).toEqual([]);
	});

	it("let Effect Schema's own ids through", () => {
		expect(
			markersIn(SCHEMA_MARKERS.map((marker) => `var a="${marker}";`).join("")),
		).toEqual([]);
		expect(markersIn('var a="~effect/Cause",b="~effect/Schema";')).toEqual([]);
	});

	it("find the runtime a Layer adds, and any effect module Schema does not hold", () => {
		for (const name of ["Layer", "Scope", "Deferred"])
			expect(markersIn(`var a="~effect/${name}";`)).toEqual([
				`~effect/${name}`,
			]);

		expect(
			markersIn(
				'var a="~effect/Layer/MemoMap",b="~effect/Scope/Closeable",c="~effect/Schema";',
			),
		).toEqual(["~effect/Layer/MemoMap", "~effect/Scope/Closeable"]);
		expect(markersIn('var a="~effect/Logger";')).toEqual(["~effect/Logger"]);
	});
});

describe("browserScripts", () => {
	const dists: string[] = [];

	afterEach(() => {
		for (const dist of dists.splice(0))
			rmSync(dist, { recursive: true, force: true });
	});

	it("lists the .js and .mjs files of the build, public scripts included, and not the server output", () => {
		const dist = mkdtempSync(join(tmpdir(), "client-bundle-"));

		dists.push(dist);

		for (const path of [
			"_astro/app.js",
			"_astro/nested/chunk.mjs",
			"client.js",
			"vendor/lib.mjs",
			"_worker.js/index.js",
			"_worker.js/chunks/page.mjs",
			"_astro/style.css",
			"data.json",
		]) {
			mkdirSync(dirname(join(dist, path)), { recursive: true });
			writeFileSync(join(dist, path), "");
		}

		expect(
			browserScripts(dist).map((file) => file.slice(dist.length + 1)),
		).toEqual([
			"_astro/app.js",
			"_astro/nested/chunk.mjs",
			"client.js",
			"vendor/lib.mjs",
		]);
	});
});

describe("the built browser bundle", () => {
	it.skipIf(!existsSync(bundle) && !required)(
		existsSync(bundle) || required
			? "holds no Effect beyond Schema, no @xstate/effect, Stripe or Zod runtime code"
			: "holds no server runtime code (skipped: no dist/, run pnpm run build first)",
		() => {
			expect(
				existsSync(bundle),
				"REQUIRE_CLIENT_BUNDLE=1 is set but dist/ is missing: run pnpm run build first",
			).toBe(true);

			const chunks = browserScripts(bundle);

			expect(chunks.length).toBeGreaterThan(0);

			const holding = chunks.flatMap((chunk) => {
				const markers = markersIn(readFileSync(chunk, "utf8"));

				return markers.length > 0
					? [{ chunk: chunk.slice(repository.length + 1), markers }]
					: [];
			});

			expect(holding).toEqual([]);
		},
	);
});

const manifestFile = join(repository, MANIFEST_PATH);

// SAFETY: the file is written by scripts/client-bundle-manifest.mjs in the shape of ClientManifest; staleManifest and
// bundleViolations then check it against dist/.
const readManifest = () =>
	JSON.parse(readFileSync(manifestFile, "utf8")) as ClientManifest;

describe("the bundler's module manifest", () => {
	it.skipIf(!existsSync(bundle) && !required)(
		existsSync(bundle) || required
			? "describes this dist/ and puts only reviewed modules and packages in browser code"
			: "puts only reviewed modules in browser code (skipped: no dist/, run pnpm run build first)",
		() => {
			expect(
				existsSync(bundle),
				"REQUIRE_CLIENT_BUNDLE=1 is set but dist/ is missing: run pnpm run build first",
			).toBe(true);
			expect(
				existsSync(manifestFile),
				`dist/ exists but ${MANIFEST_PATH} does not: the build did not run scripts/client-bundle-manifest.mjs (astro.config.mjs vite.plugins). Run pnpm run build.`,
			).toBe(true);

			const manifest = readManifest();

			expect(
				staleManifest(manifest, bundle, PUBLIC_SCRIPTS),
				`${MANIFEST_PATH} does not describe this dist/. Run pnpm run build again.`,
			).toEqual([]);
			expect(manifest.chunks.length).toBeGreaterThan(20);
			expect(
				bundleViolations(manifest, {
					repoModules: BROWSER_MODULES,
					packages: BROWSER_PACKAGES,
					virtualModules: BROWSER_VIRTUAL_MODULES,
				}),
			).toEqual([]);
		},
	);
});

describe("bundleViolations", () => {
	const chunk = (...modules: string[]) => ({
		file: "_astro/a.js",
		sha256: "",
		trimmedSha256: "",
		modules,
	});

	const manifest = (
		modules: string[],
		extra: Partial<ClientManifest> = {},
	): ClientManifest => ({
		version: 2,
		chunks: [chunk(...modules)],
		unrendered: [],
		...extra,
	});

	// SAFETY: an empty list typed as the allowlist's element type; no value is asserted.
	const allowed = {
		repoModules: ["src/lib/ok.ts"],
		packages: ["effect"],
		virtualModules: [] as readonly string[],
	};

	const base = [
		"src/scripts/a.ts",
		"src/lib/ok.ts",
		"npm:effect@4.1.4/dist/Schema.js",
	];

	it("accepts exactly the reviewed modules and packages", () => {
		expect(bundleViolations(manifest(base), allowed)).toEqual([]);
	});

	it("takes entries (src/scripts and .astro) as browser code without listing them", () => {
		expect(
			bundleViolations(
				manifest([...base, "src/pages/x.astro", "src/components/Y.astro"]),
				allowed,
			),
		).toEqual([]);
	});

	it("flags a repository module that is not on the list, and a listed one that is gone", () => {
		expect(
			bundleViolations(manifest([...base, "src/lib/new.ts"]), allowed),
		).toEqual(["repository module not on the reviewed list: src/lib/new.ts"]);
		expect(
			bundleViolations(
				manifest(["src/scripts/a.ts", "npm:effect@4.1.4/dist/Schema.js"]),
				allowed,
			),
		).toEqual([
			"reviewed module no longer in browser code, remove it: src/lib/ok.ts",
		]);
	});

	it("flags a file of src/server and any other repository folder", () => {
		expect(
			bundleViolations(manifest([...base, "src/server/db.ts"]), allowed),
		).toEqual(["server module in browser code: src/server/db.ts"]);
		expect(
			bundleViolations(manifest([...base, "scripts/x.mjs"]), allowed),
		).toEqual(["repository module not on the reviewed list: scripts/x.mjs"]);
	});

	it("flags a package off the list, a forbidden package, and a listed package that is gone", () => {
		expect(
			bundleViolations(
				manifest([...base, "npm:stripe@19.0.0/esm/index.js"]),
				allowed,
			),
		).toEqual([
			"package not on the reviewed list: stripe",
			"forbidden package in browser code: stripe@19.0.0",
		]);
		expect(
			bundleViolations(
				manifest(["src/scripts/a.ts", "src/lib/ok.ts"]),
				allowed,
			),
		).toEqual([
			"reviewed package no longer in browser code, remove it: effect",
		]);
	});

	it("accepts the effect package as a whole, and flags its scoped packages and xstate", () => {
		const wide = {
			...allowed,
			packages: ["effect", "@effect/platform", "@xstate/effect", "xstate"],
		};

		expect(
			bundleViolations(
				manifest([
					...base,
					"npm:effect@4.1.4/dist/internal/effect.js",
					"npm:effect@4.1.4/dist/Layer.js",
				]),
				allowed,
			),
		).toEqual([]);

		expect(
			bundleViolations(
				manifest([
					...base,
					"npm:@effect/platform@4.0.0/index.js",
					"npm:@xstate/effect@1.0.0/dist/a.js",
					"npm:xstate@5.0.0/dist/b.js",
				]),
				wide,
			).sort(),
		).toEqual([
			"forbidden package in browser code: @effect/platform@4.0.0",
			"forbidden package in browser code: @xstate/effect@1.0.0",
			"forbidden package in browser code: xstate@5.0.0",
		]);
	});

	it("forbids Zod in every version: v3 (astro/zod) and v4 are both server validators now", () => {
		const v3 = "npm:zod@3.25.76/v3/types.js";
		const v4 = "npm:zod@4.6.5/v4/core/core.js";
		const withZod = { ...allowed, packages: ["effect", "zod"] };

		for (const [module, label] of [
			[v3, "zod@3.25.76"],
			[v4, "zod@4.6.5"],
		] as const) {
			// Listed as a package, it is still forbidden.
			expect(bundleViolations(manifest([...base, module]), withZod)).toEqual([
				`forbidden package in browser code: ${label}`,
			]);
			// Not listed, it is off the list as well.
			expect(
				bundleViolations(manifest([...base, module]), allowed).sort(),
			).toEqual(
				[
					`forbidden package in browser code: ${label}`,
					"package not on the reviewed list: zod",
				].sort(),
			);
			// Folded in as an unrendered module counts too.
			expect(
				bundleViolations(manifest(base, { unrendered: [module] }), withZod),
			).toEqual([`forbidden package in browser code: ${label}`]);
		}

		expect(
			bundleViolations(manifest([...base, v3, v4]), withZod).sort(),
		).toEqual([
			"forbidden package in browser code: zod@3.25.76",
			"forbidden package in browser code: zod@4.6.5",
		]);
	});

	it("treats a Zod module whose label carries no version as forbidden", () => {
		expect(
			bundleViolations(manifest([...base, "npm:zod/v3/errors.js"]), {
				...allowed,
				packages: ["effect", "zod"],
			}),
		).toEqual(["forbidden package in browser code: zod"]);
	});

	it("flags node: and cloudflare: modules, the bundler's stand-in for a Node built-in, and files outside the repository", () => {
		expect(
			bundleViolations(
				manifest([
					...base,
					"node:fs",
					"cloudflare:workers",
					"\0__vite-browser-external:fs",
					"outside:/tmp/x.js",
				]),
				allowed,
			).sort(),
		).toEqual(
			[
				"Node or Cloudflare module in browser code: node:fs",
				"Node or Cloudflare module in browser code: cloudflare:workers",
				"Node or Cloudflare module in browser code: \0__vite-browser-external:fs",
				"file outside the repository in browser code: outside:/tmp/x.js",
			].sort(),
		);
	});

	it("flags a virtual module that is not on the reviewed list, and a reviewed one that is gone", () => {
		for (const id of ["\0plugin/generated.js", "astro:env/client", "virtual:x"])
			expect(bundleViolations(manifest([...base, id]), allowed)).toEqual([
				`virtual module not on the reviewed list: ${id}`,
			]);

		expect(
			bundleViolations(manifest([...base, "virtual:x"]), {
				...allowed,
				virtualModules: ["virtual:x"],
			}),
		).toEqual([]);
		expect(
			bundleViolations(manifest(base), {
				...allowed,
				virtualModules: ["virtual:x"],
			}),
		).toEqual([
			"reviewed virtual module no longer in browser code, remove it: virtual:x",
		]);
	});

	it("fails closed on a worker, which is built apart from this bundle and not listed here", () => {
		const message = (what: string) =>
			`Web Worker in browser code: ${what}. The guard does not follow worker builds: extend it before introducing workers.`;

		expect(
			bundleViolations(
				manifest([...base, "src/lib/ok.ts?worker&inline"]),
				allowed,
			),
		).toEqual([message("src/lib/ok.ts?worker&inline")]);
		expect(
			bundleViolations(
				manifest([...base, "src/lib/ok.ts?sharedworker"]),
				allowed,
			),
		).toEqual([message("src/lib/ok.ts?sharedworker")]);
		expect(
			bundleViolations(
				{
					version: 2,
					chunks: [{ ...chunk(...base), worker: true }],
					unrendered: [],
				},
				allowed,
			),
		).toEqual([message("a chunk that constructs a Worker (_astro/a.js)")]);
	});

	it("counts a module folded into code (unrendered) like one in a chunk", () => {
		expect(
			bundleViolations(
				manifest(base, { unrendered: ["src/data/secret.json"] }),
				allowed,
			),
		).toEqual([
			"repository module not on the reviewed list: src/data/secret.json",
		]);
	});

	it("flags the effect package when it is not on the reviewed list, and when it is gone", () => {
		expect(
			bundleViolations(manifest([...base]), { ...allowed, packages: [] }),
		).toEqual(["package not on the reviewed list: effect"]);
		expect(
			bundleViolations(
				manifest(["src/scripts/a.ts", "src/lib/ok.ts"]),
				allowed,
			),
		).toEqual([
			"reviewed package no longer in browser code, remove it: effect",
		]);
	});
});

describe("inlinedScripts", () => {
	it("reads the entries of the array after the key, strings and escapes included", () => {
		const text = `x = {"a":[["no"]],"inlinedScripts":[["/r/a.astro?astro&type=script","let q=\\"]\\";"],["/r/b.astro","b()"]],"after":[["c"]]}`;

		expect(inlinedScripts(text)).toEqual([
			{ id: "/r/a.astro?astro&type=script", code: 'let q="]";' },
			{ id: "/r/b.astro", code: "b()" },
		]);
		expect(inlinedScripts("no such key")).toEqual([]);
	});
});

describe("staleManifest", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0))
			rmSync(root, { recursive: true, force: true });
	});

	const sha = (text: string) => createHash("sha256").update(text).digest("hex");

	const build = (files: Record<string, string>) => {
		const dist = mkdtempSync(join(tmpdir(), "client-stale-"));

		roots.push(dist);

		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(dist, path)), { recursive: true });
			writeFileSync(join(dist, path), text);
		}

		return dist;
	};

	const entry = (file: string, code: string) => ({
		file,
		sha256: sha(code),
		trimmedSha256: sha(code.trim()),
		modules: [],
	});

	/** A server manifest whose inlined scripts are `scripts`, serialized the way Astro does. */
	const serverManifest = (scripts: Record<string, string>) =>
		`export const manifest = {"x":1,"inlinedScripts":${JSON.stringify(Object.entries(scripts))},"y":2};`;

	const manifestOf = (
		...chunks: ReturnType<typeof entry>[]
	): ClientManifest => ({
		version: 2,
		chunks,
		unrendered: [],
	});

	const inline = 'let q="z";';

	it("passes for an unchanged build: scripts match their chunks and the inlined script matches its entry", () => {
		const dist = build({
			"_astro/a.js": "alert(1)",
			"_worker.js/manifest_x.mjs": serverManifest({ "/r/b.astro": inline }),
		});

		expect(
			staleManifest(
				manifestOf(
					entry("_astro/a.js", "alert(1)"),
					entry("_astro/b.js", `${inline}\n`),
				),
				dist,
			),
		).toEqual([]);
	});

	it("fails when a built file is hand-edited, or a chunk is not in the manifest", () => {
		const dist = build({
			"_astro/changed.js": "after",
			"_astro/new.js": "x",
			"_worker.js/manifest_x.mjs": serverManifest({}),
		});

		expect(
			staleManifest(manifestOf(entry("_astro/changed.js", "before")), dist),
		).toEqual([
			"_astro/changed.js differs from the chunk the manifest describes",
			"_astro/new.js is a browser script in dist/ that is neither in the manifest nor a reviewed public script",
		]);
	});

	it("fails for an old manifest against a rebuilt site, and for no manifest chunk at all", () => {
		const dist = build({
			"_astro/a.NEWHASH.js": "alert(2)",
			"_worker.js/manifest_x.mjs": serverManifest({}),
		});

		expect(
			staleManifest(manifestOf(entry("_astro/a.OLDHASH.js", "alert(1)")), dist),
		).toEqual([
			"_astro/a.NEWHASH.js is a browser script in dist/ that is neither in the manifest nor a reviewed public script",
			"_astro/a.OLDHASH.js is in the manifest but neither in dist/ nor inlined into a page",
		]);
		expect(staleManifest(manifestOf(), dist)).toEqual([
			"_astro/a.NEWHASH.js is a browser script in dist/ that is neither in the manifest nor a reviewed public script",
		]);
	});

	it("fails for an inlined script whose body changed but whose end did not", () => {
		const dist = build({
			"_worker.js/manifest_x.mjs": serverManifest({
				"/r/b.astro": 'EVIL();let q="z";',
			}),
		});

		expect(
			staleManifest(manifestOf(entry("_astro/b.js", inline)), dist),
		).toEqual([
			"_astro/b.js is in the manifest but neither in dist/ nor inlined into a page",
			"an inlined script (b.astro) has no chunk in the manifest",
		]);
	});

	it("fails for an inlined script that has no recorded chunk", () => {
		const dist = build({
			"_astro/a.js": "alert(1)",
			"_worker.js/manifest_x.mjs": serverManifest({ "/r/late.astro": inline }),
		});

		expect(
			staleManifest(manifestOf(entry("_astro/a.js", "alert(1)")), dist),
		).toEqual(["an inlined script (late.astro) has no chunk in the manifest"]);
	});

	it("fails for a stray script outside _astro, and accepts one only with its reviewed hash", () => {
		const dist = build({
			"client.js": "stray()",
			"nested/lib.mjs": "lib()",
			"_worker.js/manifest_x.mjs": serverManifest({}),
		});

		const empty = manifestOf();

		expect(staleManifest(empty, dist)).toEqual([
			"client.js is a browser script in dist/ that is neither in the manifest nor a reviewed public script",
			"nested/lib.mjs is a browser script in dist/ that is neither in the manifest nor a reviewed public script",
		]);
		expect(
			staleManifest(empty, dist, {
				"client.js": sha("stray()"),
				"nested/lib.mjs": sha("lib()"),
			}),
		).toEqual([]);
		expect(
			staleManifest(empty, dist, {
				"client.js": sha("changed()"),
				"nested/lib.mjs": sha("lib()"),
			}),
		).toEqual([
			"client.js is a public script whose content changed: review it and update its hash",
		]);
		expect(
			staleManifest(empty, dist, {
				"client.js": sha("stray()"),
				"nested/lib.mjs": sha("lib()"),
				"gone.js": sha("x"),
			}),
		).toEqual(["reviewed public script gone.js is not in dist/, remove it"]);
	});

	it("does not read the server output as browser code", () => {
		const dist = build({
			"_worker.js/index.js": "server()",
			"_worker.js/chunks/page.mjs": "page()",
			"_worker.js/manifest_x.mjs": serverManifest({}),
		});

		expect(staleManifest(manifestOf(), dist)).toEqual([]);
	});
});
