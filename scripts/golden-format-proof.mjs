// Proves that a fixture FORMAT change added fields and changed nothing else.
//
//   node scripts/golden-format-proof.mjs <from> [<to>]
//
// For every fixture, in either revision, and every case: the later case and the earlier case, each with the ADDED fields removed, must be equal, field for field. The added fields are listed below and nothing else may differ. Prints the number of
// fixtures and cases and the size of all fixtures before and after (compressed as stored, and as JSON text), and exits 1
// on any difference.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";

const DIRECTORY = "tests/golden/fixtures";

/**
 * What a format change may add or replace: on a case, on every step, on every outside effect, and log entries of these
 * kinds. A D1 outcome that was recorded as `changes: null` may now hold the real count. Nothing else may differ.
 */
export const ADDED = {
	caseFields: ["format", "finalState"],
	stepFields: ["digest"],
	effectFields: ["state"],
	effectKinds: ["trigger-hit"],
};

/** The case without the fields a format change adds. */
export function withoutAdded(entry) {
	const kept = { ...entry };

	for (const field of ADDED.caseFields) delete kept[field];

	kept.effects = kept.effects
		.filter((effect) => !ADDED.effectKinds.includes(effect.kind))
		.map((effect) => {
			const copy = { ...effect };

			for (const field of ADDED.effectFields) delete copy[field];

			return copy;
		});

	if (kept.steps)
		kept.steps = kept.steps.map((step) => {
			const copy = { ...step };

			for (const field of ADDED.stepFields) delete copy[field];

			return copy;
		});

	return kept;
}

/** Whether a later change count is the real number for an earlier null. */
const filledIn = (was, now) =>
	was === null && Number.isInteger(now) && now >= 0;

/** The later effects with each `changes` the earlier record left null put back to null, so only real differences remain. */
function nullChanges(old, next) {
	return next.map((effect, index) => {
		const was = old[index];

		if (!was || was.kind !== effect.kind) return effect;

		if (
			effect.kind === "d1" &&
			filledIn(was.outcome?.changes, effect.outcome?.changes)
		)
			return { ...effect, outcome: { ...effect.outcome, changes: null } };

		if (effect.kind === "d1-batch")
			return {
				...effect,
				statements: effect.statements.map((statement, at) =>
					filledIn(
						was.statements?.[at]?.outcome?.changes,
						statement.outcome?.changes,
					)
						? { ...statement, outcome: { ...statement.outcome, changes: null } }
						: statement,
				),
			};

		return effect;
	});
}

/** The differences between two revisions of one fixture's cases, after removing the added fields from both. */
export function proveFixture(before, after) {
	const problems = [];

	if (before.length !== after.length)
		problems.push(`${before.length} cases before, ${after.length} after`);

	for (const [index, old] of before.entries()) {
		const next = after[index];

		if (!next || next.name !== old.name) {
			problems.push(
				`case ${index + 1} is "${old.name}" before and "${next?.name}" after`,
			);
			continue;
		}

		const earlier = withoutAdded(old);
		const later = withoutAdded(next);

		later.effects = nullChanges(earlier.effects, later.effects);

		const found = differences(earlier, later);

		if (found.length > 0)
			problems.push(
				`${old.name}: ${found[0].path || "(root)"} differs (${found.length} differences)`,
			);
	}

	return problems;
}

const git = (args) =>
	execFileSync("git", args, {
		maxBuffer: 1 << 30,
		stdio: ["ignore", "pipe", "pipe"],
	});

const names = (revision) =>
	(revision === undefined
		? readdirSync(DIRECTORY)
		: git(["ls-tree", "--name-only", revision, `${DIRECTORY}/`])
				.toString()
				.split("\n")
	)
		.filter((file) => /\.json\.gz$/.test(file))
		.map((file) => file.replace(/^.*\//, "").replace(/\.json\.gz$/, ""));

/** The stored (compressed) size of a fixture at a revision, or on disk. */
function stored(fixture, revision) {
	const path = `${DIRECTORY}/${fixture}.json.gz`;

	if (revision === undefined) return existsSync(path) ? statSync(path).size : 0;

	return Number(git(["cat-file", "-s", `${revision}:${path}`]).toString());
}

function main([from, to]) {
	if (!from) {
		console.error("usage: golden-format-proof.mjs <from> [<to>]");
		process.exit(2);
	}

	const before = new Set(names(from));
	const after = new Set(names(to));
	const problems = [];
	let cases = 0;
	let storedBefore = 0;
	let storedAfter = 0;
	let textBefore = 0;
	let textAfter = 0;

	for (const fixture of [...new Set([...before, ...after])].sort()) {
		if (!before.has(fixture) || !after.has(fixture)) {
			problems.push(`${fixture} exists in only one revision`);
			continue;
		}

		const old = fromRevision(fixture, from);
		const next = to ? fromRevision(fixture, to) : fromDisk(fixture);

		cases += old.length;
		storedBefore += stored(fixture, from);
		storedAfter += stored(fixture, to);
		textBefore += JSON.stringify(old).length;
		textAfter += JSON.stringify(next).length;

		for (const problem of proveFixture(old, next))
			problems.push(`${fixture}: ${problem}`);
	}

	console.log(
		`golden-format-proof: ${before.size} fixtures before, ${after.size} after; ${cases} cases`,
	);

	console.log(
		`stored size: ${storedBefore} bytes before, ${storedAfter} bytes after (${((storedAfter / storedBefore) * 100).toFixed(0)}%)`,
	);

	console.log(
		`as JSON text: ${textBefore} bytes before, ${textAfter} bytes after (${((textAfter / textBefore) * 100).toFixed(0)}%)`,
	);

	for (const problem of problems.slice(0, 20))
		console.log(`  DIFFERENT: ${problem}`);

	console.log(
		problems.length === 0
			? "golden-format-proof: the only differences are the added fields (format, finalState, step digest, effect state, trigger-hit entries) and the real count in place of a null `changes`"
			: `golden-format-proof: ${problems.length} problems, so this is not only a format change`,
	);

	process.exit(problems.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`)
	main(process.argv.slice(2));
