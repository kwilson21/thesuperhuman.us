// Decides whether a conversion left behaviour alone, from two revisions of a golden fixture.
//
//   pnpm run golden:neutral <fixture|--all> [<from> [<to>]] [--allow-renames <file>]
//
// <from> defaults to HEAD and <to> to the working tree, as for `golden:diff`. `--all` runs every fixture in either
// revision. Exits 0 only when every pre-existing case is neutral, 1 when one is not (or cannot be compared), 2 on a usage
// or reading error. The rule, in plain words, is in tests/golden/README.md ("A conversion is neutral when").
//
// A case is neutral when, for every step, these are byte-identical before and after: the request, the response (status,
// headers, set-cookie values, body), what the step dumped, and the digests of every table of both databases, of R2 and of
// KV (after the step, and for the databases at the moment the response was read and at every outside effect); the final
// dump and final state; and the sequence of every effect that is not a D1 statement (outgoing fetch, Workers AI, R2, KV,
// console, waitUntil, rate limits, clock moves, interleave and trigger-hit markers), each with its step, its phase and the
// digest of both databases as they were when it happened. Only the D1 entries (`d1` and `d1-batch`: SQL text, binds,
// count, batch boundaries, results and change counts) may differ.
//
// So the order of a write against an outside effect needs no rule of its own: an email that went out after a write and now
// goes out before it was sent with a different database, and a write that moved across the response boundary leaves a
// different database at the response. One statement replaced by a DELETE and an INSERT of the same row, an INSERT OR
// REPLACE, or an upsert turned into an UPDATE, changes nothing a digest sees, so it is neutral.
//
// Format 1 and 2 fixtures (recorded before the digests were complete) and format 3 fixtures cannot be compared with each
// other: the digests exist on one side only, or differ in kind, so neutrality cannot be shown, and the tool says so and
// exits 1.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";

const DIRECTORY = "tests/golden/fixtures";
const SHORT = 160;

const D1_KINDS = new Set(["d1", "d1-batch"]);

const isD1 = (effect) => D1_KINDS.has(effect.kind);

const show = (value) => {
	const text = JSON.stringify(value);

	if (text === undefined) return "(absent)";

	return text.length > SHORT
		? `${text.slice(0, SHORT)}... (${text.length} characters)`
		: text;
};

/** A short name for a non-D1 effect, to say which one moved. */
export function describeEffect(effect) {
	switch (effect.kind) {
		case "fetch":
			return `fetch ${effect.method} ${effect.url}`;
		case "r2":
			return `r2 ${effect.bucket} ${effect.op}${effect.key ? ` ${effect.key}` : ""}`;
		case "kv":
			return `kv ${effect.namespace} ${effect.op}${effect.key ? ` ${effect.key}` : ""}`;
		case "ai":
			return `ai ${effect.model}`;
		case "console":
			return `console.${effect.level}`;
		case "rate-limit":
			return `rate-limit ${effect.binding}`;
		case undefined:
			// The older recorder (contact and resume routes) writes `{ step, kv, op, key }` and `{ step, fetch }`.
			return effect.fetch
				? `fetch ${effect.fetch.method} ${effect.fetch.url}`
				: `kv ${effect.kv} ${effect.op} ${effect.key}`;
		default:
			return effect.kind;
	}
}

const areaOf = (path) =>
	/\.digest(\.|$)|^\.finalState/.test(path)
		? "table, R2 and KV digests"
		: /\.state(\.|$)/.test(path) ||
				path === ".final" ||
				path.startsWith(".final.")
			? "database or store state"
			: /\.answer\./.test(path)
				? "response"
				: "step";

const rest = ({ name: _name, effects: _effects, ...others }) => others;

const formatOf = (entry) => entry.format ?? 1;

/** Where in the later log an effect difference is, as a name: the n-th outside effect, in words. */
function effectAt(path, list) {
	const index = /^\[(\d+)\]/.exec(path)?.[1];
	const effect = index === undefined ? undefined : list[Number(index)];

	return effect
		? `${describeEffect(effect)} (step ${effect.step}, ${effect.phase})`
		: undefined;
}

/**
 * Compares one case before and after a conversion.
 * Returns { status: "identical" | "d1-only" | "non-neutral" | "not-comparable", difference? }.
 */
