import { spawnSync, execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { localGraph } from "../helpers/import-graph";

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

const scriptsDir = fileURLToPath(new URL("../../scripts/", import.meta.url));

const stepScript = (() => {
	const start = workflow.indexOf("        run: |\n          set +e");

	return workflow
		.slice(start + "        run: |\n".length)
		.split("\n")
		.map((line) => line.slice(10))
		.join("\n");
})();

const folders: string[] = [];

afterAll(() => {
	for (const folder of folders)
		rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs the workflow's report step in a throwaway repository of two commits. The base commit holds the comparison scripts
 * (the real ones, `baseTool` as the text of a broken golden-neutral.mjs, or none with `null`) and one older-recorder
 * fixture; the head commit changes a file, and the fixture too when `change` is set.
 */
function runStep(options: {
	baseTool?: string | null;
	conversion: string;
	change?: boolean;
}) {
	const folder = mkdtempSync(join(tmpdir(), "neutrality-step-"));

	folders.push(folder);
	mkdirSync(join(folder, "tests/golden/fixtures"), { recursive: true });
	mkdirSync(join(folder, "scripts"));

	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: folder, stdio: "ignore" });

	for (const args of [
		["init", "-q"],
		["config", "user.email", "test@example.test"],
		["config", "user.name", "Test"],
		["config", "commit.gpgsign", "false"],
	])
		git(...args);

	const fixture = (effect: string) =>
		gzipSync(
			JSON.stringify([
				{
					name: "legacy",
					answers: [],
					effects: [{ step: 0, kv: "K", op: effect, key: "k" }],
				},
			]),
		);

	writeFileSync(
		join(folder, "tests/golden/fixtures/legacy.json.gz"),
		fixture("get"),
	);

	if (options.baseTool !== null)
		for (const file of [
			"golden-neutral.mjs",
			"golden-diff.mjs",
			"ran-directly.mjs",
		])
			cpSync(join(scriptsDir, file), join(folder, "scripts", file));

	if (options.baseTool !== undefined && options.baseTool !== null)
		writeFileSync(join(folder, "scripts/golden-neutral.mjs"), options.baseTool);

	git("add", "-A");
	git("commit", "-q", "-m", "base");

	if (options.baseTool === null)
		for (const file of [
			"golden-neutral.mjs",
			"golden-diff.mjs",
			"ran-directly.mjs",
		])
			cpSync(join(scriptsDir, file), join(folder, "scripts", file));

	writeFileSync(join(folder, "CHANGED"), "x");

	if (options.change)
		writeFileSync(
			join(folder, "tests/golden/fixtures/legacy.json.gz"),
			fixture("put"),
		);

	git("add", "-A");
	git("commit", "-q", "-m", "head");

	const got = spawnSync("bash", ["-c", stepScript], {
		cwd: folder,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
			RUNNER_TEMP: folder,
			GITHUB_STEP_SUMMARY: join(folder, "summary.md"),
			CONVERSION: options.conversion,
		},
	});

	return { status: got.status, output: `${got.stdout}${got.stderr}` };
}

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
		expect(workflow).toContain('node "$tool" --all HEAD^1 HEAD');
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

	it("runs the BASE branch's copy of the tool and every local module it imports, falling back to the pull request's own only when the base has none, and says which ran", () => {
		expect(workflow).toContain(
			"git cat-file -e HEAD^1:scripts/golden-neutral.mjs",
		);
		expect(workflow).toContain('git show "HEAD^1:scripts/$file"');
		expect(workflow).toContain('tool="$tool_dir/golden-neutral.mjs"');
		expect(workflow).toContain('node "$tool" --all HEAD^1 HEAD');
		expect(workflow).toContain("the base branch's copy, extracted from HEAD^1");
		expect(workflow).toContain(
			"the pull request's copy (the base branch has no golden-neutral.mjs)",
		);
		expect(workflow).toContain('echo "Comparison tool: $copy"');
	});

	it("extracts every local module the tool imports, derived from its real import graph", () => {
		const listed =
			workflow.match(/for file in ([^;]+); do/)?.[1]?.split(" ") ?? [];

		const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));
		const graph = localGraph(`${scripts}golden-neutral.mjs`);

		// Every local file the tool loads must sit directly in scripts/ and be extracted.
		for (const file of graph.files) {
			expect(dirname(file)).toBe(scripts.replace(/\/$/, ""));
			expect(listed).toContain(basename(file));
		}

		// And it may load nothing that needs an install: Node built-ins only.
		for (const other of graph.others) expect(other).toMatch(/^node:/);
	});

	it("ends with a failure, not a pass, when the base copy cannot run (a module it imports is missing)", () => {
		const got = runStep({
			baseTool: 'import "./not-extracted.mjs";\n',
			conversion: "false",
		});

		expect(got.status).toBe(3);
		expect(got.output).toContain("ended without a verdict");
	});

	it("also fails a labelled pull request in that case", () => {
		expect(
			runStep({
				baseTool: 'import "./not-extracted.mjs";\n',
				conversion: "true",
			}).status,
		).toBe(3);
	});

	it("takes the LAST line of the output as the verdict: a verdict line earlier in the output is not enough", () => {
		const early =
			'console.log("golden:neutral: NEUTRAL");\nconsole.log("a crash report follows");\n';

		expect(runStep({ baseTool: early, conversion: "false" }).status).toBe(3);

		const late =
			'console.log("golden:neutral: NOT NEUTRAL");\nconsole.log("");\nconsole.log("   ");\nprocess.exit(1);\n';

		// A verdict that is the last non-empty line passes the check even with blank lines after it.
		expect(runStep({ baseTool: late, conversion: "false" }).status).toBe(
			1 === 1 ? 0 : 0,
		);
	});

	it("a verdict that disagrees with the exit code is a failure", () => {
		const lying = 'console.log("golden:neutral: NEUTRAL");\nprocess.exit(1);\n';

		expect(runStep({ baseTool: lying, conversion: "false" }).status).toBe(3);
	});

	it("passes a report-only run when the tool reaches its own verdict, whatever it is", () => {
		const real = runStep({ baseTool: undefined, conversion: "false" });

		expect(real.status).toBe(0);
		expect(real.output).toContain(
			"Comparison tool: the base branch's copy, extracted from HEAD^1",
		);
		expect(real.output).toContain("golden:neutral: identical, 1 cases");
	});

	it("falls back to the pull request's own copy only when the base has none, and says so", () => {
		const got = runStep({ baseTool: null, conversion: "false" });

		expect(got.status).toBe(0);
		expect(got.output).toContain(
			"the pull request's copy (the base branch has no golden-neutral.mjs)",
		);
	});

	it("a labelled pull request fails when the tool says NOT NEUTRAL, and an unlabelled one passes", () => {
		const changed = { baseTool: undefined, conversion: "true", change: true };

		expect(runStep(changed).status).toBe(1);
		expect(runStep({ ...changed, conversion: "false" }).status).toBe(0);
	});

	it("needs no install: the tool uses Node and git only", () => {
		expect(workflow).not.toContain("pnpm install");
	});
});

describe("validate.yml", () => {
	const testStep = validate.slice(validate.indexOf("      - run: pnpm test\n"));

	it("runs the golden harness's self-checks in the test step", () => {
		const env = testStep.slice(0, testStep.indexOf("\n      - ", 10));

		expect(env).toContain('GOLDEN_VERIFY_DIGESTS: "1"');
		expect(env).toContain('GOLDEN_VERIFY_COUNTS: "1"');
	});

	it("is unchanged by the label: it still runs on pull requests (default types) and on pushes to main only", () => {
		expect(validate).toMatch(
			/on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/,
		);
		expect(validate).not.toContain("labeled");
		expect(validate).not.toContain("golden:neutral");
	});
});
