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
// the build actually shipped. It reads every browser script under dist/ (dist/_astro/ and scripts copied from public/, not the server output dist/_worker.js/) and fails when a chunk holds Effect, @xstate/effect, Stripe or Zod v4 runtime
// code, however it got there (an import the walker cannot see, a glob, a plugin). It needs a build: run
// `pnpm run build` first. With no dist/ it skips, under a name that says so, unless REQUIRE_CLIENT_BUNDLE=1 is set:
// then a missing dist/ FAILS the test. CI sets it, in a step after the build (.github/workflows/validate.yml);
// the plain `pnpm test` step there runs before the build, so without it the test would skip in CI for good.
//
// The markers are string literals the libraries keep in their runtime, which a minifier cannot rename. They were
// chosen by bundling scratch entries with esbuild --bundle --minify (the minifier Astro's client build uses) and
// reading what survived:
//   "~effect/"       the prefix of every type id Effect keeps ("~effect/Cause", "~effect/Equal", "~effect/Schema" and so
//                    on). Present in every bundle of effect/Effect (37), effect/Schema (79), effect/Option (13, which
//                    carries "~effect/Option" and "~effect/Equal" but not "~effect/Cause") and @xstate/effect (96);
//                    absent only from the pure helper effect/Predicate, which carries no runtime. A marker that names a
//                    single module (Cause, Schema) misses a chunk that uses a different one, so this is the prefix.
//   "EffectFailure"  the class tag of @xstate/effect's failure wrapper; in every bundle of @xstate/effect (3 times), which
//                    also pulls in the Effect runtime.
//   "api.stripe.com" and "Stripe-Version"
//                    the Stripe SDK's API host and its version header. Stripe is a server package: browser code never
//                    holds a Stripe client, so either string in a browser script means the SDK was bundled.
//   "$ZodType"       the base class of Zod v4 (`zod`, the package; the Zod v3 that `astro/zod` ships has no such name). Zod v4
//                    is a server validator and does not reach the browser.
const RUNTIME_MARKERS = [
	"~effect/",
	"EffectFailure",
	"api.stripe.com",
	"Stripe-Version",
	"$ZodType",
] as const;

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

/** The markers a chunk's text holds. */
function markersIn(text: string): string[] {
	return RUNTIME_MARKERS.filter((marker) => text.includes(marker));
}

describe("the markers", () => {
	it("find each runtime and nothing in plain code", () => {
		expect(markersIn('var a="~effect/Cause";')).toEqual(["~effect/"]);
		expect(markersIn('var a="~effect/Option",b="~effect/Equal";')).toEqual([
			"~effect/",
		]);
		expect(markersIn('x={_tag:"EffectFailure"}')).toEqual(["EffectFailure"]);
		expect(markersIn('fetch("https://api.stripe.com/v1/invoices")')).toEqual([
			"api.stripe.com",
		]);
		expect(markersIn('h={"Stripe-Version":"2026"}')).toEqual([
			"Stripe-Version",
		]);
		expect(markersIn("class a extends $ZodType{}")).toEqual(["$ZodType"]);
		expect(markersIn("const a = document.title;")).toEqual([]);
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
			? "holds no Effect, @xstate/effect, Stripe or Zod v4 runtime code"
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
		packages: ["zod"],
		virtualModules: [] as readonly string[],
	};

	const base = [
		"src/scripts/a.ts",
		"src/lib/ok.ts",
		"npm:zod@3.25.76/v3/types.js",
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
				manifest(["src/scripts/a.ts", "npm:zod@3.25.76/v3/types.js"]),
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
		).toEqual(["reviewed package no longer in browser code, remove it: zod"]);
	});

	it("flags Effect, its scoped packages and xstate", () => {
		const wide = {
			...allowed,
			packages: [
				"zod",
				"effect",
				"@effect/platform",
				"@xstate/effect",
				"xstate",
			],
		};

		expect(
			bundleViolations(
				manifest([
					...base,
					"npm:effect@4.0.0/dist/Schema.js",
					"npm:@effect/platform@4.0.0/index.js",
					"npm:@xstate/effect@1.0.0/dist/a.js",
					"npm:xstate@5.0.0/dist/b.js",
				]),
				wide,
			).length,
		).toBe(4);
	});

	it("tells the Zod versions apart by each module's own version, in either order", () => {
		const v3 = "npm:zod@3.25.76/v3/types.js";
		const v4 = "npm:zod@4.6.5/v4/core/core.js";

		expect(
			bundleViolations(
				manifest(["src/scripts/a.ts", "src/lib/ok.ts", v3]),
				allowed,
			),
		).toEqual([]);
		expect(
			bundleViolations(
				manifest(["src/scripts/a.ts", "src/lib/ok.ts", v4]),
				allowed,
			),
		).toEqual(["forbidden package in browser code: zod@4.6.5"]);

		for (const order of [
			[v3, v4],
			[v4, v3],
		])
			expect(
				bundleViolations(
					manifest(["src/scripts/a.ts", "src/lib/ok.ts", ...order]),
					allowed,
				),
			).toEqual(["forbidden package in browser code: zod@4.6.5"]);

		// Mixed across chunks, and folded in as an unrendered module.
		expect(
			bundleViolations(
				{
					version: 2,
					chunks: [chunk("src/scripts/a.ts", "src/lib/ok.ts", v3), chunk(v4)],
					unrendered: [],
				},
				allowed,
			),
		).toEqual(["forbidden package in browser code: zod@4.6.5"]);
		expect(
			bundleViolations(manifest(base, { unrendered: [v4] }), allowed),
		).toEqual(["forbidden package in browser code: zod@4.6.5"]);
	});

	it("treats a Zod module whose label carries no version as forbidden", () => {
		expect(
			bundleViolations(manifest([...base, "npm:zod/v3/errors.js"]), allowed),
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

	it("flags Effect even when its package is listed, until a reviewed prefix allows it", () => {
		// ALLOWED_FORBIDDEN_PREFIXES is empty today, so Effect is always flagged; see client-manifest.ts for the one-line change.
		expect(
			bundleViolations(manifest([...base, "npm:effect@4.0.0/dist/Schema.js"]), {
				...allowed,
				packages: ["zod", "effect"],
			}),
		).toEqual(["forbidden package in browser code: effect@4.0.0"]);
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
