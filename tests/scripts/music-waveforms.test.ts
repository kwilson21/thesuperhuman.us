import { expect, it, vi } from "vitest";
import { partial } from "../helpers/doubles";
import { deriveWaveforms } from "../../scripts/music-waveforms.mjs";

it("measures each aligned playback window for both waveform and loudness", async () => {
	const readFile = vi.fn<(path: string, encoding: "utf8") => Promise<string>>();
	const writeFile = vi.fn<(path: string, text: string) => Promise<void>>();
	const spawnSync =
		vi.fn<
			(
				command: string,
				args: string[],
				options: { maxBuffer: number },
			) => { status: number | null; stdout: Buffer; stderr: Buffer }
		>();
	readFile
		.mockResolvedValueOnce(
			JSON.stringify({
				recordingId: "song",
				before: "mix",
				after: "master",
				alignment: { before: 4, after: 2 },
			}),
		)
		.mockResolvedValueOnce(
			JSON.stringify({
				duration: 12,
				versions: { mix: { key: "mix.mp3" }, master: { key: "master.mp3" } },
			}),
		);
	spawnSync.mockImplementation((_command, args) =>
		partial<ReturnType<typeof spawnSync>>({
			status: 0,
			stdout: Buffer.alloc(640),
			stderr: Buffer.from(args?.includes("null") ? '{"input_i":"-18"}' : ""),
		}),
	);

	await deriveWaveforms("demo", { readFile, writeFile, spawnSync });
	const calls = spawnSync.mock.calls;
	expect(calls).toHaveLength(4);

	for (const [index, offset] of [4, 2].entries()) {
		for (const call of calls.slice(index * 2, index * 2 + 2)) {
			const args = call[1];

			if (!Array.isArray(args))
				throw new Error("spawnSync was called without an argument array.");
			expect(args[args.indexOf("-ss") + 1]).toBe(String(offset));
			expect(args[args.indexOf("-t") + 1]).toBe("12");
			expect(args[args.indexOf("-af") + 1]).toContain("atrim=duration=12");
		}
	}

	const output = JSON.parse(String(writeFile.mock.calls[0][1]));
	expect(output.loudness).toEqual({ before: -18, after: -18 });
});
