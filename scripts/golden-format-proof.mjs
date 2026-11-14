// Proves that the fixture format 3 to 4 re-record changed only what it is allowed to (see ALLOWED below).
//
//   node scripts/golden-format-proof.mjs <from> [<to>]
//
// For every fixture, in either revision, and every case, the later case must equal the earlier one field for field,
// apart from the allowed differences. Prints the number of fixtures and cases, the size of all fixtures before and after
// (compressed as stored, and as JSON text), how many recorded change counts changed and in which fixtures, and exits 1 on
// any other difference.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";
import { assertCompleteRecord } from "./golden-neutral.mjs";
import { statementOf } from "./sql-effects.mjs";
import { ranDirectly } from "./ran-directly.mjs";

const DIRECTORY = "tests/golden/fixtures";

/**
 * What the format 3 to format 4 re-record may change, and nothing else:
 *
 * - `format` goes from 3 to 4 (a case in neither format, the older recorder's, must be identical), and the later case
 *   must have the whole shape format 4 requires (`assertCompleteRecord` in golden-neutral.mjs): every field present, not just tolerated;
 * - each outside effect's `state` and each step's `digest.atResponse` gain `touched`, the sorted names of the tables
 *   that committed row-changing writes had touched so far in the step;
 * - within format 4 (the same format before and after) only the `touched` sets may differ: they are listed;
 * - a D1 `changes` count may change, and only where the statement is a read and the new count is 0: the count of a read
 *   that ran beside a write used to be the write's. A changed count of a write is NOT accepted here (the harness verified
 *   every recorded count against SQLite's `total_changes()` when it recorded them; see GOLDEN_VERIFY_COUNTS in
 *   tests/golden/README.md), so one would be reported and need its own explanation.
 *
 * `trigger-hit` entries, the step digests, the final state and every other field are compared exactly.
 */
export const ALLOWED = {
	fromFormat: 3,
	toFormat: 4,
	added: "touched",
};

const isSortedNames = (list) =>
	Array.isArray(list) &&
	list.every((name) => typeof name === "string") &&
	JSON.stringify(list) === JSON.stringify([...list].sort());

/** Every `touched` set of a case, in order: each effect's, then each step's at the response. */
const touchedOf = (entry) => [
	...entry.effects.flatMap((effect) =>
		effect.state ? [effect.state.touched] : [],
	),
	...entry.steps.map((step) => step.digest?.atResponse?.touched),
];

/** The later case without the allowed additions, or a reason it cannot be compared. */
function reduce(entry, problems, name) {
	const kept = structuredClone(entry);

	delete kept.format;

	for (const effect of kept.effects)
		if (effect.state && "touched" in effect.state) {
			if (!isSortedNames(effect.state.touched))
				problems.push(
					`${name}: an effect's touched is not a sorted list of table names`,
				);

			delete effect.state.touched;
		}

	for (const step of kept.steps ?? [])
		if (step.digest?.atResponse && "touched" in step.digest.atResponse) {
			if (!isSortedNames(step.digest.atResponse.touched))
				problems.push(
					`${name}: atResponse.touched is not a sorted list of table names`,
				);

			delete step.digest.atResponse.touched;
		}

	return kept;
}

/** Whether the later count may replace the earlier one: a read, and now 0. */
const readNowZero = (sql, was, now) => {
	if (was === now) return true;

	try {
		return now === 0 && !statementOf(sql).write;
	} catch {
		return false;
	}
};

/** The D1 `changes` of the later effects put back to the earlier value where the change is allowed; counts those. */
function acceptCounts(old, next) {
	let accepted = 0;

	for (const [index, effect] of next.entries()) {
		const was = old[index];

		if (!was || was.kind !== effect.kind) continue;

		if (
			effect.kind === "d1" &&
			readNowZero(effect.sql, was.outcome?.changes, effect.outcome?.changes)
		) {
			if (was.outcome?.changes !== effect.outcome?.changes) accepted += 1;

			effect.outcome = { ...effect.outcome, changes: was.outcome?.changes };
		}

		if (effect.kind === "d1-batch")
			effect.statements = effect.statements.map((statement, at) => {
				const before = was.statements?.[at];

				if (
					!before ||
					!readNowZero(
						statement.sql,
						before.outcome?.changes,
						statement.outcome?.changes,
					)
				)
					return statement;

				if (before.outcome?.changes !== statement.outcome?.changes)
					accepted += 1;

				return {
					...statement,
					outcome: { ...statement.outcome, changes: before.outcome?.changes },
				};
			});
	}

	return accepted;
}

