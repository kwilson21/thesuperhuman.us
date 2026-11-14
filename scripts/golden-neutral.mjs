// Decides whether a conversion left behaviour alone, from two revisions of a golden fixture.
//
//   pnpm run golden:neutral <fixture|--all> [<from> [<to>]] [--allow-renames <file>] [--allow-positions <file>]
//
// <from> defaults to HEAD and <to> to the working tree, as for `golden:diff`. `--all` runs every fixture in either
// revision. Exits 0 only when every pre-existing case is neutral, 1 when one is not (or cannot be compared), 2 on a usage
// or reading error. The rule, in plain words, is in tests/golden/README.md ("A conversion is neutral when").
//
// A case is neutral when, for every step, these are byte-identical before and after: the request, the response (status,
// headers, set-cookie values, body), what the step dumped, and (format 2) the digest of every table of every database, of
// R2 and of KV after the step; the final dump and final digests; and the sequence of every effect that is not a D1
// statement (outgoing fetch, Workers AI, R2, KV, console, waitUntil, rate limits, clock moves, interleave and trigger-hit
// markers), each with its step and phase. Only the D1 entries (`d1` and `d1-batch`: SQL text, binds, count, batch
// boundaries and results) may differ.
//
// Order against D1 is checked on top of that. Per step, only committed D1 writes that changed at least one row count (a
// read, a zero-row write, a failed statement and a batch that did not commit do not). Each is read as (operation, table,
// phase). For every outside effect the tool takes the writes that came before it in its step; those must be the same
// before and after (as a multiset: which tables had been changed, by which operation and in which phase, how many times,
// but not in which order). For every step it also takes all such writes with their phase, so a write that moved across
// the response boundary (request to background) is caught. A difference is a failure unless that one effect is named,
// with a reason, in the file given to `--allow-positions`.
//
// Format 1 fixtures (recorded before the per-table digests) and format 2 fixtures cannot be compared with each other: the
// digests exist on one side only, so neutrality cannot be shown, and the tool says so and exits 1.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";
import { isWriteSql, statementOf } from "./sql-effects.mjs";

export { isWriteSql };

const DIRECTORY = "tests/golden/fixtures";
const SHORT = 160;

const D1_KINDS = new Set(["d1", "d1-batch"]);

/** Entries of the log that the harness writes about itself, not something a route did. */
const MARKERS = new Set(["interleave", "trigger-hit", "advance"]);

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

/** Whether a statement that ran changed a row: a write that did not throw and returned or changed at least one row. */
function changed(sql, outcome) {
	if (outcome?.threw !== undefined || !statementOf(sql).write) return false;

	// A write run through first() or all() (with RETURNING) has no `changes`, so its returned rows stand for them.
	return (outcome.changes ?? outcome.rows) > 0;
}

/** The committed, row-changing writes of one D1 entry, as { op, table }. */
function writesOf(effect) {
	const read = ({ sql }) => {
		const { op, table } = statementOf(sql);

		return { op, table };
	};

	if (effect.kind === "d1")
		return changed(effect.sql, effect.outcome) ? [read(effect)] : [];

	if (effect.kind === "d1-batch" && effect.result === "committed")
		return effect.statements
			.filter((statement) => changed(statement.sql, statement.outcome))
			.map(read);

	return [];
}

/**
 * For a log: for every outside effect, the writes that came before it in its step, and for every step all its writes,
 * each as "OP table phase" in the order they happened.
 */
export function analyse(effects) {
	const sofar = new Map();
	const outside = [];
	const counts = new Map();

	for (const effect of effects) {
		if (isD1(effect)) {
			const list = sofar.get(effect.step) ?? [];

			for (const { op, table } of writesOf(effect))
				list.push(`${op} ${table} ${effect.phase}`);

			sofar.set(effect.step, list);
			continue;
		}

		if (MARKERS.has(effect.kind)) continue;

		const description = describeEffect(effect);
		const key = `${effect.step}|${description}`;
		const n = (counts.get(key) ?? 0) + 1;

		counts.set(key, n);

		outside.push({
			id: `step ${effect.step}: ${description} #${n}`,
			before: [...(sofar.get(effect.step) ?? [])],
		});
	}

	return { outside, steps: sofar };
}

