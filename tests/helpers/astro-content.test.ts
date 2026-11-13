import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCollection, getEntry } from "astro:content";
import { loadMusicCatalog } from "~/lib/music-content";
import * as stand from "./astro-content";

// The `astro:content` import is a virtual module that only Astro's build provides. Vitest resolves it to
// tests/helpers/astro-content.ts, which reads the real collections from src/content, so a test sees the real catalog.

const files = (name: string) =>
	readdirSync(new URL(`../../src/content/${name}`, import.meta.url)).filter(
		(file) => file.endsWith(".json"),
	);

describe("astro:content in tests", () => {
	it("getCollection returns every entry of a data collection, with its id and parsed data", async () => {
		const recordings = await getCollection("recordings");

		expect(recordings.map((entry) => `${entry.id}.json`).sort()).toEqual(
			files("recordings").sort(),
		);

		expect(recordings[0]?.collection).toBe("recordings");
		expect(recordings[0]?.data.id).toEqual(expect.any(String));
	});

	it("getCollection filters with the callback, and getEntry finds one entry or nothing", async () => {
		const all = await getCollection("recordings");
		const first = all[0];

		expect(
			await getCollection("recordings", (entry) => entry.id === first?.id),
		).toHaveLength(1);

		expect((await getEntry("recordings", first?.id ?? ""))?.id).toBe(first?.id);
		expect(await getEntry("recordings", "nobody")).toBeUndefined();
	});

	it("names a collection that does not exist", async () => {
		await expect(stand.getCollection("not-a-collection")).rejects.toThrow(
			/not-a-collection/,
		);
	});

	it("reads the markdown collections' front matter", async () => {
		const pages = await getCollection("pages");

		expect(pages.length).toBeGreaterThan(0);
		expect(pages[0]?.data.title).toEqual(expect.any(String));
		expect(pages[0]?.body).toEqual(expect.any(String));
	});

	it("serves the real music catalog to music-content", async () => {
		const catalog = await loadMusicCatalog(true);

		expect(catalog.recordings.map((recording) => recording.id)).toContain(
			"old-news-recording",
		);
	});
});
