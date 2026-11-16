#!/usr/bin/env node
// Trusted half of the link-preview CI (.github/workflows/link-previews-publish.yml runs main's copy).
// Checks the artifact the render job uploaded, which came from pull request code, copies the files
// it allows into the pull request's checkout, and brings the asset record up to date.
//
// Env: INCOMING (the artifact), TARGET (the pull request checkout), SHEETS_OUT (checked contact
// sheets), PR_NUMBER, RUN_ID. Writes scenes=<names> to $GITHUB_OUTPUT. Node built-ins only.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
	mkdtempSync,
	appendFileSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { withFiles, withNote } from "./record.mjs";
import { siteTokens } from "./site-tokens.mjs";

const TRUSTED_SCENES = new Set(
	readdirSync(new URL("./scenes/", import.meta.url))
		.filter((name) => name.endsWith(".html"))
		.map((name) => name.slice(0, -5)),
);

const MB = 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Path, first bytes and size limit of every file the render job may hand over.
const KINDS = [
	{
		path: /^public\/og\/[a-z0-9-]+-[0-9a-f]{10}\.png$/,
		magic: PNG,
		max: 600 * 1024,
	},
	{
		path: /^public\/og\/[a-z0-9-]+-[0-9a-f]{10}\.jpg$/,
		magic: [0xff, 0xd8, 0xff],
		max: 600 * 1024,
	},
	{
		path: /^public\/og\/raw\/[a-z0-9-]+-[0-9a-f]{10}\.mp4$/,
		ftyp: true,
		max: 2.5 * MB,
	},
	{ path: /^src\/data\/og-media\.json$/, json: true, max: 256 * 1024 },
	{ path: /^scripts\/og-video\/site-tokens\.css$/, css: true, max: 4096 },
];

const SCENE = /^[a-z0-9-]{1,80}$/;
const SAFE_INPUT = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;

