#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { models } from "./lib/quint-mutants.mjs";
import {
	classifyRun,
	propertiesOf,
	propertiesWithoutMutant,
} from "./lib/quint-run.mjs";

// Runs the Quint models listed in scripts/lib/quint-mutants.mjs (docs/verification.md): verification/invoice-events.qnt
// and verification/discount-offers.qnt.
//   node scripts/verify-quint.mjs              the current rule keeps every property, in every model
//   node scripts/verify-quint.mjs mutants      each mutant breaks the property named for it, every equivalent mutant keeps
//                                              them all, and every property of every model has a mutant
//   node scripts/verify-quint.mjs exhaustive [steps]
//                                              by hand: Apalache searches every order up to a step bound (slow)
// The seed is fixed so a run is the same every time; the Quint version is pinned in package.json. Runs are independent,
// so they go in parallel, up to the number of CPUs.

const SEED = "0x1";
const STEPS = "20";

/** Runs `quint` with these arguments to the end, and resolves to its exit status and output. */
function quint(args) {
	return new Promise((resolve) => {
		const child = spawn("quint", args);
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) =>
			resolve({ status: null, stdout, stderr: `${stderr}${error}` }),
		);
		child.on("close", (status) => resolve({ status, stdout, stderr }));
	});
}

const simulate = (model, main, invariant) =>
	quint([
		"run",
		model.file,
		"--main",
		main,
		"--init",
		"init",
		"--step",
		"step",
		"--invariant",
		invariant,
		"--max-steps",
		STEPS,
		"--max-samples",
		model.samples,
		"--seed",
		SEED,
	]);

/** Runs every job, at most `limit` at a time, and resolves to the results in job order. */
async function runAll(jobs, limit) {
	const results = [];
	let next = 0;

	async function worker() {
		while (next < jobs.length) {
			const index = next++;

			results[index] = await jobs[index]();
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, jobs.length) }, () => worker()),
	);

	return results;
}

const mode = process.argv[2] ?? "properties";
let failed = false;

function report(ok, line, result) {
	if (ok) console.log(`ok   ${line}`);
	else {
		failed = true;
		console.log(`FAIL ${line}\n${result.stdout}${result.stderr}`);
	}
}

/** One check: run the module `main` of `model` against `invariant` and expect `kind` ("pass" or "violation"). */
const check = (model, main, invariant, kind, describe) => ({
	model,
	main,
	invariant,
	kind,
	describe,
});

async function runChecks(checks) {
	const results = await runAll(
		checks.map(
			({ model, main, invariant }) =>
				() =>
					simulate(model, main, invariant),
		),
		availableParallelism(),
	);

	checks.forEach(({ kind, describe }, index) => {
		const outcome = classifyRun(results[index]);

		report(
			outcome.kind === kind,
			`${describe} (${outcome.kind}: ${outcome.reason})`,
			results[index],
		);
	});
}

if (mode === "mutants") {
	for (const model of models) {
		const properties = propertiesOf(readFileSync(model.file, "utf8"));

		for (const property of propertiesWithoutMutant(properties, model.mutants))
			report(
				false,
				`${model.file}: no mutant is expected to break ${property}`,
				{
					stdout: "",
					stderr: "",
				},
			);
	}

	await runChecks(
		models.flatMap((model) => [
			...Object.entries(model.mutants).map(([main, { property }]) =>
				check(
					model,
					main,
					property,
					"violation",
					`${main} breaks ${property}, as it must`,
				),
			),
			...model.equivalents.map((main) =>
				check(
					model,
					main,
					"allProperties",
					"pass",
					`${main} keeps every property, as an equivalent mutant must`,
				),
			),
		]),
	);
} else if (mode === "exhaustive") {
	// Apalache: every order up to the bound, not a sample. Needs Java 17 or newer; slow (see docs/verification.md). One at
	// a time: each starts a server on a fixed port.
	const steps = process.argv[3] ?? "7";

	for (const { file, exhaustive } of models)
		for (const main of exhaustive) {
			const result = await quint([
				"verify",
				file,
				"--main",
				main,
				"--init",
				"init",
				"--step",
				"stepOrEnd",
				"--invariant",
				"allProperties",
				"--max-steps",
				steps,
			]);

			report(
				result.status === 0 &&
					/^\[ok\] No violation found/m.test(result.stdout),
				`${main} keeps every property in every order up to ${steps} steps`,
				result,
			);
		}
} else {
	await runChecks(
		models.flatMap((model) =>
			model.current.map((main) =>
				check(
					model,
					main,
					"allProperties",
					"pass",
					`${main} keeps every property`,
				),
			),
		),
	);
}

process.exit(failed ? 1 : 0);