/**
 * The differences between two revisions of one fixture's cases, as { problems, counts }: `counts` is how many recorded
 * D1 change counts changed, all of them reads that now say 0.
 */
export function proveFixtureDetailed(before, after) {
	const problems = [];
	const touched = [];
	let counts = 0;

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

		if (old.format === undefined && next.format === undefined) {
			const found = differences(old, next);

			if (found.length > 0)
				problems.push(
					`${old.name}: ${found[0].path || "(root)"} differs (${found.length} differences)`,
				);

			continue;
		}

		// Within format 4 only the table sets may differ (how they are derived changed); everything else is exact.
		if (old.format === ALLOWED.toFormat && next.format === ALLOWED.toFormat) {
			try {
				assertCompleteRecord(old);
				assertCompleteRecord(next);
			} catch (error) {
				problems.push(error instanceof Error ? error.message : String(error));
				continue;
			}

			const earlier = reduce(old, problems, old.name);
			const later = reduce(next, problems, old.name);
			const found = differences(earlier, later);

			if (found.length > 0)
				problems.push(
					`${old.name}: ${found[0].path || "(root)"} differs (${found.length} differences)`,
				);

			if (JSON.stringify(touchedOf(old)) !== JSON.stringify(touchedOf(next)))
				touched.push(old.name);

			continue;
		}

		if (old.format !== ALLOWED.fromFormat || next.format !== ALLOWED.toFormat) {
			problems.push(
				`${old.name}: format ${old.format} to ${next.format}, not ${ALLOWED.fromFormat} to ${ALLOWED.toFormat}`,
			);
			continue;
		}

		// The current format REQUIRES its fields; a record that left one out is a failure, not something to tolerate.
		try {
			assertCompleteRecord(next);
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
			continue;
		}

		const earlier = structuredClone(old);
		const later = reduce(next, problems, old.name);

		delete earlier.format;

		counts += acceptCounts(earlier.effects, later.effects);

		const found = differences(earlier, later);

		if (found.length > 0)
			problems.push(
				`${old.name}: ${found[0].path || "(root)"} differs (${found.length} differences)`,
			);
	}

	return { problems, counts, touched };
}

/** The problems only (see `proveFixtureDetailed`). */
export const proveFixture = (before, after) =>
	proveFixtureDetailed(before, after).problems;

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
	const changedCounts = new Map();
	const changedSets = new Map();

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

		const proved = proveFixtureDetailed(old, next);

		if (proved.counts > 0) changedCounts.set(fixture, proved.counts);

		if (proved.touched.length > 0) changedSets.set(fixture, proved.touched);

		for (const problem of proved.problems)
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

	const total = [...changedCounts.values()].reduce((sum, n) => sum + n, 0);

	console.log(
		`recorded change counts that changed: ${total}${[...changedCounts].map(([fixture, n]) => `\n  ${fixture}: ${n}`).join("")}`,
	);

	const sets = [...changedSets.values()].reduce(
		(sum, list) => sum + list.length,
		0,
	);

	console.log(
		`cases whose table sets differ (format 4 to 4): ${sets}${[...changedSets]
			.map(
				([fixture, list]) =>
					`\n  ${fixture}: ${list.length}${list
						.slice(0, 5)
						.map((name) => `\n    ${name}`)
						.join(
							"",
						)}${list.length > 5 ? `\n    ... ${list.length - 5} more` : ""}`,
			)
			.join("")}`,
	);

	for (const problem of problems.slice(0, 20))
		console.log(`  DIFFERENT: ${problem}`);

	console.log(
		problems.length === 0
			? "golden-format-proof: the only differences are the format number, the `touched` sets, and read change counts that now say 0"
			: `golden-format-proof: ${problems.length} problems, so this is not only a format change`,
	);

	process.exit(problems.length === 0 ? 0 : 1);
}

if (ranDirectly(import.meta.url)) main(process.argv.slice(2));