const key = (list, ordered) =>
	JSON.stringify(ordered ? list : [...list].sort());

/** Every outside effect, and every step's writes, whose place among the writes differs between two logs of equal effects. */
export function shiftsOf(before, after, ordered = false) {
	const was = analyse(before);
	const now = analyse(after);
	const found = [];

	for (const [index, item] of was.outside.entries()) {
		const other = now.outside[index];

		if (other && key(item.before, ordered) !== key(other.before, ordered))
			found.push({
				id: item.id,
				was: item.before,
				now: other.before,
			});
	}

	for (const step of [
		...new Set([...was.steps.keys(), ...now.steps.keys()]),
	].sort((a, b) => a - b)) {
		const a = was.steps.get(step) ?? [];
		const b = now.steps.get(step) ?? [];

		if (key(a, ordered) !== key(b, ordered))
			found.push({ id: `step ${step}: writes by phase`, was: a, now: b });
	}

	return found;
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

/**
 * Compares one case before and after a conversion.
 * Returns { status: "identical" | "d1-only" | "non-neutral" | "not-comparable", difference?, shifts }.
 */
export function compareCase(before, after, { ordered = false } = {}) {
	if (formatOf(before) !== formatOf(after))
		return {
			status: "not-comparable",
			difference: {
				area: "fixture format",
				path: "case.format",
				expected: formatOf(before),
				actual: formatOf(after),
			},
			shifts: [],
		};

	if (
		JSON.stringify(before) === JSON.stringify({ ...after, name: before.name })
	)
		return { status: "identical", shifts: [] };

	const state = differences(rest(before), rest(after));

	if (state.length > 0) {
		const [{ path, expected, actual }] = state;

		return {
			status: "non-neutral",
			difference: { area: areaOf(path), path: `case${path}`, expected, actual },
			shifts: [],
		};
	}

	const old = before.effects.filter((effect) => !isD1(effect));
	const next = after.effects.filter((effect) => !isD1(effect));
	const moved = differences(old, next);

	if (moved.length > 0) {
		const [{ path, expected, actual }] = moved;
		const sorted = (list) => list.map((item) => JSON.stringify(item)).sort();

		const how =
			old.length > next.length
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
				expected,
				actual,
			},
			shifts: [],
		};
	}

	return {
		status: "d1-only",
		shifts: shiftsOf(before.effects, after.effects, ordered),
	};
}

const filled = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Compares two revisions of one fixture.
 * `renames` maps an old case name to its new one, one to one. `allowShifts` maps a (new) case name to { effect id:
 * reason }. A mapping that names nothing, or two sources for one destination, is an error; an allowance that matches
 * no moved effect is reported in `unusedAllowances` and fails the run.
 */
