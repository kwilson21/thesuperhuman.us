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
//   node scripts/verify-quint.mjs all          both of the above in one pool of runs (what CI runs)
//   node scripts/verify-quint.mjs exhaustive [steps]
//                                              by hand: Apalache searches every order up to a step bound (slow)
// The seed is fixed so a run is the same every time; the Quint version is pinned in package.json. Runs are independent,
// so they go in parallel, up to the number of CPUs (or QUINT_JOBS), longest first. Each line ends with its run time.

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

			const started = performance.now();

			results[index] = {
				...(await jobs[index]()),
				seconds: (performance.now() - started) / 1000,
			};
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, jobs.length) }, () => worker()),
	);

	return results;
}

const mode = process.argv[2] ?? "properties";
// How many runs at once: every CPU, or QUINT_JOBS (to see locally what a smaller CI runner would take).
const jobs = Number(process.env.QUINT_JOBS) || availableParallelism();
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

/**
 * Runs the checks, longest first, and reports them in the order given. A check that must pass makes every one of its
 * random runs; a mutant stops at its first violation, which comes within seconds. So the runs that must pass start first,
 * the larger sample counts before the smaller, and the quick mutants fill the cores they leave free; started last, a long
 * run would leave the other cores idle at the end.
 */
async function runChecks(checks) {
	const order = checks
		.map((check, index) => ({ check, index }))
		.sort(
			(a, b) =>
				Number(b.check.kind === "pass") - Number(a.check.kind === "pass") ||
				Number(b.check.model.samples) - Number(a.check.model.samples),
		);

	const started = await runAll(
		order.map(
			({ check: { model, main, invariant } }) =>
				() =>
					simulate(model, main, invariant),
		),
		jobs,
	);

	const results = [];

	order.forEach(({ index }, position) => {
		results[index] = started[position];
	});

	checks.forEach(({ kind, describe }, index) => {
		const outcome = classifyRun(results[index]);

		report(
			outcome.kind === kind,
			`${describe} (${outcome.kind}: ${outcome.reason}; ${results[index].seconds.toFixed(1)} s)`,
			results[index],
		);
	});
}

/** Every model's runs that must keep every property. */
const propertyChecks = () =>
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
	);

/** Every mutant, which must break the property named for it, and every equivalent mutant, which must keep them all. */
function mutantChecks() {
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

	return models.flatMap((model) => [
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
	]);
}

if (mode === "all") {
	// CI: both kinds of check in one pool, so no core waits for the slowest run of one kind before the next kind starts.
	await runChecks([...propertyChecks(), ...mutantChecks()]);
} else if (mode === "mutants") {
	await runChecks(mutantChecks());
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
	await runChecks(propertyChecks());
}

process.exit(failed ? 1 : 0);
