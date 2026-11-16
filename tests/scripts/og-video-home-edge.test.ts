import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resamplePeaks } from "~/lib/home-motion";
import { latestSongWaveform } from "~/lib/latest-song";
import { validateCatalog, visibleCatalog } from "~/lib/music-catalog";

// Home's link-preview video (scripts/og-video/scenes/home.html) keeps a copy of the peaks Home's waveform edge draws:
// the newest released song's waveform at 110 bars (src/pages/index.astro). When a newer song with a comparison is
// released, Home's edge changes, so this fails and names the scene to update and re-render
// (node scripts/og-video/render.mjs home).
const entries = (dir: string) =>
	readdirSync(join("src/content", dir))
		.filter((file) => file.endsWith(".json"))
		.map((file) =>
			JSON.parse(readFileSync(join("src/content", dir, file), "utf8")),
		);

it("draws the same waveform as Home's edge in Home's link preview", () => {
	// Production's view of the catalog: public entries only.
	const catalog = visibleCatalog(
		validateCatalog({
			recordings: entries("recordings"),
			releases: entries("releases"),
			examples: entries("audio-examples"),
		}),
		false,
	);

	const waveform = latestSongWaveform(catalog);

	expect(waveform, "Home's edge draws a released song").toBeDefined();

	const scene = readFileSync("scripts/og-video/scenes/home.html", "utf8");
	const pasted = scene.match(/const songPeaks = \[([^\]]*)\];/)?.[1];

	expect(pasted, "home.html declares songPeaks").toBeDefined();
	expect(
		pasted,
		"scripts/og-video/scenes/home.html: update songPeaks and re-render the home scene",
	).toBe(resamplePeaks(waveform ?? [], 110).join(","));
});