export function compareCase(before, after) {
	if (formatOf(before) !== formatOf(after))
		return {
			status: "not-comparable",
			difference: {
				area: "fixture format",
				path: "case.format",
				expected: formatOf(before),
				actual: formatOf(after),
			},
		};

	if (
		JSON.stringify(before) === JSON.stringify({ ...after, name: before.name })
	)
		return { status: "identical" };

	const state = differences(rest(before), rest(after));

	if (state.length > 0) {
		const [{ path, expected, actual }] = state;

		return {
			status: "non-neutral",
			difference: { area: areaOf(path), path: `case${path}`, expected, actual },
		};
	}

	const old = before.effects.filter((effect) => !isD1(effect));
	const next = after.effects.filter((effect) => !isD1(effect));
	const moved = differences(old, next);

	if (moved.length > 0) {
		const [{ path, expected, actual }] = moved;
		const sorted = (list) => list.map((item) => JSON.stringify(item)).sort();

		const how = /\.state\.[a-z]+$/.test(path)
			? "the database changed before this effect, so a write moved or changed"
			: old.length > next.length
				? "an effect was removed"
				: old.length < next.length
					? "an effect was added"
					: JSON.stringify(sorted(old)) === JSON.stringify(sorted(next))
						? "the effects are the same but in a different order"
						: "an effect changed";

		return {
			status: "non-neutral",
			difference: {
				area: `non-D1 effects (${how})`,
				path: `effects(without D1)${path}`,
				effect: effectAt(path, next),
				expected,
				actual,
			},
		};
	}

	return { status: "d1-only" };
}

const filled = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Compares two revisions of one fixture.
 * `renames` maps an old case name to its new one, one to one: every source exists in the earlier revision and not in the
 * later, every destination exists in the later revision and not in the earlier, and no two sources share a destination.
 */
export function compareFixture(before, after, { renames = {} } = {}) {
	const byName = (list) => new Map(list.map((entry) => [entry.name, entry]));
	const was = byName(before);
	const now = byName(after);
	const destinations = new Set();

	for (const [from, to] of Object.entries(renames)) {
		if (!was.has(from))
			throw new Error(`rename "${from}" names no case in the earlier revision`);

		if (!now.has(to))
			throw new Error(`rename to "${to}" names no case in the later revision`);

		if (was.has(to))
			throw new Error(
				`rename to "${to}": the earlier revision has a case of that name too`,
			);

		if (now.has(from))
			throw new Error(
				`rename of "${from}": the later revision still has a case of that name`,
			);

		if (destinations.has(to))
			throw new Error(
				`rename to "${to}": two earlier cases are mapped to it, which would hide one of them`,
			);

		destinations.add(to);
	}

	/**
	 * @type {{ identical: string[], d1Only: string[], nonNeutral: { name: string }[], notComparable: { name: string, expected?: number, actual?: number }[], added: string[], removed: string[], renamed: { from: string, to: string, status: string }[], compared: number, neutral: boolean }}
	 */
	const result = {
		identical: [],
		d1Only: [],
		nonNeutral: [],
		notComparable: [],
		added: [],
		removed: [],
		renamed: [],
		compared: 0,
		neutral: false,
	};

	const matched = new Set();

	for (const old of before) {
		const to = renames[old.name] ?? old.name;
		const next = now.get(to);

		if (!next) {
			result.removed.push(old.name);
			continue;
		}

		matched.add(to);
		result.compared += 1;

		const outcome = compareCase(old, next);
		const label = to === old.name ? old.name : `${old.name} -> ${to}`;

		if (to !== old.name)
			result.renamed.push({ from: old.name, to, status: outcome.status });

		if (outcome.status === "not-comparable") {
			result.notComparable.push({ name: label, ...outcome.difference });
			continue;
		}

		if (outcome.status === "non-neutral") {
			result.nonNeutral.push({ name: label, ...outcome.difference });
			continue;
		}

		(outcome.status === "identical" ? result.identical : result.d1Only).push(
			label,
		);
	}

	for (const name of now.keys())
		if (!matched.has(name)) result.added.push(name);

	result.neutral =
		result.nonNeutral.length === 0 &&
		result.notComparable.length === 0 &&
		result.removed.length === 0;

	return result;
}

function print(fixture, result) {
	console.log(
		`${fixture}: ${result.identical.length} identical, ${result.d1Only.length} neutral with D1 changes, ${result.nonNeutral.length} NOT neutral, ${result.notComparable.length} NOT COMPARABLE, ${result.added.length} added, ${result.removed.length} removed, ${result.renamed.length} renamed`,
	);

	if (result.notComparable.length > 0) {
		const [{ expected, actual }] = result.notComparable;

		console.log(
			`  NOT COMPARABLE: ${result.notComparable.length} cases are format ${expected} before and format ${actual} after. The digests differ between formats, so neutrality cannot be shown across a format change.`,
		);

		for (const item of result.notComparable.slice(0, 3))
			console.log(`    ${item.name}`);

		if (result.notComparable.length > 3)
			console.log(`    ... ${result.notComparable.length - 3} more`);
	}

	for (const item of result.nonNeutral)
		console.log(
			`  NOT neutral: ${item.name}\n    first difference, ${item.area}: ${item.path}${item.effect ? `\n    effect: ${item.effect}` : ""}\n      -  ${show(item.expected)}\n      +  ${show(item.actual)}`,
		);

	for (const name of result.removed)
		console.log(`  removed case (NOT neutral): ${name}`);

	for (const item of result.renamed)
		console.log(`  renamed case: ${item.from} -> ${item.to} (${item.status})`);

	for (const name of result.added)
		console.log(`  added case (not compared): ${name}`);
}

