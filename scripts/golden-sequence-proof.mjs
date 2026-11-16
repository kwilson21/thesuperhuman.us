// Proves that the re-record after the digest rule "a sqlite_sequence row whose seq is 0 is no state" changed only digests.
//
//   node scripts/golden-sequence-proof.mjs <from> [<to>]
//
// For every fixture present in either revision (a fixture in only one is refused) and every case present in either, the
// later case must equal the earlier one field for field, apart from digest fields, which are listed by exact path in
// ALLOWED: a step's `digest` (and its `atResponse` digests), an outside effect's `state` digest, and the `finalState`
// hashes. In `finalState` the only table record that may differ is `sqlite_sequence` (the rows it holds, or its absence
// when every counter was 0), so a table other than the counters never changes; a counter record whose row count is
// unchanged must keep its hash, because a changed hash then means a counter's value changed. Responses, headers, dumped
// rows (`steps[].state`), `touched` lists, D1 statements and every outside effect are compared exactly. Prints the
// fixtures and cases checked and how many changed, and exits 1 on any other difference.
// A rule that a seq-0 row is the only thing dropped is not provable from the fixtures alone (they hold hashes, not rows);
// it is shown by tests/golden/harness/digest.test.ts, and by the case a fixture re-records unchanged when it had no
// counter at 0.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";
import { ranDirectly } from "./ran-directly.mjs";

const DIRECTORY = "tests/golden/fixtures";

// The only paths a re-record may change. Every pattern is anchored at both ends, so a dumped row (`.steps[0].state...`),
// a `touched` list or any other field never matches by sharing a key name with a digest.
const ALLOWED = [
	/^\.steps\[\d+\]\.digest\.(music|publication|r2|kv)$/,
	/^\.steps\[\d+\]\.digest\.atResponse\.(music|publication)$/,
	/^\.effects\[\d+\]\.state\.(music|publication)$/,
	/^\.finalState\.(music|publication)\.sha256$/,
	/^\.finalState\.(music|publication)\.tables\.sqlite_sequence(\.(rows|sha256))?$/,
];

export function allowed(path) {
	return ALLOWED.some((pattern) => pattern.test(path));
}

/** The fixture names (without extension) at a git revision, or on disk when `revision` is undefined. */
export function fixtureNames(revision) {
	const names = revision
		? execFileSync(
				"git",
				["ls-tree", "--name-only", revision, `${DIRECTORY}/`],
				{ encoding: "utf8", maxBuffer: 1 << 26 },
			)
				.split("\n")
				.map((line) => line.slice(DIRECTORY.length + 1))
		: readdirSync(DIRECTORY);

	return new Set(
		names
			.filter((name) => /\.json(\.gz)?$/.test(name))
			.map((name) => name.replace(/\.json(\.gz)?$/, "")),
	);
}

/** One refusal line for each fixture that exists in only one of the two revisions. */
export function missingFixtures(before, after) {
	return [
		...[...before].filter((name) => !after.has(name)),
		...[...after].filter((name) => !before.has(name)),
	].map((name) => `${name}: the fixture is not in both revisions`);
}

/** The reasons a re-recorded case `after` may not stand in for `before`. Empty when only digests changed. */
export function refusals(fixture, name, before, after) {
	const refused = [];

	for (const db of Object.keys(before.finalState ?? {})) {
		const was = before.finalState[db]?.tables?.sqlite_sequence;
		const is = after.finalState?.[db]?.tables?.sqlite_sequence;
		const wasRows = was?.rows ?? 0;
		const isRows = is?.rows ?? 0;

		if (isRows > wasRows)
			refused.push(`${fixture}: "${name}" gained a counter row in ${db}`);

		// Dropping seq-0 rows changes the row count; the same count with another hash means a counter's value changed.
		if (isRows === wasRows && isRows > 0 && was?.sha256 !== is?.sha256)
			refused.push(`${fixture}: "${name}" changed a counter value in ${db}`);
	}

	for (const one of differences(before, after))
		if (!allowed(one.path))
			refused.push(`${fixture}: "${name}" differs at ${one.path}`);

	return refused;
}

function main() {
	const [from, to] = process.argv.slice(2);

	if (!from) {
		console.error("usage: golden-sequence-proof.mjs <from> [<to>]");
		process.exit(2);
	}

	const namesBefore = fixtureNames(from);
	const namesAfter = fixtureNames(to);
	const refused = missingFixtures(namesBefore, namesAfter);

	const fixtures = [...namesBefore]
		.filter((name) => namesAfter.has(name))
		.sort();

	let cases = 0;
	let changedCases = 0;
	let changedFixtures = 0;

	for (const fixture of fixtures) {
		const before = fromRevision(fixture, from);
		const after = to ? fromRevision(fixture, to) : fromDisk(fixture);
		const names = [...new Set([...before, ...after].map((c) => c.name))];
		let changed = 0;

		for (const name of names) {
			const a = before.find((c) => c.name === name);
			const b = after.find((c) => c.name === name);

			cases += 1;

			if (!a || !b) {
				refused.push(`${fixture}: case "${name}" is not in both revisions`);
				continue;
			}

			if (differences(a, b).length > 0) changed += 1;

			refused.push(...refusals(fixture, name, a, b));
		}

		changedCases += changed;

		if (changed > 0) changedFixtures += 1;
	}

	console.log(
		`golden-sequence-proof: ${fixtures.length} fixtures, ${cases} cases, ${changedCases} cases in ${changedFixtures} fixtures changed, digests only`,
	);

	if (refused.length > 0) {
		console.error(refused.slice(0, 20).join("\n"));
		console.error(`golden-sequence-proof: ${refused.length} other differences`);
		process.exit(1);
	}
}

if (ranDirectly(import.meta.url)) main();
