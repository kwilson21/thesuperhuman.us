// Trusted workflow only: compare Git objects, never candidate-provided freshness hashes.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const paths = [
	"scripts/og-video",
	"src/styles/global.css",
	"src/assets",
	"src/data/og-media.json",
	"public/fonts",
	"public/music",
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

// Read only names and modes from the authenticated candidate Git tree. New scene
// source is never loaded or executed by the privileged publisher. All additions
// become mandatory media + independently decoded contact-sheet evidence.
export function sceneInventory(trusted, candidateTree) {
	const scenes = new Set(trusted);

	for (const row of candidateTree.split("\0").filter(Boolean)) {
		const match =
			/^(100644|100755) blob [0-9a-f]{40}\tscripts\/og-video\/scenes\/([a-z0-9-]{1,80})\.html$/.exec(
				row,
			);

		if (!match) throw new Error("Invalid candidate scene inventory");
		scenes.add(match[2]);
	}

	if (
		!scenes.size ||
		scenes.size > 32 ||
		![...scenes].every(
			(name) => typeof name === "string" && /^[a-z0-9-]{1,80}$/.test(name),
		)
	)
		throw new Error("Invalid trusted scene inventory");

	return [...scenes].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const candidate = process.argv[2];

	if (!candidate) throw new Error("Candidate checkout is required");
	const required = tree(".") !== tree(candidate);

	const candidateTree = execFileSync(
		"git",
		["ls-tree", "-r", "-z", "HEAD", "--", "scripts/og-video/scenes"],
		{
			cwd: candidate,
			encoding: "utf8",
			maxBuffer: 64 * 1024,
		},
	);

	const scenes = sceneInventory(
		Object.keys(JSON.parse(readFileSync("src/data/og-media.json", "utf8"))),
		candidateTree,
	);

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
}
