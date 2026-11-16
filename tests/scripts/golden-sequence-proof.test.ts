import { describe, expect, it } from "vitest";
import { allowed } from "../../scripts/golden-sequence-proof.mjs";

describe("the counter-row proof", () => {
	it.each([
		".steps[0].digest.music",
		".steps[0].digest.atResponse.music",
		".effects[2].state.music",
		".finalState.music.sha256",
		".finalState.music.tables.sqlite_sequence.rows",
		".finalState.music.tables.sqlite_sequence.sha256",
	])("allows a digest path (%s)", (path) => {
		expect(allowed(path)).toBe(true);
	});

	it.each([
		".steps[0].response.body",
		".steps[0].dump.music.audio_project_messages",
		".effects[2].sql",
		".finalState.music.tables.audio_project_messages.sha256",
	])("refuses any other path (%s)", (path) => {
		expect(allowed(path)).toBe(false);
	});
});
