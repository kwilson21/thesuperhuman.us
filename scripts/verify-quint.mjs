#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Runs the Quint model in verification/invoice-events.qnt (docs/verification.md).
//   node scripts/verify-quint.mjs          the current rule must keep every property, for both domains
//   node scripts/verify-quint.mjs mutants  each mutant (a real bug, or a guard removed) must break its property
// The seed is fixed so a run is the same every time; the Quint version is pinned in package.json.

const MODEL = "verification/invoice-events.qnt";
const SEED = "0x1";
const STEPS = "14";
const SAMPLES = "200000";

const current = ["audio", "software"];

// module name -> the property its bug must break
const mutants = {
	audioOldRule: "moneyNotLost",
	softwareOldRule: "moneyNotLost",
	audioStaleGuard: "moneyNotLost",
	softwareStaleGuard: "moneyNotLost",
	audioNoIdPin: "idNeverOverwritten",
	softwareNoIdPin: "idNeverOverwritten",
	audioNoTimeGuard: "noStaleOverwrite",
	softwareNoTimeGuard: "noStaleOverwrite",
	audioOverwritePaid: "paidAbsorbing",
	softwareOverwritePaid: "paidAbsorbing",
};

function run(main, invariant) {
	const result = spawnSync(
		"quint",
		[
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
			"--verbosity",
			"1",
		],
		{ encoding: "utf8" },
	);

	return {
		ok: result.stdout.includes("[ok]"),
		violated: result.stdout.includes("[violation]"),
		output: `${result.stdout}${result.stderr}`,
	};
}

const mode = process.argv[2] ?? "properties";
let failed = false;

if (mode === "mutants") {
	for (const [main, invariant] of Object.entries(mutants)) {
		const { violated, output } = run(main, invariant);

		if (violated) console.log(`ok   ${main} breaks ${invariant}, as it must`);
		else {
			failed = true;
			console.log(`FAIL ${main} did not break ${invariant}\n${output}`);
		}
	}
} else {
	for (const main of current) {
		const { ok, output } = run(main, "allProperties");

		if (ok) console.log(`ok   ${main} keeps every property`);
		else {
			failed = true;
			console.log(`FAIL ${main} broke a property\n${output}`);
		}
	}
}

process.exit(failed ? 1 : 0);
