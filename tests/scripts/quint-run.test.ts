import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	classifyRun,
	propertiesOf,
	propertiesWithoutMutant,
} from "../../scripts/lib/quint-run.mjs";
import {
	equivalents,
	exhaustive,
	mutants,
	signinCurrent,
	signinMutants,
} from "../../scripts/lib/quint-mutants.mjs";

// Outputs captured from `quint run` 0.33.1.
const passed = `[ok] No violation found (48ms at 1042 traces/second).
Trace length statistics: max=6, min=6, average=6.00
You may increase --max-samples and --max-steps.
Use --verbosity to produce more (or less) output.
Use --seed=0x105e --backend=rust to reproduce.
`;

const violated = `An example execution:

[State 0]
{ row: { at: 0, id: 0, rec: 0, status: "creating" } }

[violation] Found an issue (36ms at 306 traces/second).
Use --verbosity=3 to show executions.
Use --seed=0x6b3 --backend=rust to reproduce.
error: Invariant violated
`;

const evaluatorNoise = `Fetching Rust evaluator v0.7.1...
  Extracting /home/runner/.quint/rust-evaluator-v0.7.1/quint_evaluator-x86_64-unknown-linux-gnu.tar.gz...
  [ok] Rust evaluator installed at: /home/runner/.quint/rust-evaluator-v0.7.1/quint_evaluator
`;

describe("classifyRun", () => {
	it("passes on exit 0 and the no-violation line", () => {
		expect(classifyRun({ status: 0, stdout: passed, stderr: "" }).kind).toBe(
			"pass",
		);
	});

	it("passes when the evaluator was fetched first and the run then found no violation", () => {
		expect(
			classifyRun({ status: 0, stdout: evaluatorNoise + passed, stderr: "" })
				.kind,
		).toBe("pass");
	});

	it("does not pass on the evaluator-install line alone, with any exit status", () => {
		for (const status of [0, 1, null])
			expect(
				classifyRun({ status, stdout: evaluatorNoise, stderr: "" }).kind,
			).toBe("error");
	});

	it("does not pass when the run exits non-zero even if an ok line is printed", () => {
		expect(
			classifyRun({ status: 1, stdout: evaluatorNoise + passed, stderr: "" })
				.kind,
		).not.toBe("pass");
	});

	it("does not pass when a violation line is present, even with exit 0", () => {
		expect(
			classifyRun({ status: 0, stdout: passed + violated, stderr: "" }).kind,
		).not.toBe("pass");
	});

	it("reports a violation on a non-zero exit with the violation and invariant lines", () => {
		expect(classifyRun({ status: 1, stdout: violated, stderr: "" }).kind).toBe(
			"violation",
		);
		expect(classifyRun({ status: 1, stdout: "", stderr: violated }).kind).toBe(
			"violation",
		);
	});

	it("does not report a violation for a parse error, a missing file or a crash", () => {
		const parse = "error: [QNT000] Couldn't unify str and oper\n";
		const missing = "error: file verification/nope.qnt does not exist\n";

		const crash =
			"RangeError: Maximum call stack size exceeded\n    at run (cli.js:1:1)\n";

		for (const output of [parse, missing, crash])
			for (const status of [1, 134, null])
				expect(classifyRun({ status, stdout: "", stderr: output }).kind).toBe(
					"error",
				);
	});

	it("does not report a violation from a violation line without the invariant line or a failing exit", () => {
		const half = "[violation] Found an issue (1ms)\n";

		expect(classifyRun({ status: 1, stdout: half, stderr: "" }).kind).toBe(
			"error",
		);
		expect(classifyRun({ status: 0, stdout: violated, stderr: "" }).kind).toBe(
			"error",
		);
	});

	it("reads output that Quint coloured for a terminal", () => {
		const coloured = "\u001b[32m[ok]\u001b[0m No violation found (3ms)\n";

		expect(classifyRun({ status: 0, stdout: coloured, stderr: "" }).kind).toBe(
			"pass",
		);
	});
});

describe("the mutants of verification/invoice-events.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/invoice-events.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(9);
		expect(propertiesWithoutMutant(properties, mutants)).toEqual([]);
	});

	it("a mutant whose property is not listed is reported", () => {
		expect(
			propertiesWithoutMutant(["a", "b"], { audioX: { property: "a" } }),
		).toEqual(["b"]);
	});

	it("every mutant and equivalent names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import invoiceEvents/gm),
		].map((match) => match[1]);

		const listed = [
			...Object.keys(mutants),
			...equivalents,
			...exhaustive,
			"audio",
			"software",
		];

		expect([...modules].sort()).toEqual([...listed].sort());
	});

	it("every mutant property is one of allProperties", () => {
		const properties: string[] = propertiesOf(model);

		for (const { property } of Object.values<{ property: string }>(mutants))
			expect(properties).toContain(property);
	});
});

describe("the mutants of verification/signin-codes.qnt", () => {
	const model = readFileSync(
		new URL("../../verification/signin-codes.qnt", import.meta.url),
		"utf8",
	);

	it("every property in allProperties has a mutant that must break it", () => {
		const properties: string[] = propertiesOf(model);

		expect(properties.length).toBeGreaterThanOrEqual(7);
		expect(propertiesWithoutMutant(properties, signinMutants)).toEqual([]);

		for (const { property } of Object.values<{ property: string }>(
			signinMutants,
		))
			expect(properties).toContain(property);
	});

	it("every mutant names a module in the model, and every module is listed", () => {
		const modules = [
			...model.matchAll(/^module (\w+) \{ import signinCodes/gm),
		].map((match) => match[1]);

		expect([...modules].sort()).toEqual(
			[...Object.keys(signinMutants), ...signinCurrent].sort(),
		);
	});
});
