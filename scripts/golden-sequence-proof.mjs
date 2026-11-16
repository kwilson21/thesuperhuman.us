// Proves that the re-record after the digest rule "a sqlite_sequence row whose seq is 0 is no state" changed only digests.
//
//   node scripts/golden-sequence-proof.mjs <from> [<to>]
//
// For every fixture and every case present in either revision, the later case must equal the earlier one field for field,
// apart from digest fields: a step's `digest`, an outside effect's `state`, and the `finalState` hashes. In `finalState`
// the only table record that may differ is `sqlite_sequence` (the rows it holds, or its absence when every counter was 0),
// so a table other than the counters never changes. Responses, headers, dumps, D1 statements and every outside effect
// are compared exactly. Prints the fixtures and cases checked and how many changed, and exits 1 on any other difference.
// A rule that a seq-0 row is the only thing dropped is not provable from the fixtures alone (they hold hashes, not rows);
// it is shown by tests/golden/harness/digest.test.ts, and by the case a fixture re-records unchanged when it had no
// counter at 0.
import { readdirSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";
import { ranDirectly } from "./ran-directly.mjs";

const DIRECTORY = "tests/golden/fixtures";

const DIGEST_PATH =
	/\.(digest|state)(\.|\[|$)|\.finalState\.[^.]+\.(sha256|tables\.sqlite_sequence)(\.|$)|\.finalState\.[^.]+\.tables$/;

const OTHER_TABLE = /\.finalState\.[^.]+\.tables\.(?!sqlite_sequence)/;

export function allowed(path) {
	return DIGEST_PATH.test(path) && !OTHER_TABLE.test(path);
}

function main() {
	const [from, to] = process.argv.slice(2);

	if (!from) {
		console.error("usage: golden-sequence-proof.mjs <from> [<to>]");
		process.exit(2);
	}

	const fixtures = readdirSync(DIRECTORY)
		.filter((name) => name.endsWith(".json.gz"))
		.map((name) => name.replace(/\.json\.gz$/, ""));

	let cases = 0;
	let changedCases = 0;
	let changedFixtures = 0;
	const refused = [];

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

			const found = differences(a, b);

			if (found.length > 0) changed += 1;

			for (const db of Object.keys(a.finalState ?? {})) {
				const was = a.finalState[db]?.tables?.sqlite_sequence?.rows ?? 0;
				const is = b.finalState?.[db]?.tables?.sqlite_sequence?.rows ?? 0;

				if (is > was)
					refused.push(`${fixture}: "${name}" gained a counter row in ${db}`);
			}

			for (const one of found)
				if (!allowed(one.path))
					refused.push(`${fixture}: "${name}" differs at ${one.path}`);
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
