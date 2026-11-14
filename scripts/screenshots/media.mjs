// Waits for the studio's project players before a capture. Each player's time label should read
// "0:00 / <duration>" once its audio metadata has loaded.
//
// The site's player (src/scripts/project-player.ts) only renders the label from the `loadedmetadata` event. When
// the metadata loads before the script attaches its listener, the event has already passed and the label stays
// at "0:00". Nothing in the page then repeats the render until playback. This file does not change the site: once
// the metadata is loaded, it dispatches the same `loadedmetadata` event the page listens for, so the page's own
// render runs. A player with no source, or one that failed to load, is not waited for: its problem message is
// what the page shows.

/** Runs in the page: every player with a source and no error has loaded its metadata. Self-contained. */
export function metadataLoaded() {
	return [...document.querySelectorAll("[data-project-player]")].every(
		(player) => {
			const audio = player.querySelector("audio");

			if (!audio || !audio.src || audio.error) return true;

			return audio.readyState >= 1;
		},
	);
}

/**
 * Runs in the page: for each loaded player whose label does not show a duration yet, dispatches the
 * `loadedmetadata` event so the page's own listener renders the label. Self-contained.
 */
export function renderPlayers() {
	for (const player of document.querySelectorAll("[data-project-player]")) {
		const audio = player.querySelector("audio");
		const time = player.querySelector("[data-player-time]");

		if (!audio || !audio.src || audio.error || audio.readyState < 1) continue;

		if (time.textContent.includes("/")) continue;

		audio.dispatchEvent(new Event("loadedmetadata"));
	}
}

/**
 * Runs in the page: every project player has either no source, a failed load, or loaded metadata and a time
 * label that shows the duration. Self-contained, so Playwright can run it in the page.
 */
export function playersSettled() {
	return [...document.querySelectorAll("[data-project-player]")].every(
		(player) => {
			const audio = player.querySelector("audio");
			const time = player.querySelector("[data-player-time]");

			if (!audio || !audio.src || audio.error) return true;

			return audio.readyState >= 1 && time.textContent.includes("/");
		},
	);
}

/**
 * Waits until every project player on the page shows its duration (see the note at the top). A player whose
 * metadata never loads fails the capture with the wait's name in the message, so a half-loaded label cannot pass.
 */
export async function waitForPlayers(page, { timeout = 15_000 } = {}) {
	try {
		await page.waitForFunction(metadataLoaded, null, { timeout });
		await page.evaluate(renderPlayers);
		await page.waitForFunction(playersSettled, null, { timeout });
	} catch (error) {
		if (error?.name !== "TimeoutError") throw error;

		throw new Error(
			`The audio player metadata did not load within ${timeout} ms, so its duration label cannot be captured.`,
		);
	}
}
