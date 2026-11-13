import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { fromRevision } from "../../scripts/golden-diff.mjs";

const folder = mkdtempSync(join(tmpdir(), "golden-diff-"));
const fixtures = join(folder, "tests/golden/fixtures");

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: folder, stdio: "ignore" });

const setup = () => {
	mkdirSync(fixtures, { recursive: true });

	for (const args of [
		["init", "-q"],
		["config", "user.email", "test@example.test"],
		["config", "user.name", "Test"],
		["config", "commit.gpgsign", "false"],
	])
		git(...args);

	writeFileSync(join(fixtures, "old.json"), JSON.stringify([{ name: "a" }]));

	writeFileSync(
		join(fixtures, "new.json.gz"),
		gzipSync(JSON.stringify([{ name: "b" }, { name: "c" }])),
	);

	writeFileSync(join(fixtures, "broken.json.gz"), "not gzip at all");
	writeFileSync(join(fixtures, "badplain.json"), "{ nope");

	git("add", "-A");
	git("commit", "-q", "-m", "fixtures");
};

setup();

afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("golden-diff fromRevision", () => {
	it("reads a compressed fixture", () => {
		expect(fromRevision("new", "HEAD", folder)).toEqual([
			{ name: "b" },
			{ name: "c" },
		]);
	});

	it("falls back to the plain .json fixture that existed before compression", () => {
		expect(fromRevision("old", "HEAD", folder)).toEqual([{ name: "a" }]);
	});

	it("reads a fixture that did not exist at the revision as no cases", () => {
		expect(fromRevision("missing", "HEAD", folder)).toEqual([]);
	});

	it("fails on a revision git cannot find, instead of reading no cases", () => {
		expect(() => fromRevision("new", "no-such-branch", folder)).toThrow(
			/"no-such-branch" is not a revision/,
		);
	});

	it("fails on a fixture that cannot be decompressed or parsed", () => {
		expect(() => fromRevision("broken", "HEAD", folder)).toThrow(
			/broken\.json\.gz at HEAD cannot be read/,
		);

		expect(() => fromRevision("badplain", "HEAD", folder)).toThrow(
			/badplain\.json at HEAD cannot be read/,
		);
	});

	it("exits non-zero with a clear message for a bad revision on the command line", () => {
		const script = fileURLToPath(
			new URL("../../scripts/golden-diff.mjs", import.meta.url),
		);

		const run = spawnSync(
			process.execPath,
			[script, "diff", "new", "no-such-branch"],
			{ cwd: folder, encoding: "utf8" },
		);

		expect(run.status).toBe(1);
		expect(run.stderr).toContain('"no-such-branch" is not a revision');
	});
});