export function compareFixture(
	before,
	after,
	{ renames = {}, allowShifts = {}, ordered = false } = {},
) {
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

	for (const [name, effects] of Object.entries(allowShifts))
		for (const [id, reason] of Object.entries(effects))
			if (!filled(reason))
				throw new Error(`allowance for "${name}", ${id} has no reason`);

	/**
	 * @typedef {{ id: string, was: string[], now: string[], reason: string | null }} Shifted
	 * @type {{ identical: string[], d1Only: string[], nonNeutral: { name: string }[], notComparable: { name: string, expected?: number, actual?: number }[], shifted: { name: string, items: Shifted[] }[], added: string[], removed: string[], renamed: { from: string, to: string, status: string }[], unusedAllowances: string[], compared: number, neutral: boolean }}
	 */
	const result = {
		identical: [],
		d1Only: [],
		nonNeutral: [],
		notComparable: [],
		shifted: [],
		added: [],
		removed: [],
		renamed: [],
		unusedAllowances: [],
		compared: 0,
		neutral: false,
	};

	const matched = new Set();
	const used = new Set();

	for (const old of before) {
		const to = renames[old.name] ?? old.name;
		const next = now.get(to);

		if (!next) {
			result.removed.push(old.name);
			continue;
		}

		matched.add(to);
		result.compared += 1;

		const outcome = compareCase(old, next, { ordered });
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

		if (outcome.shifts.length > 0) {
			const items = outcome.shifts.map((shift) => {
				const reason = allowShifts[to]?.[shift.id];

				if (reason !== undefined) used.add(`${to}\u0000${shift.id}`);

				return { ...shift, reason: reason ?? null };
			});

			result.shifted.push({ name: label, items });
		}

		(outcome.status === "identical" ? result.identical : result.d1Only).push(
			label,
		);
	}

	for (const name of now.keys())
		if (!matched.has(name)) result.added.push(name);

	for (const [name, effects] of Object.entries(allowShifts)) {
		if (!matched.has(name)) {
			result.unusedAllowances.push(`${name} (no such compared case)`);
			continue;
		}

		for (const id of Object.keys(effects))
			if (!used.has(`${name}\u0000${id}`))
				result.unusedAllowances.push(`${name}: ${id} (moved no effect)`);
	}

	result.neutral =
		result.nonNeutral.length === 0 &&
		result.notComparable.length === 0 &&
		result.removed.length === 0 &&
		result.shifted.every((entry) =>
			entry.items.every((item) => item.reason !== null),
		) &&
		result.unusedAllowances.length === 0;

	return result;
}

function print(fixture, result) {
	console.log(
		`${fixture}: ${result.identical.length} identical, ${result.d1Only.length} neutral with D1 changes, ${result.nonNeutral.length} NOT neutral, ${result.notComparable.length} NOT COMPARABLE, ${result.added.length} added, ${result.removed.length} removed, ${result.renamed.length} renamed`,
	);

	if (result.notComparable.length > 0) {
		const [{ expected, actual }] = result.notComparable;

		console.log(
			`  NOT COMPARABLE: ${result.notComparable.length} cases are format ${expected} before and format ${actual} after. The per-table digests exist on one side only, so neutrality cannot be shown across a format change.`,
		);

		for (const item of result.notComparable.slice(0, 3))
			console.log(`    ${item.name}`);

		if (result.notComparable.length > 3)
			console.log(`    ... ${result.notComparable.length - 3} more`);
	}

	for (const item of result.nonNeutral)
		console.log(
			`  NOT neutral: ${item.name}\n    first difference, ${item.area}: ${item.path}\n      -  ${show(item.expected)}\n      +  ${show(item.actual)}`,
		);

	for (const entry of result.shifted)
		for (const item of entry.items.slice(0, 10)) {
			console.log(
				`  ${item.reason === null ? "FAILS: the writes before an effect changed" : "allowed: the writes before an effect changed"}: ${entry.name}, ${item.id}${item.reason === null ? "" : ` (${item.reason})`}`,
			);
			console.log(`    before: ${show(item.was)}`);
			console.log(`    after:  ${show(item.now)}`);
		}

	for (const name of result.removed)
		console.log(`  removed case (NOT neutral): ${name}`);

	for (const item of result.renamed)
		console.log(`  renamed case: ${item.from} -> ${item.to} (${item.status})`);

	for (const name of result.added)
		console.log(`  added case (not compared): ${name}`);

	for (const name of result.unusedAllowances)
		console.log(`  FAILS: allowance for ${name}`);
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

/** An allow file, read and checked in full: `{ fixture: { case: ... } }`, with `leaf` checking what a case holds. */
function readAllow(file, kind) {
	let all;

	try {
		all = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`cannot read ${file} (${error.message})`);
	}

	if (!plainObject(all))
		throw new Error(`${file}: ${kind} must be an object of fixture names`);

	for (const [fixture, cases] of Object.entries(all)) {
		if (!plainObject(cases))
			throw new Error(`${file}: "${fixture}" must be an object of case names`);

		for (const [name, value] of Object.entries(cases)) {
			if (kind === "renames") {
				if (!filled(value))
					throw new Error(
						`${file}: "${fixture}", "${name}" must be the new case name`,
					);
			} else {
				if (!plainObject(value))
					throw new Error(
						`${file}: "${fixture}", "${name}" must be an object of effect ids with a reason each`,
					);

				for (const [id, reason] of Object.entries(value))
					if (!filled(reason))
						throw new Error(
							`${file}: "${fixture}", "${name}", ${id} needs a reason`,
						);
			}
		}
	}

	return all;
}

