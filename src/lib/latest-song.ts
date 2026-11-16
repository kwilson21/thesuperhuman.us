// Home's waveform edge draws the newest released song (owner decision, 2026-11-15: "whatever the latest song I
// uploaded"). Its shape comes from that song's A/B comparison, the only place the catalog keeps a waveform.
import { type MusicCatalog, releasedNewestFirst } from "~/lib/music-catalog";

/**
 * The waveform of the newest released song that has one: the final version of its comparison (the master, or the
 * mix of a mixing example). A newer release without a comparison is passed over for the newest one with a waveform,
 * and with none the edge keeps its drawn phrase.
 */
export function latestSongWaveform(
	catalog: MusicCatalog,
): number[] | undefined {
	for (const release of releasedNewestFirst(catalog)) {
		const example = catalog.examples.find(
			(candidate) =>
				candidate.waveforms && release.tracks.includes(candidate.recordingId),
		);

		if (example?.waveforms) return example.waveforms.after;
	}

	return undefined;
}
