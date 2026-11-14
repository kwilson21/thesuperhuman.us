import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The golden neutrality report in CI: it only informs (a behaviour fix legitimately changes fixtures), so it fails the
// job for a usage or read error (exit 2) and for nothing else.

const workflow = readFileSync(
	new URL("../../.github/workflows/validate.yml", import.meta.url),
	"utf8",
);

const step = (() => {
	const start = workflow.indexOf("- name: Golden neutrality report");
	const next = workflow.indexOf("\n      - ", start + 1);

	return workflow.slice(start, next === -1 ? undefined : next);
})();

describe("validate.yml golden neutrality report", () => {
	it("exists, on pull requests only", () => {
		expect(step).not.toBe("");
		expect(step).toContain("if: github.event_name == 'pull_request'");
	});

	it("compares the base (first parent of the merge ref) with the merge result, for every fixture", () => {
		expect(step).toContain("pnpm run golden:neutral --all HEAD^1 HEAD");
	});

	it("checks out two commits so that the first parent is there, and nothing more", () => {
		expect(workflow).toMatch(/fetch-depth: 2\b/);
		expect(workflow).not.toMatch(/fetch-depth: 0\b/);
	});

	it("writes the report to the job summary", () => {
		expect(step).toContain('"$GITHUB_STEP_SUMMARY"');
	});

	it("fails the job only on a usage or read error, never on a result that is not neutral", () => {
		expect(step).not.toContain("continue-on-error");
		expect(step).toMatch(/\[ "\$status" -ge 2 \]/);
		expect(step).toMatch(/exit "\$status"/);
		expect(step).not.toMatch(/\[ "\$status" -ne 0 \]/);
	});

	it("runs after the install, and pins no new action by tag", () => {
		expect(
			workflow.indexOf("- name: Golden neutrality report"),
		).toBeGreaterThan(workflow.indexOf("pnpm install --frozen-lockfile"));

		const uses = [...workflow.matchAll(/uses: (\S+)/g)].map(
			(match) => match[1],
		);

		for (const used of uses) expect(used).toMatch(/@[0-9a-f]{40}$/);
	});
});
