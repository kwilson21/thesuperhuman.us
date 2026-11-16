import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteTokens } from "../../scripts/og-video/site-tokens.mjs";
import { withFiles, withNote } from "../../scripts/og-video/record.mjs";
import { check } from "../../scripts/og-video/publish.mjs";

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

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
		expect(check("public/og/home-0123456789.png", PNG)).toBeNull();
		expect(
			check(
				"public/og/raw/home-0123456789.mp4",
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
		image: `/og/${scene}-0123456789.png`,
		video: `/og/${scene}-0123456789.mp4`,
		inputs: [],
	});

	const manifest = { home: entry("home"), about: entry("about") };

	for (const scene of ["home", "about"]) {
		put(target, `scripts/og-video/scenes/${scene}.html`, "scene");
		put(target, `public/og/${scene}-0123456789.png`, PNG);
		put(
			target,
			`public/og/raw/${scene}-0123456789.mp4`,
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
		applyArtifact({
			INCOMING: incoming,
			TARGET: target,
			SHEETS_OUT: join(root, "sheets"),
			PR_NUMBER: "213",
			RUN_ID: "1",
		});

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
			f.put(f.incoming, "files/public/og/about-0123456789.png", PNG);
			expect(f.apply).toThrow(/Undeclared media/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses missing contact sheets", () => {
		const f = fixture();

		try {
			rmSync(join(f.incoming, "sheets/home-sheet.png"));
			expect(f.apply).toThrow();
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
	it("refuses symlinked destination and artifact parents, including dangling links", () => {
		const f = fixture();

		try {
			symlinkSync("/tmp/not-existing-preview-target", join(f.target, "danger"));
			expect(() => safePath(f.target, "danger/file")).toThrow(/Symbolic/);
			rmSync(join(f.incoming, "sheets"), { recursive: true });
			symlinkSync("/tmp", join(f.incoming, "sheets"));
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
			])
				f.put(f.target, path, "implementation");

			const entry = {
				...f.manifest.home,
				encoding: ENCODING,
				renderer: rendererHash(f.target),
				source: sourceHash(f.target, []),
			};

			expect(why(entry, f.target)).toBeNull();
			rmSync(join(f.target, "public/og/home-0123456789.png"));
			expect(why(entry, f.target)).toMatch(/output missing/);
			f.put(f.target, "scripts/og-video/render.mjs", "changed implementation");
			expect(why(entry, f.target)).toMatch(/renderer changed/);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
});
