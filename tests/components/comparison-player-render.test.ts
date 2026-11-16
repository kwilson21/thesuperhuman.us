import { afterAll, beforeAll, expect, it } from "vitest";
import type { MusicCatalog, Recording } from "~/lib/music-catalog";
import { bundleAstro } from "../helpers/render-astro";

// The comparison player as the server renders it, before any script runs.

let bundle: Awaited<ReturnType<typeof bundleAstro>>;

beforeAll(async () => {
	bundle = await bundleAstro({
		player: "src/components/audio/ComparisonPlayer.astro",
	});
}, 60_000);

afterAll(() => bundle?.remove());

const example: MusicCatalog["examples"][number] = {
	id: "old-news-mastering",
	recordingId: "old-news-recording",
	visibility: "public",
	service: "mastering",
	summary: "Mastered by Kazon.",
	before: "mix",
	after: "master",
	alignment: { before: 0.05, after: 0 },
	loudness: { before: -12.23, after: -9.73 },
	waveforms: { before: [0.2, 0.6], after: [0.3, 0.7] },
};

const recording: Recording = {
	id: "old-news-recording",
	title: "Old News",
	artist: "Kazon Wilson",
	duration: 160,
	visibility: "public",
	credits: [],
	services: [],
	versions: {
		mix: { key: "music/old-news/mix.mp3", type: "audio/mpeg" },
		master: { key: "music/old-news/master.mp3", type: "audio/mpeg" },
	},
};

it("gives each version of the full player a loudness meter, drawn from its measured loudness", async () => {
	const html = await bundle.render("player", { props: { example, recording } });

	const meters = [
		...html.matchAll(
			/<p class="lane-meter[^"]*"[^>]*style="--meter:([\d.]+)"[^>]*>.*?<span data-lane-meter-value[^>]*>([^<]+)<\/span><\/p>/g,
		),
	];

	expect(meters.map(([, share, line]) => [Number(share), line])).toEqual([
		[(20 - 12.23) / 14, "−12.2 LUFS"],
		[(20 - 9.73) / 14, "−9.7 LUFS"],
	]);
});

it("keeps the compact Home player without meters", async () => {
	const html = await bundle.render("player", {
		props: { example, recording, compact: true },
	});

	expect(html).not.toContain("data-lane-meter");
});
