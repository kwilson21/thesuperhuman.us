import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { stagePublicist } from "../../scripts/og-video/publicist-inputs.mjs";
import { agentsBlock } from "../../scripts/publicist/lib.mjs";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "publicist-stage-test-"));
	const trusted = join(root, "trusted");
	const candidate = join(root, "candidate");
	mkdirSync(trusted);

	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, stdio: "pipe" });

	const put = (cwd: string, path: string, text: string) => {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), text);
	};

	git(trusted, "init", "-q");
	git(trusted, "config", "user.name", "Test");
	git(trusted, "config", "user.email", "test@example.invalid");
	const skill = readFileSync(".agents/skills/publicist/SKILL.md", "utf8");

	for (const name of ["gate.mjs", "lib.mjs"])
		put(
			trusted,
			`scripts/publicist/${name}`,
			readFileSync(`scripts/publicist/${name}`, "utf8"),
		);
	put(trusted, ".agents/skills/publicist/SKILL.md", skill);
	put(
		trusted,
		"publicist/config.json",
		JSON.stringify({
			privateRepo: "owner/private",
			projects: { example: { data: "src/data/story.ts", preexisting: [] } },
		}),
	);
	put(trusted, "AGENTS.md", agentsBlock(skill));
	put(trusted, "src/data/story.ts", "export const entries = [];\n");
	git(trusted, "add", ".");
	git(trusted, "commit", "-qm", "fixture");
	git(root, "clone", "-q", trusted, candidate);
	git(candidate, "config", "user.name", "Test");
	git(candidate, "config", "user.email", "test@example.invalid");

	const commit = () => {
		git(candidate, "add", "-A");
		git(candidate, "commit", "-qm", "candidate");
	};

	return {
		root,
		trusted,
		candidate,
		git,
		put,
		commit,
		close: () => rmSync(root, { recursive: true, force: true }),
	};
}

describe("trusted publicist staging", () => {
	it("accepts changed story/AGENTS/queue data, runs trusted policy, never executes candidate data", () => {
		const f = fixture();
		let stage: string | undefined;

		try {
			f.put(
				f.candidate,
				"AGENTS.md",
				`${readFileSync(join(f.candidate, "AGENTS.md"), "utf8")}\nOrdinary instruction change.\n`,
			);
			f.put(
				f.candidate,
				"src/data/story.ts",
				"throw Error('must not execute'); export const entries = [{ id: 'new-entry' }];\n",
			);
			f.put(
				f.candidate,
				"publicist/queue/new.md",
				"---\nsource: new-entry\n---\nA draft.\n",
			);
			f.commit();
			stage = stagePublicist(f.trusted, f.candidate);
			expect(readFileSync(join(stage, "src/data/story.ts"), "utf8")).toContain(
				"must not execute",
			);
			expect(readFileSync(join(stage, "AGENTS.md"), "utf8")).toContain(
				"Ordinary instruction change",
			);
			expect(
				readFileSync(join(stage, "publicist/queue/new.md"), "utf8"),
			).toContain("new-entry");

			const result = spawnSync(
				process.execPath,
				[join(stage, "scripts/publicist/gate.mjs")],
				{
					cwd: stage,
					encoding: "utf8",
					env: { PATH: process.env.PATH, CI: "true" },
				},
			);

			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("PUBLICIST_PRIVATE_TOKEN is not set");
			expect(result.stderr).not.toContain("Error: must not execute");
		} finally {
			if (stage) rmSync(stage, { recursive: true, force: true });
			f.close();
		}
	});
	it.each([
		"publicist/config.json",
		"scripts/publicist/gate.mjs",
		".agents/skills/publicist/SKILL.md",
	])("rejects changed policy %s", (path) => {
		const f = fixture();

		try {
			f.put(f.candidate, path, "malicious replacement");
			f.commit();
			expect(() => stagePublicist(f.trusted, f.candidate)).toThrow(
				/policy or validators changed/,
			);
		} finally {
			f.close();
		}
	});
	it("rejects a symlink instead of following it with private credentials", () => {
		const f = fixture();

		try {
			unlinkSync(join(f.candidate, "src/data/story.ts"));
			symlinkSync("/etc/passwd", join(f.candidate, "src/data/story.ts"));
			f.commit();
			expect(() => stagePublicist(f.trusted, f.candidate)).toThrow(
				/regular Git blob/,
			);
		} finally {
			f.close();
		}
	});
	it("uses committed blobs, not modified checkout bytes", () => {
		const f = fixture();
		let stage: string | undefined;

		try {
			f.put(f.candidate, "src/data/story.ts", "uncommitted replacement");
			stage = stagePublicist(f.trusted, f.candidate);
			expect(readFileSync(join(stage, "src/data/story.ts"), "utf8")).toBe(
				"export const entries = [];\n",
			);
		} finally {
			if (stage) rmSync(stage, { recursive: true, force: true });
			f.close();
		}
	});
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
		mkdirSync(join(trusted, "scripts/og-video/scenes"), { recursive: true });
		writeFileSync(
			join(trusted, "scripts/og-video/scenes/home.html"),
			"fixture",
		);
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
