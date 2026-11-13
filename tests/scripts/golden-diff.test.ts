import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
