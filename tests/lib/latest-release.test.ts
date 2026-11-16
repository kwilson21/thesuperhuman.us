import { expect, it } from "vitest";
import { latestRelease, type MusicCatalog } from "~/lib/music-catalog";

/** A release as latestRelease reads it: its status and date. */
const release = (
	id: string,
	status: "preview" | "released",
	date?: string,
) => ({
	id,
	slug: id,
	title: id,
	artist: "Kazon",
	type: "single" as const,
	status,
	visibility: "public" as const,
	artwork: `/music/${id}.webp`,
	date,
	tracks: [`${id}-recording`],
});

const catalog = (releases: ReturnType<typeof release>[]): MusicCatalog => ({
	recordings: [],
	releases,
	examples: [],
});

it("picks the newest released song, skipping previews", () => {
	expect(
		latestRelease(
			catalog([
				release("old-news", "released", "2026-09-16"),
				release("next-single", "preview", "2026-12-01"),
				release("second-single", "released", "2026-11-02"),
			]),
		)?.id,
	).toBe("second-single");
});

it("has no newest song when nothing is released", () => {
	expect(latestRelease(catalog([release("next", "preview")]))).toBeUndefined();
});
