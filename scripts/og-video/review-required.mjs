// Trusted workflow only: compare Git objects, never candidate-provided freshness hashes.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const candidate = process.argv[2];

if (!candidate) throw new Error("Candidate checkout is required");

const paths = [
	"scripts/og-video",
	"src/styles/global.css",
	"src/assets",
	"src/data/og-media.json",
	"public/fonts",
	"public/og",
	"package.json",
	"pnpm-lock.yaml",
	"docs/asset-reviews/link-previews.md",
	".github/workflows/link-previews.yml",
];

const tree = (cwd) =>
	execFileSync("git", ["ls-tree", "-r", "-z", "HEAD", "--", ...paths], {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});

const required = tree(".") !== tree(candidate);

const scenes = Object.keys(
	JSON.parse(readFileSync("src/data/og-media.json", "utf8")),
).sort();

if (!scenes.length || !scenes.every((name) => /^[a-z0-9-]{1,80}$/.test(name)))
	throw new Error("Invalid trusted scene inventory");

if (required && process.env.HAS_ARTIFACT !== "true")
	throw new Error("Preview inputs changed without review artifacts");

if (process.env.GITHUB_OUTPUT)
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`scenes=${required ? scenes.join(" ") : ""}\n`,
	);

console.log(
	required
		? "Full trusted scene review required."
		: "Preview inputs unchanged.",
);