/** Runs the comparison. Returns { code, lines } with the exit code. */
function run({ target, from, to, renamesFile, positionsFile, ordered }) {
	const fromSha = resolve(from);
	const toSha = to === undefined ? undefined : resolve(to);
	const known = [...new Set([...namesAt(from), ...namesAt(to)])].sort();
	const all = target === "--all";

	if (!all && !known.includes(target.replace(/\.json(\.gz)?$/, "")))
		throw new Error(`no fixture named "${target}" in either revision`);

	const fixtures = all ? known : [target.replace(/\.json(\.gz)?$/, "")];
	const renames = renamesFile ? readAllow(renamesFile, "renames") : {};
	const positions = positionsFile ? readAllow(positionsFile, "positions") : {};

	for (const [file, content] of [
		[renamesFile, renames],
		[positionsFile, positions],
	])
		for (const fixture of Object.keys(content))
			if (!fixtures.includes(fixture))
				throw new Error(
					`${file}: "${fixture}" is not a fixture that was compared (${all ? "no such fixture" : "this run compares only " + fixtures[0]})`,
				);

	console.log(
		`golden:neutral: from ${from} (${fromSha.slice(0, 12)}) to ${to === undefined ? "the working tree" : `${to} (${toSha.slice(0, 12)})`}`,
	);

	let neutral = true;
	let unchanged = 0;
	let cases = 0;
	let compared = 0;

	for (const fixture of fixtures) {
		const before = fromRevision(fixture, from);
		const after = to ? fromRevision(fixture, to) : fromDisk(fixture);

		const result = compareFixture(before, after, {
			renames: renames[fixture],
			allowShifts: positions[fixture],
			ordered,
		});

		cases += result.compared;
		compared += 1;
		neutral &&= result.neutral;

		const same =
			result.identical.length === before.length &&
			result.added.length === 0 &&
			result.removed.length === 0;

		if (same && result.unusedAllowances.length === 0) {
			unchanged += 1;

			if (all) continue;
		}

		print(fixture, result);
	}

	console.log(
		`compared ${compared} fixture${compared === 1 ? "" : "s"} and ${cases} case${cases === 1 ? "" : "s"}${all ? `; ${fixtures.length - unchanged} of ${fixtures.length} fixtures differ` : ""}`,
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
	"usage: golden-neutral.mjs <fixture|--all> [<from> [<to>]] [--allow-renames <file>] [--allow-positions <file>]";

function main(argv) {
	const positional = [];
	const flags = {};
	let usage = false;

	for (let at = 0; at < argv.length; at += 1) {
		const arg = argv[at];

		if (arg === "--allow-renames" || arg === "--allow-positions") {
			const value = argv[++at];

			if (value === undefined || value.startsWith("--")) usage = true;
			else flags[arg] = value;
		} else if (arg === "--ordered") flags.ordered = true;
		else if (arg === "--all" && at === 0) positional.push(arg);
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
		process.exit(
			run({
				target,
				from,
				to,
				renamesFile: flags["--allow-renames"],
				positionsFile: flags["--allow-positions"],
				ordered: flags.ordered === true,
			}),
		);
	} catch (error) {
		console.error(
			`golden:neutral: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(2);
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	main(process.argv.slice(2));
