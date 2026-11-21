// Trusted publisher/finalizer only. Git blob IDs bind the reviewed bytes to an immutable commit.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;

export function evidenceSheets(receipt) {
	const scenes = (receipt?.scenes ?? "").split(" ");

	if (
		!SHA.test(receipt?.screenshotsCommit ?? "") ||
		!SHA.test(receipt?.sha ?? "") ||
		!/^\d+$/.test(receipt?.pr ?? "") ||
		receipt.dir !== `pr-${receipt.pr}/previews-${receipt.sha.slice(0, 7)}` ||
		!scenes.length ||
		scenes.length > 32 ||
		new Set(scenes).size !== scenes.length ||
		!scenes.every((scene) => /^[a-z0-9-]{1,80}$/.test(scene)) ||
		!Array.isArray(receipt.sheets) ||
		receipt.sheets.length !== scenes.length
	)
		throw new Error("Invalid immutable review evidence");

	let total = 0;

	for (const [index, sheet] of receipt.sheets.entries()) {
		if (
			sheet.scene !== scenes[index] ||
			!SHA.test(sheet.gitSha ?? "") ||
			!/^[0-9a-f]{64}$/.test(sheet.sha256 ?? "") ||
			!Number.isSafeInteger(sheet.bytes) ||
			sheet.bytes < 8 ||
			sheet.bytes > 2 * 1024 * 1024
		)
			throw new Error("Invalid sheet digest");
		total += sheet.bytes;
	}

	if (total > 32 * 1024 * 1024) throw new Error("Excessive review evidence");

	return receipt.sheets;
}

export async function verifyEvidence(receipt, read) {
	const sheets = evidenceSheets(receipt);
	const commit = await read(`git/commits/${receipt.screenshotsCommit}`);

	if (
		commit.sha !== receipt.screenshotsCommit ||
		!SHA.test(commit.tree?.sha ?? "")
	)
		throw new Error("Screenshot commit mismatch");
	let treeSha = commit.tree.sha;

	for (const part of receipt.dir.split("/")) {
		const listing = await read(`git/trees/${treeSha}`);
		const entry = listing.tree?.find((item) => item.path === part);

		if (
			listing.truncated ||
			entry?.type !== "tree" ||
			!SHA.test(entry.sha ?? "")
		)
			throw new Error("Screenshot directory missing");
		treeSha = entry.sha;
	}

	const listing = await read(`git/trees/${treeSha}`);

	if (listing.truncated || listing.tree?.length !== sheets.length)
		throw new Error("Screenshot inventory differs");

	for (const sheet of sheets) {
		const entry = listing.tree.find(
			(item) => item.path === `${sheet.scene}-sheet.png`,
		);

		if (
			entry?.type !== "blob" ||
			entry.mode !== "100644" ||
			entry.sha !== sheet.gitSha ||
			entry.size !== sheet.bytes
		)
			throw new Error("Screenshot bytes differ from trusted receipt");
	}
}

export function evidenceSummary(receipt, repository) {
	const sheets = evidenceSheets(receipt);

	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
		throw new Error("Invalid repository");

	return [
		`Canonical preview evidence for commit \`${receipt.sha}\`. Review these sheets before merging; PR-description images are not authoritative.`,
		`Screenshots commit: [\`${receipt.screenshotsCommit}\`](https://github.com/${repository}/tree/${receipt.screenshotsCommit}/${receipt.dir}).`,
		...sheets.map(
			(sheet) =>
				`### ${sheet.scene}\n![${sheet.scene} trusted review sheet](https://raw.githubusercontent.com/${repository}/${receipt.screenshotsCommit}/${receipt.dir}/${sheet.scene}-sheet.png)\nSHA-256: \`${sheet.sha256}\`; Git blob: \`${sheet.gitSha}\`.`,
		),
	].join("\n\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const env = process.env;

	const receipt = {
		base: env.BASE,
		sha: env.SHA,
		pr: env.PR,
		dir: env.DIR,
		scenes: env.SCENES,
		renderRun: env.RENDER_RUN,
		run: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT,
		screenshotsCommit: env.SCREENSHOTS_COMMIT,
		sheets: (env.SCENES ?? "").split(" ").map((scene) => {
			if (!/^[a-z0-9-]{1,80}$/.test(scene)) throw new Error("Invalid scene");
			const file = join("sheets", `${scene}-sheet.png`);
			const bytes = readFileSync(file);

			return {
				scene,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				gitSha: execFileSync("git", ["hash-object", "--", file], {
					encoding: "utf8",
				}).trim(),
			};
		}),
	};

	evidenceSheets(receipt);
	mkdirSync("receipt", { recursive: true });
	writeFileSync("receipt/receipt.json", JSON.stringify(receipt));
}
