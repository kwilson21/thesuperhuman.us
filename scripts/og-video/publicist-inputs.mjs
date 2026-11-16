// Run only from a trusted checkout. No candidate code is loaded or executed.
// Media-only validation can reuse the trusted gate only for byte-identical inputs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const candidate = process.argv[2];

if (!candidate) throw new Error("Candidate checkout is required");

const config = JSON.parse(readFileSync("publicist/config.json", "utf8"));

const paths = [
	"AGENTS.md",
	".agents/skills/publicist",
	"publicist",
	"scripts/publicist",
	...Object.values(config.projects).map(({ data }) => data),
];

const tree = (cwd) =>
	execFileSync("git", ["ls-tree", "-r", "-z", "HEAD", "--", ...paths], {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});

if (tree(".") !== tree(candidate))
	throw new Error(
		"Publicist inputs differ from trusted main; normal reviewed validation is required",
	);

console.log("Publicist inputs match trusted main.");
