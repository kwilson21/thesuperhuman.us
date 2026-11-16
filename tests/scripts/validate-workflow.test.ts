import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
	new URL("../../.github/workflows/validate.yml", import.meta.url),
	"utf8",
);

const job = (name: string) =>
	workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z]+:\n/)[0] ?? "";

describe("parallel Validate retains every release gate", () => {
	it("keeps candidate checks separate from trusted validate and rejects skipped, cancelled and failed lanes", () => {
		expect(job("candidate-checks")).toContain("if: ${{ always() }}");
		expect(job("candidate-checks")).toContain(
			"needs: [quality, contracts, quint, tests, build]",
		);
		expect(job("candidate-checks")).toContain("RESULTS: ${{ toJSON(needs) }}");
		expect(job("candidate-checks")).toContain(
			'length == 5 and all(.[]; .result == "success")',
		);
		expect(workflow).not.toMatch(
			/continue-on-error|paths-ignore|pull_request_target/,
		);
		expect(workflow).toContain("contents: read");
		expect(workflow).toContain("\ncache-mode: read\n");
	});
	it("executes the aggregate predicate against success and every non-success outcome", () => {
		const predicate = /jq -e '([^']+)'/.exec(job("candidate-checks"))?.[1];
		expect(predicate).toBeDefined();

		if (!predicate) throw new Error("Aggregate predicate missing");

		const success = Object.fromEntries(
			["quality", "contracts", "quint", "tests", "build"].map((name) => [
				name,
				{ result: "success" },
			]),
		);

		const run = (results: Record<string, { result?: string }>) => {
			const result = spawnSync("jq", ["-e", predicate], {
				input: JSON.stringify(results),
				encoding: "utf8",
			});

			expect(result.error).toBeUndefined();

			return result.status;
		};

		expect(run(success)).toBe(0);

		for (const result of ["failure", "cancelled", "skipped", "", "unknown"])
			expect(run({ ...success, tests: { result } })).not.toBe(0);
		const { tests: omitted, ...missing } = success;
		expect(omitted).toBeDefined();
		expect(run(missing)).not.toBe(0);
		expect(run({ ...success, tests: {} })).not.toBe(0);
	});
	it("runs lint, format, types, proof and the complete test partition", () => {
		for (const command of ["lint", "format:check", "check"])
			expect(job("quality")).toContain(`pnpm run ${command}`);
		expect(job("contracts")).toContain("pnpm run verify:dafny");
		expect(job("quint")).toContain("pnpm run verify:quint:all");
		expect(job("quint")).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
		expect(job("quint")).toContain("QUINT_SHARD: ${{ matrix.shard }}/8");
		expect(job("tests")).toContain("shard: [1, 2, 3, 4, 5, 6]");
		expect(job("tests")).toContain("pnpm test --shard=${{ matrix.shard }}/6");

		for (const flag of ["GOLDEN_VERIFY_DIGESTS", "GOLDEN_VERIFY_COUNTS"])
			expect(job("tests")).toContain(`${flag}: "1"`);

		for (const name of ["quint", "tests"])
			expect(job(name)).toContain("fail-fast: false");
	});
	it("preserves pinned verified evaluator/proof binaries and setup in every work lane", () => {
		for (const name of ["quality", "contracts", "quint", "tests", "build"]) {
			const lane = job(name);
			expect(lane).toContain("persist-credentials: false");
			expect(lane).toContain("node-version-file: .nvmrc");
			expect(lane).toContain("pnpm install --frozen-lockfile");
			expect(lane).not.toContain("cache: pnpm");
		}

		expect(job("contracts")).toContain(
			"b21575395f2fe3dbcaca09a8219fe29c99d248134e516e95dc3f0c3687d16c27",
		);

		for (const name of ["quint", "tests"]) {
			expect(job(name)).toContain(
				"ce0502bdef65dc26c242a9e56379a9bb26de6f3db38f0e3989339d46a542f5eb",
			);
			expect(job(name)).toContain('echo "QUINT_HOME=$home" >> "$GITHUB_ENV"');
		}
	});
	it("builds and checks that same output, without private credentials", () => {
		const lane = job("build");
		expect(lane.indexOf("pnpm exec astro build")).toBeLessThan(
			lane.indexOf(
				"pnpm exec vitest run tests/architecture/client-bundle.test.ts",
			),
		);
		expect(lane).toContain('REQUIRE_CLIENT_BUNDLE: "1"');
		expect(workflow).not.toContain("PUBLICIST_PRIVATE_TOKEN");
		expect(workflow).not.toContain("statuses: write");
		expect(job("candidate-checks")).not.toContain("actions/checkout");

		const trusted = readFileSync(
			".github/workflows/validation-finalize.yml",
			"utf8",
		);

		expect(trusted).toContain(
			"PUBLICIST_PRIVATE_TOKEN: ${{ secrets.PUBLICIST_PRIVATE_TOKEN }}",
		);
		expect(trusted).toContain("workflow_run:");
	});
	it("performs global mutant-coverage validation before selecting a shard", () => {
		const driver = readFileSync(
			new URL("../../scripts/verify-quint.mjs", import.meta.url),
			"utf8",
		);

		expect(driver).toContain(
			"await runChecks([...propertyChecks(), ...mutantChecks()])",
		);
		expect(driver).toContain(
			"propertiesWithoutMutant(properties, model.mutants)",
		);
		expect(driver).toContain("const checks = selectChecks(allChecks, shard)");
		expect(driver).toContain('const SEED = "0x1"');
		expect(driver).toContain("samplesFor(model, kind)");
		expect(driver).toContain("stepsFor(model)");
	});
});
