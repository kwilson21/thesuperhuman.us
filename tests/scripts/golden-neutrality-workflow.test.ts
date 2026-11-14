import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The golden neutrality workflow: it reports on every pull request, and it FAILS a pull request that carries the
// `conversion` label unless every case is neutral. It is its own workflow so that adding or removing a label re-runs only
// this lightweight job and never cancels or repeats the full validate run.

const read = (name: string) =>
	readFileSync(
		new URL(`../../.github/workflows/${name}`, import.meta.url),
		"utf8",
	);

const workflow = read("golden-neutrality.yml");
const validate = read("validate.yml");

describe("golden-neutrality.yml", () => {
	it("runs on pull requests only, and again when a label is added or removed", () => {
		expect(workflow).toMatch(
			/on:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened, labeled, unlabeled\]/,
		);

		expect(workflow).not.toMatch(/\n {2}push:/);
		expect(workflow).not.toContain("pull_request_target");
	});

	it("reads the label with an expression that yields true or false, never through the shell line", () => {
		expect(workflow).toContain(
			"CONVERSION: ${{ contains(github.event.pull_request.labels.*.name, 'conversion') }}",
		);

		const run = workflow.slice(workflow.indexOf("run: |"));

		expect(run).not.toContain("${{");
		expect(run).toContain('"$CONVERSION"');
		expect(
			workflow
				.match(/\$\{\{[^}]*\}\}/g)
				?.every(
					(expression) =>
						!/github\.event\.pull_request\.(title|body|head|labels\[)/.test(
							expression,
						),
				),
		).toBe(true);
	});

	it("compares the base branch tip (the first parent of the merge ref) with the merge result, for every fixture", () => {
		expect(workflow).toContain(
			"node scripts/golden-neutral.mjs --all HEAD^1 HEAD",
		);
		expect(workflow).toMatch(/fetch-depth: 2\b/);
		expect(workflow).not.toMatch(/fetch-depth: 0\b/);
	});

	it("writes the report to the job summary", () => {
		expect(workflow).toContain('"$GITHUB_STEP_SUMMARY"');
	});

	it("fails on a usage or read error, and on a result that is not neutral only when the pull request carries the label", () => {
		expect(workflow).not.toContain("continue-on-error");
		expect(workflow).toMatch(/\[ "\$status" -ge 2 \]/);
		expect(workflow).toMatch(
			/\[ "\$CONVERSION" = "true" \] && \[ "\$status" -ne 0 \]/,
		);
	});

	it("has read-only permissions, its own concurrency group, and pins every action by commit", () => {
		expect(workflow).toMatch(/permissions:\n {2}contents: read/);
		expect(workflow).toContain("concurrency:\n  group: golden-neutrality-");

		const uses = [...workflow.matchAll(/uses: (\S+)/g)].map(
			(match) => match[1],
		);

		expect(uses.length).toBeGreaterThan(0);

		for (const used of uses) expect(used).toMatch(/@[0-9a-f]{40}$/);
	});

	it("needs no install: the tool uses Node and git only", () => {
		expect(workflow).not.toContain("pnpm install");
	});
});

describe("validate.yml", () => {
	it("is unchanged by the label: it still runs on pull requests (default types) and on pushes to main only", () => {
		expect(validate).toMatch(
			/on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/,
		);
		expect(validate).not.toContain("labeled");
		expect(validate).not.toContain("golden:neutral");
	});
});
