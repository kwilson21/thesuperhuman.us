import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("refuses changed publicist inputs without executing candidate code", () => {
	const root = mkdtempSync(join(tmpdir(), "publicist-inputs-"));

	const script = new URL(
		"../../scripts/og-video/publicist-inputs.mjs",
		import.meta.url,
	).pathname;

	const trusted = join(root, "trusted");
	const candidate = join(root, "candidate");

	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, stdio: "pipe" });

	try {
		mkdirSync(join(trusted, "publicist"), { recursive: true });
		writeFileSync(
			join(trusted, "publicist/config.json"),
			JSON.stringify({ projects: { test: { data: "story.ts" } } }),
		);
		writeFileSync(
			join(trusted, "story.ts"),
			"throw Error('must not execute');",
		);
		git(trusted, "init");
		git(trusted, "add", ".");
		git(
			trusted,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"fixture",
		);
		git(root, "clone", trusted, candidate);

		const run = () =>
			spawnSync(process.execPath, [script, candidate], {
				cwd: trusted,
				encoding: "utf8",
			});

		expect(run().status).toBe(0);
		writeFileSync(join(candidate, "story.ts"), "changed public copy");
		git(candidate, "add", ".");
		git(
			candidate,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"changed",
		);
		expect(run().status).not.toBe(0);
		expect(run().stderr).toContain("Publicist inputs differ");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("requires artifacts for changed preview trees even when manifest hashes claim freshness", () => {
	const root = mkdtempSync(join(tmpdir(), "preview-review-"));

	const script = new URL(
		"../../scripts/og-video/review-required.mjs",
		import.meta.url,
	).pathname;

	const trusted = join(root, "trusted");
	const candidate = join(root, "candidate");

	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, stdio: "pipe" });

	try {
		mkdirSync(join(trusted, "src/data"), { recursive: true });
		writeFileSync(
			join(trusted, "src/data/og-media.json"),
			JSON.stringify({ home: { source: "trusted" } }),
		);
		git(trusted, "init");
		git(trusted, "add", ".");
		git(
			trusted,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"fixture",
		);
		git(root, "clone", trusted, candidate);

		const run = (artifact = "false") =>
			spawnSync(process.execPath, [script, candidate], {
				cwd: trusted,
				encoding: "utf8",
				env: { PATH: process.env.PATH, HAS_ARTIFACT: artifact },
			});

		expect(run().status).toBe(0);
		writeFileSync(
			join(candidate, "src/data/og-media.json"),
			JSON.stringify({ home: { source: "forged-current" } }),
		);
		git(candidate, "add", ".");
		git(
			candidate,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"forged",
		);
		expect(run().status).not.toBe(0);
		expect(run().stderr).toContain("without review artifacts");
		expect(run("true").status).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
