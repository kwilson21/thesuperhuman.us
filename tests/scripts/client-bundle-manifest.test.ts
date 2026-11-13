import { describe, expect, it } from "vitest";
import {
	chunkEntry,
	manifestFromChunks,
	moduleLabel,
	settleChunks,
	unrenderedModules,
} from "../../scripts/client-bundle-manifest.mjs";

const root = "/work/site";

const pnpm = (directory: string, name: string, path: string) =>
	`${root}/node_modules/.pnpm/${directory}/node_modules/${name}/${path}`;

describe("moduleLabel", () => {
	it("makes a repository file root-relative and drops the query", () => {
		expect(moduleLabel(`${root}/src/scripts/a.ts`, root)).toBe(
			"src/scripts/a.ts",
		);
		expect(
			moduleLabel(
				`${root}/src/pages/about.astro?astro&type=script&index=0&lang.ts`,
				root,
			),
		).toBe("src/pages/about.astro");
		expect(moduleLabel(`${root}/src/data/x.json?raw`, root)).toBe(
			"src/data/x.json",
		);
	});

	it("names an installed package through pnpm's layout, scoped or not", () => {
		expect(
			moduleLabel(pnpm("stripe@1.0.0", "stripe", "esm/index.js"), root),
		).toBe("npm:stripe/esm/index.js");
		expect(
			moduleLabel(
				pnpm("@effect+schema@1.0.0", "@effect/schema", "dist/a.js"),
				root,
			),
		).toBe("npm:@effect/schema/dist/a.js");
		expect(moduleLabel(`${root}/node_modules/events/events.js`, root)).toBe(
			"npm:events/events.js",
		);
	});

	it("carries the installed version of that very package directory", () => {
		const v = (directory: string) =>
			({
				[`${root}/node_modules/.pnpm/zod@3.25.76/node_modules/zod`]: "3.25.76",
				[`${root}/node_modules/.pnpm/zod@4.6.5/node_modules/zod`]: "4.6.5",
				[`${root}/node_modules/.pnpm/@effect+x@1.2.3/node_modules/@effect/x`]:
					"1.2.3",
			})[directory];

		expect(
			moduleLabel(pnpm("zod@3.25.76", "zod", "v3/types.js"), root, v),
		).toBe("npm:zod@3.25.76/v3/types.js");
		expect(moduleLabel(pnpm("zod@4.6.5", "zod", "v3/types.js"), root, v)).toBe(
			"npm:zod@4.6.5/v3/types.js",
		);
		expect(
			moduleLabel(pnpm("@effect+x@1.2.3", "@effect/x", "dist/a.js"), root, v),
		).toBe("npm:@effect/x@1.2.3/dist/a.js");
	});

	it("uses the innermost node_modules, so a nested dependency names its own package", () => {
		expect(
			moduleLabel(
				`${root}/node_modules/.pnpm/a@1/node_modules/a/node_modules/b/index.js`,
				root,
			),
		).toBe("npm:b/index.js");
	});

	it("keeps a virtual module by its id and marks a file outside the repository", () => {
		expect(moduleLabel("\0vite/preload-helper.js", root)).toBe(
			"\0vite/preload-helper.js",
		);
		expect(moduleLabel("astro:env/client", root)).toBe("astro:env/client");
		expect(moduleLabel("/elsewhere/lib.js", root)).toBe(
			"outside:/elsewhere/lib.js",
		);
	});

	it("does not mistake a sibling directory for the repository", () => {
		expect(moduleLabel("/work/site-other/a.ts", root)).toBe(
			"outside:/work/site-other/a.ts",
		);
	});
});

describe("chunkEntry", () => {
	it("lists sorted unique module labels with a hash of the code and of the trimmed code", () => {
		const entry = chunkEntry(
			"_astro/a.js",
			{
				code: "console.log(1)\n",
				modules: {
					[`${root}/src/b.ts`]: {},
					[`${root}/src/a.ts`]: {},
					[`${root}/src/a.ts?raw`]: {},
				},
			},
			root,
		);

		expect(entry.modules).toEqual(["src/a.ts", "src/b.ts"]);
		expect(entry.file).toBe("_astro/a.js");
		expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(entry.trimmedSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(entry.trimmedSha256).not.toBe(entry.sha256);
		expect(
			chunkEntry("x", { code: "console.log(1)", modules: {} }, root)
				.trimmedSha256,
		).toBe(entry.trimmedSha256);
	});
});

describe("manifestFromChunks", () => {
	it("is sorted by file so the same build writes the same text", () => {
		const a = {
			file: "_astro/a.js",
			sha256: "1",
			trimmedSha256: "1",
			modules: [],
		};
		const b = {
			file: "_astro/b.js",
			sha256: "2",
			trimmedSha256: "2",
			modules: [],
		};

		expect(manifestFromChunks([b, a])).toEqual(manifestFromChunks([a, b]));
		expect(manifestFromChunks([b, a]).chunks.map((c) => c.file)).toEqual([
			"_astro/a.js",
			"_astro/b.js",
		]);
	});

	it("carries the unrendered modules next to the chunks", () => {
		expect(manifestFromChunks([], ["src/data/folded.json"]).unrendered).toEqual(
			["src/data/folded.json"],
		);
	});
});

describe("unrenderedModules", () => {
	it("lists included modules that no chunk renders, as sorted labels, and skips what the bundle dropped", () => {
		const rendered = [{ modules: { [`${root}/src/a.ts`]: {} } }];

		const infos = new Map([
			[`${root}/src/a.ts`, { isIncluded: true }],
			[`${root}/src/data/folded.json`, { isIncluded: true }],
			[`${root}/src/data/unused.json`, { isIncluded: false }],
			[`${root}/node_modules/p/i.js`, { isIncluded: true }],
		]);

		expect(unrenderedModules(rendered, infos, root)).toEqual([
			"npm:p/i.js",
			"src/data/folded.json",
		]);
	});
});

describe("settleChunks", () => {
	it("takes the hashes from the code that was written, and keeps those of a chunk that was inlined", () => {
		const written = chunkEntry(
			"_astro/a.js",
			{ code: "before preload map", modules: {} },
			root,
		);

		const inlined = chunkEntry(
			"_astro/b.js",
			{ code: "inlined code", modules: {} },
			root,
		);

		const settled = settleChunks([written, inlined], {
			"_astro/a.js": { type: "chunk", code: "after preload map\n" },
			"_astro/style.css": { type: "asset" },
		});

		expect(settled[0].sha256).not.toBe(written.sha256);
		expect(settled[0].trimmedSha256).toBe(
			chunkEntry("x", { code: "after preload map", modules: {} }, root)
				.trimmedSha256,
		);
		expect(settled[1]).toEqual(inlined);
	});
});
