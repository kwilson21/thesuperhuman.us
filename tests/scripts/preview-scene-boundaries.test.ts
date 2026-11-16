import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyArtifact,
	deriveSheet,
	posterDimensions,
	inspectArtifact,
	boundedRead,
} from "../../scripts/og-video/publish.mjs";
import { sceneInventory } from "../../scripts/og-video/review-required.mjs";

const row = (name: string, mode = "100644") =>
	`${mode} blob ${"a".repeat(40)}\tscripts/og-video/scenes/${name}.html\0`;

describe("candidate scene inventory is bounded Git data", () => {
	it("adds exact committed scene names to the trusted required set", () => {
		expect(sceneInventory(["home"], row("home") + row("new-scene"))).toEqual([
			"home",
			"new-scene",
		]);
	});
	it("authenticates removals from the committed candidate inventory", () => {
		expect(sceneInventory(["home", "about"], row("home"))).toEqual(["home"]);
	});
	it("rejects symlinks, nested names, traversal, submodules and excessive inventories", () => {
		for (const bad of [
			row("new", "120000"),
			row("nested/new"),
			row("../escape"),
			row("UPPER"),
			`160000 commit ${"a".repeat(40)}\tscripts/og-video/scenes/new\0`,
			Array.from({ length: 33 }, (_, i) => row(`scene-${i}`)).join(""),
		])
			expect(() => sceneInventory(["home"], bad)).toThrow(/inventory/);
	});
	it("reads committed names without executing candidate HTML", () => {
		const root = mkdtempSync(join(tmpdir(), "preview-inventory-"));

		try {
			mkdirSync(join(root, "scripts/og-video/scenes"), { recursive: true });
			writeFileSync(
				join(root, "scripts/og-video/scenes/new.html"),
				"<script>throw new Error('must never execute')</script>",
			);
			execFileSync("git", ["init", "-q"], { cwd: root });
			execFileSync("git", ["add", "."], { cwd: root });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Test",
					"-c",
					"user.email=test@example.com",
					"commit",
					"-qm",
					"fixture",
				],
				{ cwd: root },
			);
			writeFileSync(
				join(root, "scripts/og-video/scenes/uncommitted.html"),
				"not authenticated",
			);

			const tree = execFileSync(
				"git",
				["ls-tree", "-r", "-z", "HEAD", "--", "scripts/og-video/scenes"],
				{ cwd: root, encoding: "utf8" },
			);

			expect(sceneInventory(["home"], tree)).toEqual(["new"]);
			const output = join(root, "outputs");
			execFileSync(
				process.execPath,
				["scripts/og-video/review-required.mjs", root],
				{
					env: { ...process.env, HAS_ARTIFACT: "true", GITHUB_OUTPUT: output },
				},
			);
			expect(readFileSync(output, "utf8")).toContain("scenes=new\n");
			expect(readFileSync(output, "utf8")).toMatch(/removed=.*home/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const video = Buffer.from("\0\0\0\x20ftypisom");

const hash = (bytes: Buffer) =>
	createHash("sha256").update(bytes).digest("hex").slice(0, 10);

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "preview-new-scene-"));
	const target = join(root, "target");
	const incoming = join(root, "incoming");

	const put = (base: string, path: string, bytes: string | Buffer) => {
		mkdirSync(join(base, path, ".."), { recursive: true });
		writeFileSync(join(base, path), bytes);
	};

	const manifest = Object.fromEntries(
		["home", "new-scene"].map((name) => [
			name,
			{
				image: `/og/${name}-${hash(png)}.png`,
				video: `/og/${name}-${hash(video)}.mp4`,
				width: 1200,
				height: 630,
				durationMs: 6000,
				imageBytes: png.length,
				videoBytes: video.length,
				frames: "a".repeat(16),
				source: "b".repeat(16),
				encoding: "c".repeat(16),
				inputs: [],
			},
		]),
	);

	for (const [name, entry] of Object.entries(manifest)) {
		put(
			target,
			`scripts/og-video/scenes/${name}.html`,
			"<script>throw new Error('never execute')</script>",
		);
		put(target, `public${entry.image}`, png);
		put(target, `public${entry.video.replace("/og/", "/og/raw/")}`, video);
	}

	put(target, "src/data/og-media.json", JSON.stringify(manifest));
	put(
		target,
		"docs/asset-reviews/link-previews.md",
		'# previews\n\n- ready\n\n## scenes\n\n```json\n{"files": []}\n```\n',
	);
	put(
		incoming,
		"changes.json",
		JSON.stringify({ scenes: ["home", "new-scene"], deleted: [] }),
	);
	const seen: string[] = [];

	const apply = (required = "home new-scene", removed = "") =>
		applyArtifact(
			{
				INCOMING: incoming,
				TARGET: target,
				SHEETS_OUT: join(root, "sheets"),
				PR_NUMBER: "213",
				RUN_ID: "123",
				REQUIRED_SCENES: required,
				REMOVED_SCENES: removed,
			},
			(path: string) => {
				seen.push(path);

				return png;
			},
		);

	return { root, target, incoming, put, apply, seen };
}

describe("new scenes require complete independent sheet evidence", () => {
	it("accepts a bounded authenticated addition and derives its sheet", () => {
		const f = fixture();

		try {
			expect(f.apply()).toEqual(["home", "new-scene"]);
			expect(f.seen).toHaveLength(2);
			expect(readFileSync(join(f.root, "sheets/new-scene-sheet.png"))).toEqual(
				png,
			);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("rejects unauthenticated extra scenes and omissions", () => {
		const f = fixture();

		try {
			expect(() => f.apply("home")).toThrow(/Invalid scenes/);
			f.put(
				f.incoming,
				"changes.json",
				JSON.stringify({ scenes: ["home"], deleted: [] }),
			);
			expect(() => f.apply()).toThrow(/omits scenes/);
			expect(f.seen).toHaveLength(0);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("rejects symlinked candidate scene source", () => {
		const f = fixture();

		try {
			const path = join(f.target, "scripts/og-video/scenes/new-scene.html");
			rmSync(path);
			symlinkSync("home.html", path);
			expect(() => f.apply()).toThrow(/Symbolic/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

describe("source poster dimensions cannot be disguised by sheet scaling", () => {
	const stream = {
		codec_type: "video",
		codec_name: "png",
		width: 1200,
		height: 630,
	};

	it("accepts only a single correctly sized PNG or JPEG stream", () => {
		expect(() => posterDimensions({ streams: [stream] })).not.toThrow();
		expect(() =>
			posterDimensions({ streams: [{ ...stream, codec_name: "mjpeg" }] }),
		).not.toThrow();

		for (const invalid of [
			{ width: 1, height: 1 },
			{ width: 630, height: 1200 },
			{ codec_name: "h264" },
			{ codec_type: "audio" },
		])
			expect(() =>
				posterDimensions({ streams: [{ ...stream, ...invalid }] }),
			).toThrow(/poster/);
		expect(() => posterDimensions({ streams: [stream, stream] })).toThrow(
			/poster/,
		);
	});
	it.skipIf(spawnSync("ffprobe", ["-version"]).status !== 0)(
		"probes real malformed-size PNG bytes before invoking sheet generation",
		() => {
			const root = mkdtempSync(join(tmpdir(), "poster-dimensions-"));

			try {
				const image = join(root, "one.png");
				writeFileSync(
					image,
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUO0AAAAASUVORK5CYII=",
						"base64",
					),
				);
				expect(() =>
					deriveSheet(join(root, "not-a-video.mp4"), 6000, image),
				).toThrow(/poster dimensions/);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);
});

describe("bounded artifact inputs and authenticated removals", () => {
	it("removes only authenticated absent scenes without requiring deleted media to render", () => {
		const f = fixture();

		try {
			rmSync(join(f.target, "scripts/og-video/scenes/new-scene.html"));
			f.put(
				f.incoming,
				"changes.json",
				JSON.stringify({ scenes: ["home"], deleted: [] }),
			);
			expect(f.apply("home", "new-scene")).toEqual(["home"]);

			const manifest = JSON.parse(
				readFileSync(join(f.target, "src/data/og-media.json"), "utf8"),
			);

			expect(Object.keys(manifest)).toEqual(["home"]);
			expect(f.seen).toHaveLength(1);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("rejects removals while committed source still exists", () => {
		const f = fixture();

		try {
			expect(() => f.apply("home", "new-scene")).toThrow(/removals/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("rejects oversized metadata and media before decoding or reading", () => {
		const f = fixture();

		try {
			f.put(f.incoming, "changes.json", Buffer.alloc(65537));
			expect(() => inspectArtifact(f.incoming)).toThrow(/oversized/);
			expect(() =>
				boundedRead(join(f.incoming, "changes.json"), 65536),
			).toThrow(/oversized/);
			f.put(f.incoming, "changes.json", "{}");
			f.put(
				f.incoming,
				"files/public/og/home-aaaaaaaaaa.png",
				Buffer.alloc(600 * 1024 + 1),
			);
			expect(() => inspectArtifact(f.incoming)).toThrow(/oversized/);
			expect(f.seen).toHaveLength(0);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("rejects aggregate artifact size even when each file is within its bound", () => {
		const f = fixture();

		try {
			for (let i = 0; i < 41; i++)
				f.put(
					f.incoming,
					`files/public/og/raw/scene-${i}-aaaaaaaaaa.mp4`,
					Buffer.alloc(2.5 * 1024 * 1024),
				);
			expect(() => inspectArtifact(f.incoming)).toThrow(/Aggregate/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

it("does not use a removed candidate entry to delete arbitrary public files", () => {
	const f = fixture();

	try {
		const before = JSON.parse(
			readFileSync(join(f.target, "src/data/og-media.json"), "utf8"),
		);

		const after = { home: before.home };
		before["new-scene"].image = "/unrelated.txt";
		f.put(f.target, "src/data/og-media.json", JSON.stringify(before));
		f.put(f.target, "public/unrelated.txt", "preserve");
		f.put(f.incoming, "files/src/data/og-media.json", JSON.stringify(after));
		rmSync(join(f.target, "scripts/og-video/scenes/new-scene.html"));
		f.put(
			f.incoming,
			"changes.json",
			JSON.stringify({ scenes: ["home"], deleted: [] }),
		);
		expect(() => f.apply("home", "new-scene")).toThrow(/Original manifest/);
		expect(readFileSync(join(f.target, "public/unrelated.txt"), "utf8")).toBe(
			"preserve",
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

it("watches preview routing consistently", () => {
	for (const path of [
		".github/workflows/link-previews.yml",
		"scripts/og-video/review-required.mjs",
		"scripts/og-video/finalize-validation.mjs",
	])
		expect(readFileSync(path, "utf8")).toContain("src/lib/og-media.ts");
});
