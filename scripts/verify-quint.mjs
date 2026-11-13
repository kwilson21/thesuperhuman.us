#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import {
	equivalents,
	exhaustive,
	mutants,
	signinCurrent,
	signinMutants,
} from "./lib/quint-mutants.mjs";
import {
	classifyRun,
	propertiesOf,
	propertiesWithoutMutant,
} from "./lib/quint-run.mjs";

// Runs the Quint models in verification/invoice-events.qnt and verification/signin-codes.qnt (docs/verification.md).
//   node scripts/verify-quint.mjs              the current rule keeps every property, for both domains
//   node scripts/verify-quint.mjs mutants      each mutant breaks the property named for it, every equivalent mutant keeps
//                                              them all, and every property has a mutant
//   node scripts/verify-quint.mjs exhaustive [steps]
//                                              by hand: Apalache searches every order up to a step bound (slow)
// The seed is fixed so a run is the same every time; the Quint version is pinned in package.json. Runs are independent,
// so they go in parallel, up to the number of CPUs.

const MODEL = "verification/invoice-events.qnt";
const SIGNIN_MODEL = "verification/signin-codes.qnt";
const SEED = "0x1";
const STEPS = "20";
const SAMPLES = "100000";
// The sign-in model has a larger state, so it runs fewer samples (about 10 s for the pass run).
const SIGNIN_SAMPLES = "30000";

const current = ["audio", "software"];

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

const simulate = (main, invariant, model) =>
	quint([
		"run",
		model,
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
		model === SIGNIN_MODEL ? SIGNIN_SAMPLES : SAMPLES,
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

/** One check: run the model `main` against `invariant` and expect `kind` ("pass" or "violation"). */
const check = (main, invariant, kind, describe, model = MODEL) => ({
	model,
	main,
	invariant,
	kind,
	describe,
});

async function runChecks(checks) {
	const results = await runAll(
		checks.map(
			({ main, invariant, model }) =>
				() =>
					simulate(main, invariant, model),
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
	const properties = propertiesOf(readFileSync(MODEL, "utf8"));

	for (const property of propertiesWithoutMutant(properties, mutants))
		report(false, `no mutant is expected to break ${property}`, {
			stdout: "",
			stderr: "",
		});

	const signinProperties = propertiesOf(readFileSync(SIGNIN_MODEL, "utf8"));

	for (const property of propertiesWithoutMutant(
		signinProperties,
		signinMutants,
	))
		report(false, `no sign-in mutant is expected to break ${property}`, {
			stdout: "",
			stderr: "",
		});

	await runChecks([
		...Object.entries(mutants).map(([main, { property }]) =>
			check(
				main,
				property,
				"violation",
				`${main} breaks ${property}, as it must`,
			),
		),
		...Object.entries(signinMutants).map(([main, { property }]) =>
			check(
				main,
				property,
				"violation",
				`${main} breaks ${property}, as it must`,
				SIGNIN_MODEL,
			),
		),
		...equivalents.map((main) =>
			check(
				main,
				"allProperties",
				"pass",
				`${main} keeps every property, as an equivalent mutant must`,
			),
		),
	]);
} else if (mode === "exhaustive") {
	// Apalache: every order up to the bound, not a sample. Needs Java 17 or newer; slow (see docs/verification.md). One at
	// a time: each starts a server on a fixed port.
	const steps = process.argv[3] ?? "7";

	for (const main of exhaustive) {
		const result = await quint([
			"verify",
			MODEL,
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
			result.status === 0 && /^\[ok\] No violation found/m.test(result.stdout),
			`${main} keeps every property in every order up to ${steps} steps`,
			result,
		);
	}
} else {
	await runChecks([
		...current.map((main) =>
			check(main, "allProperties", "pass", `${main} keeps every property`),
		),
		...signinCurrent.map((main) =>
			check(
				main,
				"allProperties",
				"pass",
				`${main} keeps every property`,
				SIGNIN_MODEL,
			),
		),
	]);
}

process.exit(failed ? 1 : 0);
