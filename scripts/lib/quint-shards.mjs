// Scheduling hints from passing Validate run 43776550129; the sign-in hints from run 45058915252 (PR #360). For
// signinOpenIgnoresExpiry, which the page-open step added, a local timing scaled by that run's ratio for
// signinSweepUnguarded before the step (31.9 s there, 27.0 s locally). For signinSweepUnguarded since the step
// (found in about 4,200 runs), a local timing (5.8 s) scaled by that run's ratio for signinChargeAnyVersion (about
// 5,170 runs), whose counterexample the step did not change (8.9 s there, 7.3 s locally, one run at a time). The
// signing extension of the discount model (2026-11-23) turned discountAcceptedOnlyCheck from a run that must pass into a
// mutant found in about 9,700 of its runs, so its hint moves to violationSeconds with about its old time; the hints for
// the slower new mutants are local timings with four runs at a time. The discount model's runs that must pass (discount
// and the equivalent discountSecondBatchNoSendingGuard) take 80 steps since the signing extension: their hints are the
// earlier CI times scaled by the local ratio at 80 steps to 50 (167 s against about 93 s, three runs at a time). They
// never change a check's inputs.
const passSeconds = {
	audio: 96.4,
	software: 68.2,
	discount: 190.5,
	signin: 81,
	signinSpent: 75,
	signinAcceptNoUsed: 41,
	music: 9.8,
	inquiry: 13.6,
	budget: 7.5,
	publication: 11,
	agreementLink: 13.8,
	audioNoDecision: 95.5,
	softwareNoDupDetection: 73.5,
	softwareNoReadUnmatched: 72.7,
	discountSecondBatchNoSendingGuard: 193.2,
};

// A mutant stops at its first violation, which most find within a few seconds (3 unless named here).
const violationSeconds = {
	signinOpenIgnoresExpiry: 34,
	signinChargeAnyVersion: 9,
	signinSweepUnguarded: 7,
	discountAcceptedOnlyCheck: 97,
	discountAbandonDepositAtRead: 11,
	discountAbandonNoStatusGuard: 7,
};

/** A missing shard means the original complete local run; malformed input fails closed. */
export function parseShard(value) {
	if (value === undefined) return null;
	const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);

	if (!match)
		throw new Error("QUINT_SHARD must be index/total, both positive integers");
	const index = Number(match[1]);
	const total = Number(match[2]);

	if (
		!Number.isSafeInteger(index) ||
		!Number.isSafeInteger(total) ||
		index > total ||
		total > 64
	)
		throw new Error("QUINT_SHARD requires 1 <= index <= total <= 64");

	return { index, total };
}

/** Partition all checks exactly once; unknown future checks are included, not filtered out. */
export function partitionChecks(checks, total) {
	if (
		!Number.isInteger(total) ||
		total < 1 ||
		total > checks.length ||
		total > 64
	)
		throw new Error(
			"Shard count must be between one and the number of checks (maximum 64)",
		);

	const buckets = Array.from({ length: total }, () => ({
		seconds: 0,
		entries: [],
	}));

	const ordered = checks
		.map((check, index) => ({
			check,
			index,
			seconds:
				check.kind === "pass"
					? (passSeconds[check.main] ?? 30)
					: (violationSeconds[check.main] ?? 3),
		}))
		.sort((a, b) => b.seconds - a.seconds || a.index - b.index);

	for (const entry of ordered) {
		const bucket = buckets.reduce((best, candidate) =>
			candidate.seconds < best.seconds ? candidate : best,
		);

		bucket.entries.push(entry);
		bucket.seconds += entry.seconds;
	}

	return buckets.map(({ entries }) =>
		entries.sort((a, b) => a.index - b.index).map(({ check }) => check),
	);
}

export function selectChecks(checks, shard) {
	return shard ? partitionChecks(checks, shard.total)[shard.index - 1] : checks;
}
