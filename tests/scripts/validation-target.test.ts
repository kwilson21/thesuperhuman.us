import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validMergeEvidence } from "../../scripts/og-video/finalize-validation.mjs";
import {
	mergedTarget,
	resolveMerge,
} from "../../scripts/og-video/validation-target.mjs";

const sha = "a".repeat(40),
	base = "b".repeat(40),
	merge = "c".repeat(40),
	repository = "owner/site";

const pr = {
	number: 213,
	state: "open",
	head: { sha, repo: { full_name: repository } },
	base: { sha: base, ref: "main", repo: { full_name: repository } },
	merge_commit_sha: merge,
};

const commit = { sha: merge, parents: [{ sha: base }, { sha }] };

describe("immutable merged-tree validation", () => {
	it("binds every lane to one authenticated head/base merge", () => {
		const target = mergedTarget(pr, commit, sha, repository);
		expect(validMergeEvidence(target, sha, base, commit)).toBe(true);

		for (const bad of [
			{ ...commit, parents: [{ sha }] },
			{ ...commit, parents: [{ sha }, { sha: base }] },
			{ ...commit, parents: [{ sha: "d".repeat(40) }, { sha }] },
		]) {
			expect(() => mergedTarget(pr, bad, sha, repository)).toThrow();
			expect(validMergeEvidence(target, sha, base, bad)).toBe(false);
		}

		expect(
			validMergeEvidence({ ...target, base: sha }, sha, base, commit),
		).toBe(false);
		expect(
			validMergeEvidence({ ...target, merge: sha }, sha, base, commit),
		).toBe(false);
		expect(() =>
			mergedTarget({ ...pr, state: "closed" }, commit, sha, repository),
		).toThrow();
	});
	it("never checks out a raw dispatched head in a work lane", () => {
		const yaml = readFileSync(".github/workflows/validate.yml", "utf8");
		expect(
			yaml.match(/ref: \$\{\{ needs.target.outputs.merge \}\}/g),
		).toHaveLength(5);
		expect(yaml).not.toContain("ref: ${{ inputs.revision || github.sha }}");
		expect(yaml).toContain("path: result/result.json");
		expect(yaml).toContain("pull-requests: read");
		expect(yaml).toContain("ref: ${{ github.sha }}");

		const finalizer = readFileSync(
			"scripts/og-video/finalize-validation.mjs",
			"utf8",
		);

		expect(
			finalizer.match(/"scripts\/og-video\/validation-target.mjs"/g),
		).toHaveLength(2);
	});
	it("replays deterministic publication and rejects unrelated moved heads", () => {
		const yaml = readFileSync(
			".github/workflows/link-previews-publish.yml",
			"utf8",
		);

		expect(yaml).toContain('echo "base=$GITHUB_SHA"');
		expect(yaml).toContain("ref: ${{ steps.pr.outputs.base }}");
		expect(yaml).toContain("GIT_AUTHOR_DATE: ${{ steps.pr.outputs.date }}");
		expect(yaml).toContain("GIT_COMMITTER_DATE: ${{ steps.pr.outputs.date }}");
		expect(yaml).toContain(
			'[[ "$current" == "$ORIGINAL" || "$current" == "$generated" ]]',
		);
		expect(yaml).not.toContain("git push --force");
	});
});

it("recreates the same generated commit after an interrupted publication", () => {
	const dir = mkdtempSync(join(tmpdir(), "preview-recovery-"));

	const env = {
		...process.env,
		GIT_AUTHOR_NAME: "github-actions[bot]",
		GIT_AUTHOR_EMAIL: "bot@example.invalid",
		GIT_COMMITTER_NAME: "github-actions[bot]",
		GIT_COMMITTER_EMAIL: "bot@example.invalid",
		GIT_AUTHOR_DATE: "2026-11-16T13:00:00Z",
		GIT_COMMITTER_DATE: "2026-11-16T13:00:00Z",
	};

	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();

	try {
		git("init", "-q");
		writeFileSync(join(dir, "input"), "original");
		git("add", ".");
		git("commit", "-qm", "original");
		const original = git("rev-parse", "HEAD");

		const generate = () => {
			writeFileSync(join(dir, "input"), "generated");
			git("add", ".");
			git("commit", "-qm", "Render link previews");

			return git("rev-parse", "HEAD");
		};

		const first = generate();
		git("reset", "--hard", original);
		const retry = generate();
		expect(retry).toBe(first);

		const accept = (current: string) =>
			current === original || current === retry;

		expect(accept(original)).toBe(true);
		expect(accept(first)).toBe(true);
		writeFileSync(join(dir, "user"), "newer");
		git("add", ".");
		git("commit", "-qm", "user change");
		expect(accept(git("rev-parse", "HEAD"))).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it("uses authenticated main ref instead of stale PR base SHA", async () => {
	const stale = { ...pr, base: { ...pr.base, sha: "d".repeat(40) } };
	expect(mergedTarget(stale, commit, sha, repository, base).base).toBe(base);
	let tries = 0;

	const api = async (path: string) => {
		if (path === `pulls/${pr.number}`)
			return { ...stale, merge_commit_sha: ++tries === 1 ? null : merge };

		if (path === "git/ref/heads/main") return { object: { sha: base } };

		if (path === `git/commits/${merge}`) return commit;
		throw new Error(path);
	};

	expect(
		await resolveMerge(api, pr.number, sha, repository, async () => {}),
	).toEqual({ sha, base, merge, pr: String(pr.number) });
	expect(tries).toBe(2);
});

it("never falls back to raw head when the live-base merge remains unavailable", async () => {
	let tries = 0;

	const api = async (path: string) => {
		if (path === `pulls/${pr.number}`) {
			tries++;

			return pr;
		}

		if (path === "git/ref/heads/main")
			return { object: { sha: "d".repeat(40) } };

		return commit;
	};

	await expect(
		resolveMerge(api, pr.number, sha, repository, async () => {}),
	).rejects.toThrow(/bounded retry/);
	expect(tries).toBe(6);
});