const strip = (path) => path.replace(/^.*\//, "").replace(/\.json(\.gz)?$/, "");

const namesAt = (revision) => {
	const names = (files) =>
		files.filter((file) => /\.json(\.gz)?$/.test(file)).map(strip);

	if (revision === undefined) return names(readdirSync(DIRECTORY));

	return names(
		execFileSync("git", ["ls-tree", "--name-only", revision, `${DIRECTORY}/`], {
			encoding: "utf8",
		}).split("\n"),
	);
};

/** The commit a revision names, or an error: a branch that does not exist must never read as "no cases". */
function resolve(revision) {
	try {
		return execFileSync(
			"git",
			["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
	} catch {
		throw new Error(`"${revision}" is not a revision git can find`);
	}
}

const plainObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** The rename file, read and checked in full: `{ fixture: { old case name: new case name } }`. */
function readRenames(file) {
	let all;

	try {
		all = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`cannot read ${file} (${error.message})`);
	}

	if (!plainObject(all))
		throw new Error(`${file}: renames must be an object of fixture names`);

	for (const [fixture, cases] of Object.entries(all)) {
		if (!plainObject(cases))
			throw new Error(`${file}: "${fixture}" must be an object of case names`);

		for (const [name, value] of Object.entries(cases))
			if (!filled(value))
				throw new Error(
					`${file}: "${fixture}", "${name}" must be the new case name`,
				);
	}

	return all;
}

/** Runs the comparison and returns the exit code. */
function run({ target, from, to, renamesFile }) {
	const fromSha = resolve(from);
	const toSha = to === undefined ? undefined : resolve(to);
	const known = [...new Set([...namesAt(from), ...namesAt(to)])].sort();
	const all = target === "--all";

	if (!all && !known.includes(target.replace(/\.json(\.gz)?$/, "")))
		throw new Error(`no fixture named "${target}" in either revision`);

	const fixtures = all ? known : [target.replace(/\.json(\.gz)?$/, "")];
	const renames = renamesFile ? readRenames(renamesFile) : {};

	for (const fixture of Object.keys(renames))
		if (!fixtures.includes(fixture))
			throw new Error(
				`${renamesFile}: "${fixture}" is not a fixture that was compared (${all ? "no such fixture" : `this run compares only ${fixtures[0]}`})`,
			);

	console.log(
		`golden:neutral: from ${from} (${fromSha.slice(0, 12)}) to ${to === undefined ? "the working tree" : `${to} (${toSha.slice(0, 12)})`}`,
	);

	let neutral = true;
	let unchanged = 0;
	let cases = 0;

	for (const fixture of fixtures) {
		const before = fromRevision(fixture, from);
		const after = to ? fromRevision(fixture, to) : fromDisk(fixture);
		const result = compareFixture(before, after, { renames: renames[fixture] });

		cases += result.compared;
		neutral &&= result.neutral;

		if (
			result.identical.length === before.length &&
			result.added.length === 0 &&
			result.removed.length === 0
		) {
			unchanged += 1;

			if (all) continue;
		}

		print(fixture, result);
	}

	console.log(
		`compared ${fixtures.length} fixture${fixtures.length === 1 ? "" : "s"} and ${cases} case${cases === 1 ? "" : "s"}${all ? `; ${fixtures.length - unchanged} of ${fixtures.length} fixtures differ` : ""}`,
	);

	if (cases === 0)
		throw new Error("no case was compared, so nothing can be called neutral");

	console.log(
		neutral
			? unchanged === fixtures.length
				? `golden:neutral: identical, ${cases} cases`
				: "golden:neutral: NEUTRAL"
			: "golden:neutral: NOT NEUTRAL",
	);

	return neutral ? 0 : 1;
}

const USAGE =
	"usage: golden-neutral.mjs <fixture|--all> [<from> [<to>]] [--allow-renames <file>]";

function main(argv) {
	const positional = [];
	let renamesFile;
	let usage = false;

	for (let at = 0; at < argv.length; at += 1) {
		const arg = argv[at];

		if (arg === "--allow-renames") {
			const value = argv[++at];

			if (value === undefined || value.startsWith("--")) usage = true;
			else renamesFile = value;
		} else if (arg === "--all" && at === 0) positional.push(arg);
		else if (arg.startsWith("-")) usage = true;
		else positional.push(arg);
	}

	// A fixture, then <from> and <to>; or --all, then <from> and <to>.
	if (usage || positional.length === 0 || positional.length > 3) {
		console.error(USAGE);
		process.exit(2);
	}

	const [target, from = "HEAD", to] = positional;

	try {
		process.exit(run({ target, from, to, renamesFile }));
	} catch (error) {
		console.error(
			`golden:neutral: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(2);
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	main(process.argv.slice(2));
