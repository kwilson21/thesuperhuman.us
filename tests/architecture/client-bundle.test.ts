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

// The independent backstop to client-graph.test.ts: that test walks the source's import graph, this one looks at what
// the build actually shipped. It reads every browser script under dist/ (dist/_astro/ and scripts copied from public/, not the server output dist/_worker.js/) and fails when a chunk holds Effect or @xstate/effect runtime
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
const RUNTIME_MARKERS = ["~effect/", "EffectFailure"] as const;

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
			? "holds no Effect or @xstate/effect runtime code"
			: "holds no Effect runtime code (skipped: no dist/, run pnpm run build first)",
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
