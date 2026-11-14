import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// The sign-in codes moved to audio_client_signin_codes. The old audio_client_codes table is dropped by a later migration,
// after the deploy that stops reading it (migration 0028, https://github.com/kwilson21/thesuperhuman.us/issues/271), so until then the code may only delete from it (retention and access closure).

const root = new URL("../../", import.meta.url).pathname;

function files(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);

		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

it("the application never reads or writes audio_client_codes except to delete a closed address's rows", () => {
	const uses = files(join(root, "src"))
		.filter((path) => /\.(ts|astro|mjs)$/.test(path))
		.flatMap((path) =>
			readFileSync(path, "utf8")
				.split("\n")
				.map((line, index) => ({ path: relative(root, path), index, line }))
				.filter(({ line }) => /\baudio_client_codes\b/.test(line)),
		);

	expect(uses.length).toBeGreaterThan(0);

	for (const { path, line } of uses)
		expect({ path, line: line.trim() }).toEqual({
			path: "src/lib/audio-client-access.ts",
			line: expect.stringMatching(
				/DELETE FROM audio_client_codes WHERE email=/,
			),
		});
});
