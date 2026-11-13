import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The command line entry of each script runs its work when called directly, even through a symlink, and not when
// imported. Each case runs the real entry in a child process in an empty directory.

const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "music-cli-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(script: string, args: string[], symlinked: boolean) {
	let entry = join(scripts, script);

	if (symlinked) {
		entry = join(scratch, `link-${script}`);
		symlinkSync(join(scripts, script), entry);
	}

	const result = spawnSync(process.execPath, [entry, ...args], {
		cwd: scratch,
		encoding: "utf8",
	});

	if (symlinked) rmSync(entry);

	return result;
}

describe.each([
	["directly", false],
	["through a symlink", true],
])("called %s", (_name, symlinked) => {
	it("music-waveforms refuses a missing or bad example id", () => {
		for (const args of [[], ["Bad_Id"]]) {
			const result = run("music-waveforms.mjs", args, symlinked);

			expect(result.status).toBe(1);

			expect(result.stderr).toContain(
				"Usage: node scripts/music-waveforms.mjs <example-id>",
			);
		}
	});

	it("music-preview reports that it could not apply the migrations", () => {
		const result = run("music-preview.mjs", [], symlinked);

		expect(result.status).toBe(1);

		expect(result.stderr).toContain(
			"Could not apply local music database migrations:",
		);
	});
});
