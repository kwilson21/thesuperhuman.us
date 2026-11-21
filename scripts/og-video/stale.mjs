#!/usr/bin/env node
// Lists the link-preview scenes whose rendered files are out of date: a scene without a manifest
// entry, a missing or changed input (the scene, the kit, site-tokens.css, a font or an image), or
// new encoder settings. CI renders only these. Node built-ins only, so it runs before npm ci.
//
//   node scripts/og-video/stale.mjs                prints the stale scenes, one line
//   node scripts/og-video/stale.mjs home about     adds these scenes even if current ("all" for every one)
//
// In GitHub Actions it also writes scenes=<names> to $GITHUB_OUTPUT.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENCODING, sourceHash, rendererHash } from "./fingerprint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const scenes = readdirSync(join(ROOT, "scripts/og-video/scenes"))
	.filter((name) => name.endsWith(".html"))
	.map((name) => basename(name, ".html"))
	.sort();

const manifest = JSON.parse(
	readFileSync(join(ROOT, "src/data/og-media.json"), "utf8"),
);

export function why(entry, root = ROOT, scene) {
	if (!entry) return "not rendered yet";

	if (
		scene &&
		(!new RegExp(`^/og/${scene}-[0-9a-f]{10}\\.(png|jpg)$`).test(entry.image) ||
			!new RegExp(`^/og/${scene}-[0-9a-f]{10}\\.mp4$`).test(entry.video))
	)
		return "scene paths changed";

	if (entry.renderer !== rendererHash(root)) return "renderer changed";

	if (
		![entry.image, entry.video?.replace("/og/", "/og/raw/")].every(
			(file) =>
				typeof file === "string" && existsSync(join(root, "public", file)),
		)
	)
		return "rendered output missing";

	if (entry.encoding !== ENCODING) return "encoder settings changed";
	const missing = entry.inputs.find((input) => !existsSync(join(root, input)));

	if (missing) return `${missing} is gone`;

	if (sourceHash(root, entry.inputs) !== entry.source)
		return "its files changed";

	return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const requested = process.argv
		.slice(2)
		.flatMap((arg) => arg.split(/[\s,]+/))
		.filter(Boolean);

	const unknown = requested.filter(
		(name) => name !== "all" && !scenes.includes(name),
	);

	if (unknown.length) {
		console.error(`Unknown scene: ${unknown.join(", ")}`);
		process.exit(1);
	}

	const stale = scenes.filter((scene) => {
		const reason = why(manifest[scene], ROOT, scene);

		if (reason) console.error(`${scene}: ${reason}`);

		return reason || requested.includes("all") || requested.includes(scene);
	});

	console.log(stale.join(" "));

	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `scenes=${stale.join(" ")}\n`);
}
