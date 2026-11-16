import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteTokens } from "../../scripts/og-video/site-tokens.mjs";
import { withFiles, withNote } from "../../scripts/og-video/record.mjs";
import { check, videoDuration } from "../../scripts/og-video/publish.mjs";

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

const hash = (bytes: Buffer) =>
	createHash("sha256").update(bytes).digest("hex").slice(0, 10);

const metadata = {
	width: 1200,
	height: 630,
	durationMs: 6000,
	imageBytes: 12,
	videoBytes: 12,
	frames: "0123456789abcdef",
	source: "0123456789abcdef",
	encoding: "0123456789abcdef",
};

describe("link-preview site tokens", () => {
	it("match src/styles/global.css (run node scripts/og-video/site-tokens.mjs)", () => {
		expect(readFileSync("scripts/og-video/site-tokens.css", "utf8")).toBe(
			siteTokens(readFileSync("src/styles/global.css", "utf8")),
		);
	});

	it("refuse a label face the scene kit does not load", () => {
		const css = readFileSync("src/styles/global.css", "utf8").replace(
			/(\.page-kicker \{ font-family: )var\(--font-sans\)/,
			"$1var(--font-display)",
		);

		expect(() => siteTokens(css)).toThrow(/face the kit does not load/);
	});
});

describe("link-preview asset record", () => {
	const record =
		'# Asset\n\n- one\n\n## home\n\n```json\n{\n  "outcome": "ready",\n  "files": [\n    {"path": "old"}\n  ]\n}\n```\n';

	it("adds a note at the end of the header list", () => {
		expect(withNote(record, "two")).toContain("- one\n- two\n\n## home");
		expect(() => withNote(record, "two\nthree")).toThrow();
	});

	it("lists every poster and video with its hash and size", () => {
		const manifest = {
			home: {
				image: "/og/home-0123456789.png",
				video: "/og/home-abcdef0123.mp4",
			},
		};

		const updated = withFiles(record, manifest, () => Buffer.from("x"));
		expect(updated).toContain('"path": "public/og/home-0123456789.png"');
		expect(updated).toContain('"path": "public/og/raw/home-abcdef0123.mp4"');
		expect(updated).toContain('"bytes": 1');
		expect(updated).not.toContain('"path": "old"');
	});
});

describe("link-preview publish checks", () => {
	it("accepts preview media at their paths", () => {
		expect(check(`public/og/home-${hash(PNG)}.png`, PNG)).toBeNull();
		expect(
			check(
				`public/og/raw/home-${hash(Buffer.from("\0\0\0\x20ftypisom"))}.mp4`,
				Buffer.from("\0\0\0\x20ftypisom"),
			),
		).toBeNull();
	});

	it("refuses other paths and mismatched contents", () => {
		expect(check("src/pages/index.astro", PNG)).toMatch(/may change/);
		expect(
			check("public/og/home-0123456789.png", Buffer.from("<svg/>")),
		).toMatch(/file type/);
		expect(check("public/og/raw/home-0123456789.mp4", PNG)).toMatch(/MP4/);
	});

	it("refuses a manifest with unexpected files or inputs", () => {
		const entry = {
			...metadata,
			image: "/og/home-0123456789.png",
			video: "/og/home-0123456789.mp4",
			inputs: ["scripts/og-video/kit.css"],
		};

		expect(
			check(
				"src/data/og-media.json",
				Buffer.from(JSON.stringify({ home: entry })),
			),
		).toBeNull();
		expect(
			check(
				"src/data/og-media.json",
				Buffer.from(
					JSON.stringify({ home: { ...entry, inputs: ["../secret"] } }),
				),
			),
		).toMatch(/inputs/);
		expect(
			check(
				"src/data/og-media.json",
				Buffer.from(
					JSON.stringify({ home: { ...entry, image: "/index.html" } }),
				),
			),
		).toMatch(/files/);
	});

	it("accepts only lines the token generator writes", () => {
		expect(
			check(
				"scripts/og-video/site-tokens.css",
				readFileSync("scripts/og-video/site-tokens.css"),
			),
		).toBeNull();
		expect(
			check(
				"scripts/og-video/site-tokens.css",
				Buffer.from(":root {\n  --paper: url(https://example.com/x);\n}\n"),
			),
		).toMatch(/line/);
	});
});

import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyArtifact, safePath } from "../../scripts/og-video/publish.mjs";
import { why } from "../../scripts/og-video/stale.mjs";
import {
	ENCODING,
	rendererHash,
	sourceHash,
} from "../../scripts/og-video/fingerprint.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "preview-ci-"));
	const target = join(root, "target");
	const incoming = join(root, "incoming");

	const put = (base: string, path: string, content: string | Buffer) => {
		mkdirSync(join(base, path, ".."), { recursive: true });
		writeFileSync(join(base, path), content);
	};

	const entry = (scene: string) => ({
		...metadata,
		image: `/og/${scene}-${hash(PNG)}.png`,
		video: `/og/${scene}-${hash(Buffer.from("\0\0\0\x20ftypisom"))}.mp4`,
		inputs: [],
	});

	const manifest = { home: entry("home"), about: entry("about") };

	for (const scene of ["home", "about"]) {
		put(target, `scripts/og-video/scenes/${scene}.html`, "scene");
		put(target, `public/og/${scene}-${hash(PNG)}.png`, PNG);
		put(
			target,
			`public/og/raw/${scene}-${hash(Buffer.from("\0\0\0\x20ftypisom"))}.mp4`,
			Buffer.from("\0\0\0\x20ftypisom"),
		);
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
		JSON.stringify({ scenes: ["home"], deleted: [] }),
	);
	put(incoming, "sheets/home-sheet.png", PNG);

	const apply = () =>
		applyArtifact(
			{
				INCOMING: incoming,
				TARGET: target,
				SHEETS_OUT: join(root, "sheets"),
				PR_NUMBER: "213",
				RUN_ID: "1",
			},
			() => PNG,
		);

	return { root, target, incoming, put, manifest, apply };
}

