#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { equivalents, exhaustive, mutants } from "./lib/quint-mutants.mjs";
import {
	classifyRun,
	propertiesOf,
	propertiesWithoutMutant,
} from "./lib/quint-run.mjs";

// Runs the Quint model in verification/invoice-events.qnt (docs/verification.md).
//   node scripts/verify-quint.mjs              the current rule keeps every property, for both domains
//   node scripts/verify-quint.mjs mutants      each mutant breaks the property named below, and every property has one
//   node scripts/verify-quint.mjs exhaustive   by hand: Apalache searches every order up to a step bound (slow)
// The seed is fixed so a run is the same every time; the Quint version is pinned in package.json.

const MODEL = "verification/invoice-events.qnt";
const SEED = "0x1";
const STEPS = "20";
const SAMPLES = "100000";

const current = ["audio", "software"];

function quint(args) {
	const result = spawnSync("quint", args, { encoding: "utf8" });

	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function run(main, invariant) {
	return quint([
		"run",
		MODEL,
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
		SAMPLES,
		"--seed",
		SEED,
	]);
}

const mode = process.argv[2] ?? "properties";
let failed = false;

function report(ok, line, output) {
	if (ok) console.log(`ok   ${line}`);
	else {
		failed = true;
		console.log(`FAIL ${line}\n${output}`);
	}
}

if (mode === "mutants") {
	const properties = propertiesOf(readFileSync(MODEL, "utf8"));

	for (const property of propertiesWithoutMutant(properties, mutants))
		report(false, `no mutant is expected to break ${property}`, "");

	for (const [main, { property }] of Object.entries(mutants)) {
		const result = run(main, property);
		const { kind, reason } = classifyRun(result);

		report(
			kind === "violation",
			`${main} breaks ${property}, as it must (${kind}: ${reason})`,
			`${result.stdout}${result.stderr}`,
		);
	}

	for (const main of equivalents) {
		const result = run(main, "allProperties");
		const { kind, reason } = classifyRun(result);

		report(
			kind === "pass",
			`${main} keeps every property, as an equivalent mutant must (${kind}: ${reason})`,
			`${result.stdout}${result.stderr}`,
		);
	}
} else if (mode === "exhaustive") {
	// Apalache: every order up to the bound, not a sample. Needs Java 17 or newer; slow (see docs/verification.md).
	const steps = process.argv[3] ?? "9";

	for (const main of exhaustive) {
		const result = quint([
			"verify",
			MODEL,
			"--main",
			main,
			"--init",
			"init",
			"--step",
			"step",
			"--invariant",
			"allProperties",
			"--max-steps",
			steps,
		]);

		const ok =
			result.status === 0 && /^\[ok\] No violation found/m.test(result.stdout);

		report(
			ok,
			`${main} keeps every property in every order up to ${steps} steps`,
			`${result.stdout}${result.stderr}`,
		);
	}
} else {
	for (const main of current) {
		const result = run(main, "allProperties");
		const { kind, reason } = classifyRun(result);

		report(
			kind === "pass",
			`${main} keeps every property (${reason})`,
			`${result.stdout}${result.stderr}`,
		);
	}
}

process.exit(failed ? 1 : 0);
