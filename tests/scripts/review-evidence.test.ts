import { describe, expect, it } from "vitest";
import {
	evidenceSheets,
	evidenceSummary,
	verifyEvidence,
} from "../../scripts/og-video/review-evidence.mjs";

const receipt = {
	sha: "a".repeat(40),
	pr: "213",
	dir: "pr-213/previews-aaaaaaa",
	scenes: "home",
	screenshotsCommit: "b".repeat(40),
	sheets: [
		{
			scene: "home",
			gitSha: "c".repeat(40),
			sha256: "d".repeat(64),
			bytes: 100,
		},
	],
};

const root = "e".repeat(40),
	branch = "f".repeat(40),
	leaf = "1".repeat(40);

const read = async (path: string) => {
	if (path.startsWith("git/commits/"))
		return { sha: receipt.screenshotsCommit, tree: { sha: root } };

	if (path === `git/trees/${root}`)
		return { tree: [{ path: "pr-213", type: "tree", sha: branch }] };

	if (path === `git/trees/${branch}`)
		return { tree: [{ path: "previews-aaaaaaa", type: "tree", sha: leaf }] };

	return {
		tree: [
			{
				path: "home-sheet.png",
				type: "blob",
				mode: "100644",
				sha: receipt.sheets[0].gitSha,
				size: 100,
			},
		],
	};
};

describe("immutable review evidence", () => {
	it("binds canonical image URLs to a commit rather than the mutable branch/body", async () => {
		await expect(verifyEvidence(receipt, read)).resolves.toBeUndefined();
		const summary = evidenceSummary(receipt, "owner/site");
		expect(summary).toContain(
			`/owner/site/${receipt.screenshotsCommit}/${receipt.dir}/home-sheet.png`,
		);
		expect(summary).not.toContain("/screenshots/");
		expect(summary).toContain(receipt.sheets[0].sha256);
		expect(summary).toContain("PR-description images are not authoritative");
	});
	it("rejects missing, different, symlinked, oversized or partial evidence", async () => {
		for (const change of [
			{ screenshotsCommit: "screenshots" },
			{ dir: "../escape" },
			{ sheets: [] },
			{ sheets: [{ ...receipt.sheets[0], bytes: 3 * 1024 * 1024 }] },
		])
			expect(() => evidenceSheets({ ...receipt, ...change })).toThrow();

		for (const change of [
			{ sha: "0".repeat(40) },
			{ mode: "120000" },
			{ size: 101 },
		]) {
			await expect(
				verifyEvidence(receipt, async (path: string) => {
					const result = await read(path);

					if (path === `git/trees/${leaf}` && Array.isArray(result.tree))
						return { tree: [{ ...result.tree[0], ...change }] };

					return result;
				}),
			).rejects.toThrow(/bytes differ/);
		}

		await expect(
			verifyEvidence(receipt, async (path: string) => ({
				...(await read(path)),
				truncated: true,
			})),
		).rejects.toThrow();
	});
});