describe("trusted publisher boundaries", () => {
	it("accepts a declared scene and writes its required sheet", () => {
		const f = fixture();

		try {
			expect(f.apply()).toEqual(["home"]);
			expect(readFileSync(join(f.root, "sheets/home-sheet.png"))).toEqual(PNG);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses undeclared manifest changes before writing", () => {
		const f = fixture();

		try {
			f.put(
				f.incoming,
				"files/src/data/og-media.json",
				JSON.stringify({
					...f.manifest,
					about: { ...f.manifest.about, inputs: ["different"] },
				}),
			);
			expect(f.apply).toThrow(/Undeclared scene/);
			expect(
				JSON.parse(
					readFileSync(join(f.target, "src/data/og-media.json"), "utf8"),
				),
			).toEqual(f.manifest);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses undeclared media files", () => {
		const f = fixture();

		try {
			f.put(f.incoming, `files/public/og/about-${hash(PNG)}.png`, PNG);
			expect(f.apply).toThrow(/Undeclared media/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("ignores untrusted contact sheets", () => {
		const f = fixture();

		try {
			rmSync(join(f.incoming, "sheets/home-sheet.png"));
			expect(f.apply()).toEqual(["home"]);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses symlinked destination and artifact parents, including dangling links", () => {
		const f = fixture();

		try {
			symlinkSync("/tmp/not-existing-preview-target", join(f.target, "danger"));
			expect(() => safePath(f.target, "danger/file")).toThrow(/Symbolic/);
			symlinkSync("/tmp", join(f.incoming, "files"));
			expect(f.apply).toThrow(/Symbolic/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses deleting outputs still referenced or outside declared scenes", () => {
		const f = fixture();

		try {
			f.put(
				f.incoming,
				"changes.json",
				JSON.stringify({
					scenes: ["home"],
					deleted: ["public/og/about-0123456789.png"],
				}),
			);
			expect(f.apply).toThrow(/deletion/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

describe("stale inputs and outputs", () => {
	it("detects deleted output and renderer changes with unchanged scene inputs", () => {
		const f = fixture();

		try {
			for (const path of [
				"scripts/og-video/render.mjs",
				"scripts/og-video/fingerprint.mjs",
				"package.json",
				"pnpm-lock.yaml",
			])
				f.put(f.target, path, "implementation");

			const entry = {
				...f.manifest.home,
				encoding: ENCODING,
				renderer: rendererHash(f.target),
				source: sourceHash(f.target, []),
			};

			expect(why(entry, f.target)).toBeNull();
			expect(
				why({ ...entry, image: f.manifest.about.image }, f.target, "home"),
			).toMatch(/scene paths/);
			rmSync(join(f.target, `public/og/home-${hash(PNG)}.png`));
			expect(why(entry, f.target)).toMatch(/output missing/);
			f.put(f.target, "scripts/og-video/render.mjs", "changed implementation");
			expect(why(entry, f.target)).toMatch(/renderer changed/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});

it("pins rendering and publication to the same workflow head, never a moving branch", () => {
	const render = readFileSync(".github/workflows/link-previews.yml", "utf8");

	const publish = readFileSync(
		".github/workflows/link-previews-publish.yml",
		"utf8",
	);

	expect(render).toContain(
		"ref: ${{ github.event.pull_request.head.sha || github.sha }}",
	);
	expect(publish).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
	expect(publish).not.toContain("ref: ${{ steps.pr.outputs.branch }}");
	expect(publish).not.toContain("git push --force");
});

it("rejects immutable names whose bytes changed", () => {
	expect(check("public/og/home-0123456789.png", PNG)).toMatch(/content hash/);
});

it("rejects invalid dimensions and duration on any scene", () => {
	for (const invalid of [
		{ width: 0 },
		{ height: 0 },
		{ durationMs: -1 },
		{ videoBytes: 0 },
	]) {
		expect(
			check(
				"src/data/og-media.json",
				Buffer.from(
					JSON.stringify({
						about: {
							...metadata,
							...invalid,
							image: "/og/about-0123456789.png",
							video: "/og/about-0123456789.mp4",
							inputs: [],
						},
					}),
				),
			),
		).toMatch(/metadata/);
	}
});

it("rejects scenes absent from trusted inventory and oversized scene sets", () => {
	const f = fixture();

	try {
		for (const scenes of [
			["attacker-scene"],
			Array.from({ length: 33 }, (_, i) => `scene-${i}`),
		]) {
			for (const scene of scenes)
				f.put(f.target, `scripts/og-video/scenes/${scene}.html`, "scene");
			f.put(
				f.incoming,
				"changes.json",
				JSON.stringify({ scenes, deleted: [] }),
			);
			expect(f.apply).toThrow(/Invalid scenes/);
		}
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

it("dispatches only trusted-main validation and withholds secrets from dispatched code", () => {
	const publisher = readFileSync(
		".github/workflows/link-previews-publish.yml",
		"utf8",
	);

	const validation = readFileSync(".github/workflows/validate.yml", "utf8");
	expect(publisher).toContain('--ref main -f "revision=$(git rev-parse HEAD)"');
	expect(publisher).not.toContain('--ref "$BRANCH"');
	expect(validation).toContain(
		"github.event_name != 'workflow_dispatch' && secrets.PUBLICIST_PRIVATE_TOKEN || ''",
	);
	expect(
		validation.match(/ref: \$\{\{ inputs.revision \|\| github.sha \}\}/g),
	).toHaveLength(5);
	const reporter = validation.split("  validate:\n")[1];
	expect(reporter).toContain("statuses: write");
	expect(reporter).not.toContain("actions/checkout");
	expect(reporter).toContain("statuses/$REVISION");
});

it("publishes only the run-associated feature PR targeting main", () => {
	const workflow = readFileSync(
		".github/workflows/link-previews-publish.yml",
		"utf8",
	);

	expect(workflow).toContain(
		"github.event.workflow_run.event == 'pull_request'",
	);
	expect(workflow).toContain(".pull_requests | length) == 1");
	expect(workflow).toContain('.base.ref == "main"');
	expect(workflow).toContain(".head.repo.full_name == $repo");
	expect(workflow).toContain('[[ "$BRANCH" != "$default"');
	expect(workflow).toContain('[[ "$protected" == false ]]');
	expect(workflow).not.toContain("pulls?state=open&head=");
});

it("takes review timing from a bounded silent H264 video stream", () => {
	const stream = {
		codec_type: "video",
		codec_name: "h264",
		width: 1200,
		height: 630,
		pix_fmt: "yuv420p",
		duration: "7.2",
	};

	expect(videoDuration({ streams: [stream] })).toBe(7200);
	expect(() =>
		videoDuration({ streams: [stream, { codec_type: "audio" }] }),
	).toThrow(/silent preview/);

	for (const invalid of [
		{ duration: "Infinity" },
		{ duration: "40" },
		{ width: 0 },
		{ codec_type: "audio" },
	])
		expect(() =>
			videoDuration({ streams: [{ ...stream, ...invalid }] }),
		).toThrow(/silent preview/);
});

it("validates reused media instead of trusting existing hashed filenames", () => {
	const f = fixture();

	try {
		f.put(
			f.target,
			`public${f.manifest.home.image}`,
			Buffer.concat([PNG, Buffer.from("tampered")]),
		);
		expect(f.apply).toThrow(/content hash/);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
