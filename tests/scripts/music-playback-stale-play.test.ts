import { afterEach, expect, it, vi } from "vitest";
import { setupMusicPlayback } from "~/scripts/music-playback";

// The coordinator pauses every other player when one starts. A play event arrives as a task, so an element can be paused
// again before its play event is heard: an A/B switch while the comparison streams starts B and then A at once.

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A media element as the coordinator reads it. */
class StandInMedia extends EventTarget {
	paused = true;
	seeking = false;
	muted = false;
	volume = 1;
	playbackRate = 1;
	duration = 160;
	currentTime = 0;
	tagName = "AUDIO";
	dataset = {};
	pause = vi.fn(() => {
		this.paused = true;
	});
}

it("pauses other players only for an element that is still playing when its play event arrives", () => {
	const first = new StandInMedia(),
		second = new StandInMedia();

	vi.stubGlobal("document", {
		querySelectorAll: (selector: string) =>
			selector === "audio,video" ? [first, second] : [],
	});
	setupMusicPlayback();

	// The second element's play event arrives after it was paused again: the first keeps playing.
	first.paused = false;
	second.dispatchEvent(new Event("play"));
	expect(first.pause).not.toHaveBeenCalled();

	second.paused = false;
	second.dispatchEvent(new Event("play"));
	expect(first.pause).toHaveBeenCalledTimes(1);
});
