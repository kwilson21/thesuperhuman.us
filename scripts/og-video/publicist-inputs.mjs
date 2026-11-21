// Stage only Git blobs as data. Candidate code, config, validators and paths never run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function entries(root, paths) {
	const result = execFileSync(
		"git",
		["ls-tree", "-r", "-z", "HEAD", "--", ...paths],
		{ cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
	);

	return result
		.split("\0")
		.filter(Boolean)
		.map((line) => {
			const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)$/.exec(
				line,
			);

			if (!match) throw new Error("Publicist input is not a regular Git blob");
			const [, mode, sha, path] = match;

			if (
				!/^[A-Za-z0-9_.\/-]+$/.test(path) ||
				path.startsWith("/") ||
				path.split("/").includes("..")
			)
				throw new Error("Unsafe publicist path");

			return { mode, sha, path };
		});
}

function blob(root, item) {
	return execFileSync("git", ["cat-file", "blob", item.sha], {
		cwd: root,
		maxBuffer: 2 * 1024 * 1024,
	});
}

export function stagePublicist(trustedRoot, candidateRoot) {
	const policy = [
		"publicist/config.json",
		".agents/skills/publicist",
		"scripts/publicist",
	];

	const trustedPolicy = entries(trustedRoot, policy);
	const candidatePolicy = entries(candidateRoot, policy);

	if (JSON.stringify(trustedPolicy) !== JSON.stringify(candidatePolicy))
		throw new Error(
			"Publicist policy or validators changed; separate trusted review required",
		);

	const configItem = trustedPolicy.find(
		(item) => item.path === "publicist/config.json",
	);

	if (!configItem) throw new Error("Trusted publicist config missing");
	const config = JSON.parse(blob(trustedRoot, configItem));
	const data = Object.values(config.projects).map((project) => project.data);

	for (const path of data) {
		if (
			typeof path !== "string" ||
			!/^[A-Za-z0-9_./-]+$/.test(path) ||
			path.startsWith("/") ||
			path.split("/").includes("..")
		)
			throw new Error("Invalid trusted story path");
	}

	const candidateInputs = entries(candidateRoot, [
		"AGENTS.md",
		...data,
		"publicist/queue",
	]);

	if (!candidateInputs.some((item) => item.path === "AGENTS.md"))
		throw new Error("Candidate AGENTS.md missing");
	const directory = mkdtempSync(join(tmpdir(), "trusted-publicist-"));

	try {
		for (const [root, items] of [
			[trustedRoot, trustedPolicy],
			[candidateRoot, candidateInputs],
		]) {
			for (const item of items) {
				// Queue parsing matches gate.mjs: immediate Markdown entries only; never copy programs.
				if (
					root === candidateRoot &&
					item.path.startsWith("publicist/queue/") &&
					!/^publicist\/queue\/[^/]+\.md$/.test(item.path)
				)
					continue;
				const target = join(directory, item.path);
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, blob(root, item), { mode: 0o600, flag: "wx" });
			}
		}

		return directory;
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (!process.argv[2]) throw new Error("Candidate checkout is required");
	const staged = stagePublicist(process.cwd(), resolve(process.argv[2]));

	try {
		execFileSync(
			process.execPath,
			[join(staged, "scripts/publicist/gate.mjs")],
			{ cwd: staged, stdio: "inherit", env: process.env },
		);
	} finally {
		rmSync(staged, { recursive: true, force: true });
	}
}
