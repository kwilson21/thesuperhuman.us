import { expect, it } from "vitest";
import { latestSongWaveform } from "~/lib/latest-song";
import type { MusicCatalog } from "~/lib/music-catalog";

/** A catalog of releases (id, status, date, its one recording) and the comparisons that carry waveforms. */
function catalog(
	releases: [string, "preview" | "released", string | undefined][],
	waveforms: Record<string, number[]>,
): MusicCatalog {
	return {
		recordings: [],
		releases: releases.map(([id, status, date]) => ({
			id,
			slug: id,
			title: id,
			artist: "Kazon",
			type: "single",
			status,
			visibility: "public",
			artwork: `/music/${id}.webp`,
			date,
			tracks: [`${id}-recording`],
		})),
		examples: Object.entries(waveforms).map(([id, after]) => ({
			id: `${id}-mastering`,
			recordingId: `${id}-recording`,
			visibility: "public",
			service: "mastering",
			summary: "Mastered.",
			before: "mix",
			after: "master",
			alignment: { before: 0, after: 0 },
			waveforms: { before: after.map((peak) => peak / 2), after },
		})),
	};
}

it("draws the newest released song's final version", () => {
	expect(
		latestSongWaveform(
			catalog(
				[
					["old-news", "released", "2026-09-16"],
					["new-song", "released", "2026-11-01"],
				],
				{ "old-news": [0.2, 0.4], "new-song": [0.6, 0.8] },
			),
		),
	).toEqual([0.6, 0.8]);
});

it("passes over a preview, and a newer release without a waveform", () => {
	expect(
		latestSongWaveform(
			catalog(
				[
					["old-news", "released", "2026-09-16"],
					["no-ab", "released", "2026-10-01"],
					["teaser", "preview", "2026-12-01"],
				],
				{ "old-news": [0.2, 0.4], teaser: [0.9, 0.9] },
			),
		),
	).toEqual([0.2, 0.4]);
});

it("leaves the edge to its drawn phrase when no released song has a waveform", () => {
	expect(
		latestSongWaveform(catalog([["no-ab", "released", "2026-10-01"]], {})),
	).toBeUndefined();
});
