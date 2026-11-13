// Reads the result of one `quint run` so the CI driver cannot pass without checking (scripts/verify-quint.mjs).
// Only the exact result line counts: Quint also prints "[ok] Rust evaluator installed at: ..." the first time it fetches
// its evaluator, and that line says nothing about the model.

/**
 * @param {{ status: number | null, stdout: string, stderr: string }} run
 * @returns {{ kind: "pass" | "violation" | "error", reason: string }}
 *   pass: exit status 0 and the line "[ok] No violation found" and no violation line.
 *   violation: a non-zero exit status, the line "[violation] Found an issue" and the line "error: Invariant violated".
 *   error: anything else (a parse or type error, a crash, a missing evaluator, truncated output).
 */
export function classifyRun(run) {
	// Quint colours its lines when it writes to a terminal.
	const out = `${run.stdout}\n${run.stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
	const hasOk = /^\[ok\] No violation found/m.test(out);
	const hasViolation = /^\[violation\] Found an issue/m.test(out);
	const invariantViolated = /^error: Invariant violated/m.test(out);

	if (run.status === 0 && hasOk && !hasViolation)
		return { kind: "pass", reason: "exit 0 and no violation found" };

	if (
		run.status !== 0 &&
		run.status !== null &&
		hasViolation &&
		invariantViolated &&
		!hasOk
	)
		return { kind: "violation", reason: "an invariant was violated" };

	return {
		kind: "error",
		reason: `exit status ${run.status}; ok line ${hasOk}; violation line ${hasViolation}`,
	};
}

/** The property names inside `val allProperties = and { ... }` of a Quint model. */
export function propertiesOf(modelText) {
	const block = /val allProperties = and \{([^}]*)\}/.exec(modelText);

	if (!block)
		throw new Error("The model has no `val allProperties = and { ... }`.");

	return block[1]
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
}

/** The properties that no mutant is expected to violate. */
export function propertiesWithoutMutant(properties, mutants) {
	const covered = new Set(
		Object.values(mutants).map((mutant) => mutant.property),
	);

	return properties.filter((property) => !covered.has(property));
}
