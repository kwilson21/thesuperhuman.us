import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setUpMusicPreview } from "../../scripts/music-preview.mjs";

const dispose = vi.fn();

const spawnSync = vi.fn((..._args: unknown[]) => ({
	status: 0,
	stdout: "",
	stderr: "",
}));

const getPlatformProxy = async () => ({
	env: {
		MUSIC_DB: {
			prepare: () => ({ first: async () => ({ name: "owner_requests" }) }),
		},
		AUDIO: {},
	},
	dispose,
});

it("sets up an empty checkout without any imported music assets", async () => {
	const root = await mkdtemp(join(tmpdir(), "music-preview-"));
	const cwd = process.cwd();

	try {
		await mkdir(join(root, "db"));
		await writeFile(join(root, "db/music.sql"), "CREATE TABLE demo (id TEXT);");
		process.chdir(root);
		await setUpMusicPreview({ spawnSync, getPlatformProxy });
		expect(
			(await stat(join(root, ".private/music-assets"))).isDirectory(),
		).toBe(true);
		expect(spawnSync).toHaveBeenCalledOnce();
		const args = spawnSync.mock.calls[0]?.[1];

		if (!Array.isArray(args))
			throw new Error("spawnSync was called without an argument array.");
		expect(args.slice(1, 6)).toEqual([
			"d1",
			"migrations",
			"apply",
			"MUSIC_DB",
			"--local",
		]);
		expect(args[args.indexOf("--persist-to") + 1]).toMatch(
			/\/\.wrangler\/state$/,
		);
		expect(dispose).toHaveBeenCalledOnce();
	} finally {
		process.chdir(cwd);
		await rm(root, { recursive: true, force: true });
	}
});