const TOKEN_LINE =
	/^(\/\*[^*]{0,200}\*\/|:root \{|  --[a-z-]{1,40}: [A-Za-z0-9#.,%() -]{1,80};|\})$/;

export function check(path, bytes) {
	const kind = KINDS.find((candidate) => candidate.path.test(path));

	if (!kind) return "is not a file the render job may change";

	if (bytes.length > kind.max) return `is larger than ${kind.max} bytes`;

	if (kind.magic && !kind.magic.every((byte, index) => bytes[index] === byte))
		return "does not start like its file type";

	if (kind.ftyp && bytes.subarray(4, 8).toString("latin1") !== "ftyp")
		return "is not an MP4 file";

	if (
		!kind.json &&
		!kind.css &&
		createHash("sha256").update(bytes).digest("hex").slice(0, 10) !==
			path.match(/-([0-9a-f]{10})\./)?.[1]
	)
		return "does not match its content hash";

	if (
		kind.css &&
		!bytes
			.toString("utf8")
			.trimEnd()
			.split("\n")
			.every((line) => TOKEN_LINE.test(line))
	)
		return "has a line the token generator does not write";

	if (kind.json) {
		let manifest;

		try {
			manifest = JSON.parse(bytes.toString("utf8"));
		} catch {
			return "is not JSON";
		}

		if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
			return "is not a manifest";

		for (const [scene, entry] of Object.entries(manifest)) {
			if (!SCENE.test(scene)) return `names an unexpected scene ${scene}`;

			if (
				!/^\/og\/[a-z0-9-]+-[0-9a-f]{10}\.(png|jpg)$/.test(entry?.image) ||
				!/^\/og\/[a-z0-9-]+-[0-9a-f]{10}\.mp4$/.test(entry?.video)
			)
				return `has unexpected files for ${scene}`;

			if (
				entry.width !== 1200 ||
				entry.height !== 630 ||
				!Number.isSafeInteger(entry.durationMs) ||
				entry.durationMs < 100 ||
				entry.durationMs > 30000 ||
				!Number.isSafeInteger(entry.imageBytes) ||
				entry.imageBytes < 1 ||
				entry.imageBytes > 600 * 1024 ||
				!Number.isSafeInteger(entry.videoBytes) ||
				entry.videoBytes < 1 ||
				entry.videoBytes > 2.5 * MB ||
				![entry.frames, entry.source, entry.encoding].every((value) =>
					/^[0-9a-f]{16}$/.test(value ?? ""),
				) ||
				(entry.renderer !== undefined && !/^[0-9a-f]{16}$/.test(entry.renderer))
			)
				return `has invalid metadata for ${scene}`;

			if (
				!Array.isArray(entry.inputs) ||
				!entry.inputs.every(
					(input) => typeof input === "string" && SAFE_INPUT.test(input),
				)
			)
				return `has unexpected inputs for ${scene}`;
		}
	}

	return null;
}

function walk(directory, base = directory) {
	return readdirSync(directory).flatMap((name) => {
		const full = join(directory, name);
		const stat = lstatSync(full);

		if (stat.isSymbolicLink())
			throw new Error(`${relative(base, full)} is a symbolic link`);

		return stat.isDirectory() ? walk(full, base) : [relative(base, full)];
	});
}

// Never traverse a PR-supplied symlink, including a parent directory.
export function safePath(root, path) {
	if (
		typeof path !== "string" ||
		!SAFE_INPUT.test(path) ||
		path.startsWith("/")
	)
		throw new Error("Unsafe path");
	let current = root;

	for (const part of path.split("/")) {
		current = join(current, part);

		if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
			throw new Error("Symbolic link in target path");
	}

	return current;
}

export function videoDuration(probe) {
	const streams = probe?.streams;
	const stream = streams?.[0];
	const durationMs = Number(stream?.duration) * 1000;

	if (
		!Array.isArray(streams) ||
		streams.length !== 1 ||
		stream.codec_type !== "video" ||
		stream.codec_name !== "h264" ||
		stream.width !== 1200 ||
		stream.height !== 630 ||
		stream.pix_fmt !== "yuv420p" ||
		!Number.isFinite(durationMs) ||
		durationMs < 100 ||
		durationMs > 30000
	)
		throw new Error("Invalid silent preview video");

	return durationMs;
}

export function deriveSheet(video, declaredDurationMs, image) {
	const probe = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-protocol_whitelist",
				"file",
				"-show_streams",
				"-of",
				"json",
				video,
			],
			{
				timeout: 10000,
				maxBuffer: 1024 * 1024,
				env: { PATH: process.env.PATH },
			},
		).toString(),
	);

	const durationMs = videoDuration(probe);

	if (Math.abs(durationMs - declaredDurationMs) > 34)
		throw new Error("Declared duration differs from video");
	const directory = mkdtempSync(join(tmpdir(), "trusted-preview-"));

	try {
		const output = join(directory, "sheet.png");
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-nostdin",
				"-protocol_whitelist",
				"file",
				"-i",
				video,
				"-protocol_whitelist",
				"file",
				"-i",
				image,
				"-an",
				"-sn",
				"-dn",
				"-filter_complex",
				`[0:v]fps=12/${durationMs / 1000},scale=400:210,tile=3x4[frames];[1:v]scale=1200:630[poster];[poster][frames]vstack=inputs=2`,
				"-frames:v",
				"1",
				output,
			],
			{
				timeout: 30000,
				maxBuffer: 1024 * 1024,
				env: { PATH: process.env.PATH },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		return readFileSync(output);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function applyArtifact(
	{ INCOMING, TARGET, SHEETS_OUT, PR_NUMBER, RUN_ID },
	makeSheet = deriveSheet,
) {
	if (
		!INCOMING ||
		!TARGET ||
		!SHEETS_OUT ||
		!/^\d+$/.test(PR_NUMBER ?? "") ||
		!/^\d+$/.test(RUN_ID ?? "")
	)
		throw new Error("Missing or unexpected environment.");

	const changes = JSON.parse(
		readFileSync(safePath(INCOMING, "changes.json"), "utf8"),
	);

	const scenes = Array.isArray(changes.scenes) ? changes.scenes : [];

	if (
		!scenes.length ||
		scenes.length > 32 ||
		new Set(scenes).size !== scenes.length ||
		!scenes.every(
			(scene) =>
				typeof scene === "string" &&
				SCENE.test(scene) &&
				TRUSTED_SCENES.has(scene) &&
				existsSync(safePath(TARGET, `scripts/og-video/scenes/${scene}.html`)),
		)
	)
		throw new Error("Invalid scenes");
	const deleted = changes.deleted;

	if (
		!Array.isArray(deleted) ||
		!deleted.every(
			(path) =>
				typeof path === "string" &&
				KINDS.slice(0, 3).some((kind) => kind.path.test(path)),
		)
	)
		throw new Error("Invalid deleted previews");
	const filesDir = safePath(INCOMING, "files");
	const files = existsSync(filesDir) ? walk(filesDir) : [];

	if (files.length > 200 || deleted.length > 200)
		throw new Error("Too many preview files");

	for (const path of files) {
		const problem = check(path, readFileSync(safePath(filesDir, path)));

		if (problem) throw new Error(`${path} ${problem}`);
		safePath(TARGET, path);
	}

	const manifestPath = "src/data/og-media.json";

	const before = JSON.parse(
		readFileSync(safePath(TARGET, manifestPath), "utf8"),
	);

	const after = files.includes(manifestPath)
		? JSON.parse(readFileSync(safePath(filesDir, manifestPath), "utf8"))
		: before;

	const manifestProblem = check(
		manifestPath,
		Buffer.from(JSON.stringify(after)),
	);

	if (manifestProblem) throw new Error(manifestProblem);

	const mediaPaths = (entry) =>
		entry
			? [
					`public${entry.image}`,
					`public${entry.video.replace("/og/", "/og/raw/")}`,
				]
			: [];

	for (const scene of new Set([
		...Object.keys(before),
		...Object.keys(after),
	])) {
		if (
			!scenes.includes(scene) &&
			JSON.stringify(before[scene]) !== JSON.stringify(after[scene])
		)
			throw new Error(`Undeclared scene ${scene} changed`);
	}

	const allowedOld = new Set(
		scenes.flatMap((scene) => mediaPaths(before[scene])),
	);

	const allowedNew = new Set(
		scenes.flatMap((scene) => mediaPaths(after[scene])),
	);

	for (const path of files.filter((path) => path.startsWith("public/og/"))) {
		if (!allowedNew.has(path)) throw new Error("Undeclared media file");
	}

	for (const path of deleted) {
		if (
			!allowedOld.has(path) ||
			Object.values(after).some((entry) => mediaPaths(entry).includes(path))
		)
			throw new Error("Undeclared or still-used deletion");
		safePath(TARGET, path);
	}

	// The manifest's scene and filenames must agree; no hidden cross-scene replacement.
	for (const [scene, entry] of Object.entries(after)) {
		if (
			!new RegExp(`^/og/${scene}-[0-9a-f]{10}\\.(png|jpg)$`).test(
				entry.image,
			) ||
			!new RegExp(`^/og/${scene}-[0-9a-f]{10}\\.mp4$`).test(entry.video)
		)
			throw new Error("Scene filename mismatch");

		for (const path of mediaPaths(entry)) {
			const location = safePath(files.includes(path) ? filesDir : TARGET, path);

			if (!existsSync(location)) throw new Error(`Missing output ${path}`);
			const problem = check(path, readFileSync(location));

			if (problem) throw new Error(`${path} ${problem}`);
		}
	}

	const tokens = "scripts/og-video/site-tokens.css";

	if (
		files.includes(tokens) &&
		readFileSync(safePath(filesDir, tokens), "utf8") !==
			siteTokens(
				readFileSync(safePath(TARGET, "src/styles/global.css"), "utf8"),
			)
	)
		throw new Error("Tokens differ from site styles");

	// Never trust PR-rendered review pixels: derive sheets from the exact accepted video bytes.
	let sheetBytes = 0;

	const sheets = scenes.map((scene) => {
		const entry = after[scene];

		if (!entry) throw new Error("Missing scene metadata");
		const video = mediaPaths(entry)[1];

		const bytes = makeSheet(
			safePath(files.includes(video) ? filesDir : TARGET, video),
			entry.durationMs,
			safePath(
				files.includes(mediaPaths(entry)[0]) ? filesDir : TARGET,
				mediaPaths(entry)[0],
			),
		);

		sheetBytes += bytes.length;

		if (
			bytes.length > 2 * MB ||
			sheetBytes > 32 * MB ||
			!PNG.every((byte, index) => bytes[index] === byte)
		)
			throw new Error("Invalid or excessive contact sheets");

		return [scene, bytes];
	});

	const recordPath = safePath(TARGET, "docs/asset-reviews/link-previews.md");
	const note = `CI render (Link previews workflow run ${RUN_ID}, PR #${PR_NUMBER}): ${scenes.join(", ")}. Review the contact sheets in the pull request before merging.`;

	const record = withNote(
		withFiles(readFileSync(recordPath, "utf8"), after, (path) =>
			readFileSync(
				files.includes(path)
					? safePath(filesDir, path)
					: safePath(TARGET, path),
			),
		),
		note,
	);

	for (const path of files) {
		mkdirSync(dirname(safePath(TARGET, path)), { recursive: true });
		copyFileSync(safePath(filesDir, path), safePath(TARGET, path));
	}

	for (const path of deleted) rmSync(safePath(TARGET, path));
	writeFileSync(recordPath, record);
	mkdirSync(SHEETS_OUT, { recursive: true });

	for (const [scene, bytes] of sheets)
		writeFileSync(join(SHEETS_OUT, `${scene}-sheet.png`), bytes);

	return scenes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const scenes = applyArtifact(process.env);

	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `scenes=${scenes.join(" ")}\n`);
	console.log(`Applied checked renders for ${scenes.join(" ")}.`);
}
