import { afterEach, describe, expect, it } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	buildNavigationInventory,
	classifyPage,
	hasStaticOutput,
} from "../../scripts/navigation-inventory.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true });
});

describe("central navigation inventory", () => {
	it("classifies every current route and keeps the shipped inventory fresh", () => {
		const result = buildNavigationInventory();
		expect(result.inventory).toEqual(
			JSON.parse(
				readFileSync(
					new URL("../../src/data/navigation-inventory.json", import.meta.url),
					"utf8",
				),
			),
		);
		expect(result.classifications["agreements.astro"]).toBe("private");
		expect(result.classifications["building/threadline.astro"]).toBe(
			"no-store",
		);
		expect(result.inventory.sources).toContain("/audio/start");
		expect(result.inventory.targets).not.toContain("/audio/start");
	});
	it("automatically includes real new static content while rejecting unreviewed server routes", () => {
		expect(
			classifyPage(
				"writing/new-essay.astro",
				"---\nconst title = 'New';\n---\n<h1>{title}</h1>",
			),
		).toBe("public");
		expect(
			classifyPage(
				"new-static.astro",
				"---\nexport const prerender = true;\n---\n<h1>New</h1>",
			),
		).toBe("public");

		for (const source of [
			"export const prerender = false;",
			"export const prerender = configured;",
			"export { mode as prerender };",
			"export * from './mode';",
			"export const {prerender} = config;",
		])
			expect(() =>
				classifyPage("future.astro", `---\n${source}\n---\n`),
			).toThrow("Classify navigation safety");
		expect(() =>
			classifyPage("essay.mdx", "# Essay\nexport const prerender = false;"),
		).toThrow("Classify navigation safety");
		expect(() => classifyPage("news/[slug].astro", "")).toThrow(
			"Classify navigation safety",
		);
	});
	it("reserves private and endpoint namespaces before static inference", () => {
		for (const path of [
			"owner/new.astro",
			"studio/new.astro",
			"offer/new.astro",
			"agreements.astro",
			"agreements.md",
		])
			expect(classifyPage(path, "")).toBe("private");

		for (const path of [
			"api/new.ts",
			"audio/file/download.astro",
			"audio/file/[slug].ts",
			".well-known/[...path].ts",
		])
			expect(classifyPage(path, "")).toBe("endpoint");
		expect(classifyPage("audio/about.astro", "")).toBe("redirect");
		expect(() =>
			classifyPage("new.astro", "---\nreturn Astro.redirect('/work');\n---\n"),
		).toThrow("Review changed response semantics");
		expect(classifyPage("software/start.astro", "")).toBe("form");

		for (const marker of ["no-store", "Astro.cookies", "Astro.redirect"])
			expect(() => classifyPage("music/[slug].astro", marker)).toThrow(
				"Review changed response semantics",
			);
		expect(() =>
			classifyPage(
				"about.astro",
				'Astro.response.headers.set("Cache-Control", "no-store")',
			),
		).toThrow("Review changed response semantics");
	});
	it("reads Astro output structurally without evaluating config code", () => {
		expect(
			hasStaticOutput('export default defineConfig({output: "static"});'),
		).toBe(true);
		expect(
			hasStaticOutput(
				'// output: "static"\nexport default defineConfig({output: "server"});',
			),
		).toBe(false);
		expect(hasStaticOutput("export default configured;")).toBe(false);
		expect(
			hasStaticOutput(
				'export default defineConfig({output: "static", ...options});',
			),
		).toBe(false);
		expect(
			hasStaticOutput(
				'export default defineConfig({output: "static", output: "server"});',
			),
		).toBe(false);
	});
	it("generates only existing public music slugs and actual static pages", () => {
		const root = mkdtempSync(join(tmpdir(), "navigation-inventory-"));
		temporary.push(root);
		mkdirSync(join(root, "src/pages"), { recursive: true });
		mkdirSync(join(root, "src/content/releases"), { recursive: true });
		writeFileSync(
			join(root, "astro.config.mjs"),
			'export default defineConfig({output: "static"});',
		);
		writeFileSync(
			join(root, "src/pages/actual.astro"),
			"<h1>Actual static page</h1>",
		);

		for (const [slug, visibility] of [
			["published", "public"],
			["unreleased", "private"],
			["hidden", "hidden"],
		])
			writeFileSync(
				join(root, `src/content/releases/${slug}.json`),
				JSON.stringify({ slug, visibility }),
			);
		expect(buildNavigationInventory(root).inventory.targets).toEqual([
			"/actual",
		]);
		mkdirSync(join(root, "src/pages/music"));
		writeFileSync(join(root, "src/pages/music/[slug].astro"), "");
		expect(buildNavigationInventory(root).inventory.targets).toEqual([
			"/actual",
			"/music/published",
		]);
	});
});
