// Decides whether a conversion left behaviour alone, from two revisions of a golden fixture.
//
//   pnpm run golden:neutral <fixture|--all> [<from> [<to>]] [--allow-renames <file>] [--allow-positions <file>]
//
// <from> defaults to HEAD and <to> to the working tree, as for `golden:diff`. `--all` runs every fixture in either
// revision. Exits 0 only when every pre-existing case is neutral, 1 when one is not, 2 on a usage or reading error.
// The rule, in plain words, is in tests/golden/README.md ("A conversion is neutral when").
//
// A case is neutral when, for every step, these are byte-identical before and after: the request, the response (status,
// headers, set-cookie values, body), and what the step dumped of the databases, R2 and KV; the final dump; and the
// sequence of every effect that is not a D1 statement (outgoing fetch, Workers AI, R2, KV, console, waitUntil, rate
// limits, clock moves, interleave markers), each with its step and phase. Only the D1 entries (`d1` and `d1-batch`: SQL
// text, binds, count, batch boundaries and results) may differ.
//
// Order against D1 matters in one way, and the tool checks it separately. Remove the D1 entries from both logs and the
// remaining sequences must match. Then, per step, find the first and the last D1 statement that wrote (an INSERT, UPDATE,
// DELETE, REPLACE or schema statement that ran: a failed statement and a batch that did not commit wrote nothing). Each
// non-D1 effect sits before the first write, between the first and last, or after the last (or the step has no write).
// An effect whose place changed (an email that went out after the write and now goes out before it) changes what state
// exists when the email or Stripe call is made, so that is a failure unless the case is named, with a reason, in the file
// given to `--allow-positions`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";

const DIRECTORY = "tests/golden/fixtures";
const SHORT = 160;

const isD1 = (effect) => effect.kind === "d1" || effect.kind === "d1-batch";

const show = (value) => {
	const text = JSON.stringify(value);

	if (text === undefined) return "(absent)";

	return text.length > SHORT
		? `${text.slice(0, SHORT)}... (${text.length} characters)`
		: text;
};

/** SQL with comments and string literals removed, so a keyword inside either is not read as a statement. */
const bare = (sql) =>
	sql
		.replace(/--[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/'(?:[^']|'')*'/g, "''")
		.trim();

/** Whether the SQL text changes the database: its first keyword, or the statement a WITH ends in. */
export function isWriteSql(sql) {
	const text = bare(sql);

	if (/^(insert|update|delete|replace|create|drop|alter)\b/i.test(text))
		return true;

	return (
		/^with\b/i.test(text) && /\)\s*(insert|update|delete|replace)\b/i.test(text)
	);
}

/** Whether a D1 entry wrote: a statement that ran without throwing, or a batch that committed. */
export function wrote(effect) {
	if (effect.kind === "d1")
		return !effect.outcome?.threw && isWriteSql(effect.sql);

	if (effect.kind === "d1-batch")
		return (
			effect.result === "committed" &&
			effect.statements.some((statement) => isWriteSql(statement.sql))
		);

	return false;
}

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
		case "interleave":
			return `interleave "${effect.label}"`;
		case "rate-limit":
			return `rate-limit ${effect.binding}`;
		default:
			return effect.kind;
	}
}

/** Where a non-D1 effect sits among a step's writes: given the log index of the first and last write (or -1). */
const place = (index, first, last) => {
	if (first === -1) return "in a step with no write";

	if (index < first) return "before the first write";

	if (index > last) return "after the last write";

	return "between the first and last write";
};

/** The place of every non-D1 effect of a log, in log order, as { step, effect, place }. */
export function places(effects) {
	const found = [];

	for (const [index, effect] of effects.entries()) {
		if (isD1(effect)) continue;

		const writes = effects.flatMap((other, at) =>
			other.step === effect.step && wrote(other) ? [at] : [],
		);

		found.push({
			step: effect.step,
			effect,
			place: place(
				index,
				writes.length === 0 ? -1 : writes[0],
				writes.length === 0 ? -1 : writes[writes.length - 1],
			),
		});
	}

	return found;
}

const areaOf = (path) =>
	/\.state(\.|$)/.test(path) || path.startsWith(".final")
		? "database or store state"
		: /\.answer\./.test(path)
			? "response"
			: "step";

const rest = ({ name: _name, effects: _effects, ...others }) => others;

/**
 * Compares one case before and after a conversion.
 * Returns { status: "identical" | "d1-only" | "non-neutral", difference?, shifts }.
 */
export function compareCase(before, after) {
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

	const was = places(before.effects);
	const now = places(after.effects);

	const shifts = was.flatMap((item, index) =>
		item.place === now[index]?.place
			? []
			: [
					{
						step: item.step,
						effect: describeEffect(item.effect),
						from: item.place,
						to: now[index].place,
					},
				],
	);

	return { status: "d1-only", shifts };
}

const filled = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Compares two revisions of one fixture. `renames` maps an old case name to its new one; `allowShifts` maps a (new) case
 * name to the reason its relative D1 order may change. A mapping or an allowance that names nothing is an error.
 */
export function compareFixture(
	before,
	after,
	{ renames = {}, allowShifts = {} } = {},
) {
	const byName = (list) => new Map(list.map((entry) => [entry.name, entry]));
	const was = byName(before);
	const now = byName(after);

	for (const [from, to] of Object.entries(renames)) {
		if (!was.has(from))
			throw new Error(`rename "${from}" names no case in the earlier revision`);

		if (!now.has(to))
			throw new Error(`rename to "${to}" names no case in the later revision`);

		if (was.has(to) && from !== to)
			throw new Error(
				`rename to "${to}": the earlier revision has that name too`,
			);
	}

	for (const [name, reason] of Object.entries(allowShifts))
		if (!filled(reason))
			throw new Error(`allowance for "${name}" has no reason`);

	/**
	 * @type {{ identical: string[], d1Only: string[], nonNeutral: { name: string }[], shifted: { name: string, reason: string | null, shifts: object[] }[], added: string[], removed: string[], renamed: { from: string, to: string, status: string }[], unusedAllowances: string[], neutral?: boolean }}
	 */
	const result = {
		identical: [],
		d1Only: [],
		nonNeutral: [],
		shifted: [],
		added: [],
		removed: [],
		renamed: [],
		unusedAllowances: [],
	};

	const matched = new Set();
	const usedAllowances = new Set();

	for (const old of before) {
		const to = renames[old.name] ?? old.name;
		const next = now.get(to);

		if (!next) {
			result.removed.push(old.name);
			continue;
		}

		matched.add(to);

		const outcome = compareCase(old, next);
		const label = to === old.name ? old.name : `${old.name} -> ${to}`;

		if (to !== old.name)
			result.renamed.push({ from: old.name, to, status: outcome.status });

		if (outcome.status === "non-neutral") {
			result.nonNeutral.push({ name: label, ...outcome.difference });
			continue;
		}

		if (outcome.shifts.length > 0) {
			const reason = allowShifts[to];

			if (reason !== undefined) usedAllowances.add(to);

			result.shifted.push({
				name: label,
				reason: reason ?? null,
				shifts: outcome.shifts,
			});
		}

		(outcome.status === "identical" ? result.identical : result.d1Only).push(
			label,
		);
	}

	for (const name of now.keys())
		if (!matched.has(name)) result.added.push(name);

	for (const name of Object.keys(allowShifts))
		if (!usedAllowances.has(name)) result.unusedAllowances.push(name);

	result.neutral =
		result.nonNeutral.length === 0 &&
		result.removed.length === 0 &&
		result.shifted.every((item) => item.reason !== null) &&
		result.unusedAllowances.length === 0;

	return result;
}

function print(fixture, result) {
	const bad = result.nonNeutral.length;

	console.log(
		`${fixture}: ${result.identical.length} identical, ${result.d1Only.length} neutral with D1 changes, ${bad} NOT neutral, ${result.added.length} added, ${result.removed.length} removed, ${result.renamed.length} renamed`,
	);

	for (const item of result.nonNeutral)
		console.log(
			`  NOT neutral: ${item.name}\n    first difference, ${item.area}: ${item.path}\n      -  ${show(item.expected)}\n      +  ${show(item.actual)}`,
		);

	for (const item of result.shifted) {
		console.log(
			`  ${item.reason === null ? "FAILS: a non-D1 effect moved against the writes" : "allowed: a non-D1 effect moved against the writes"}: ${item.name}${item.reason === null ? "" : ` (${item.reason})`}`,
		);

		for (const shift of item.shifts.slice(0, 10))
			console.log(
				`    step ${shift.step}: ${shift.effect}: ${shift.from} -> ${shift.to}`,
			);

		if (item.shifts.length > 10)
			console.log(`    ... ${item.shifts.length - 10} more`);
	}

	for (const name of result.removed)
		console.log(`  removed case (NOT neutral): ${name}`);

	for (const item of result.renamed)
		console.log(`  renamed case: ${item.from} -> ${item.to} (${item.status})`);

	for (const name of result.added)
		console.log(`  added case (not compared): ${name}`);

	for (const name of result.unusedAllowances)
		console.log(`  FAILS: allowance for "${name}" matches no moved effect`);
}

const namesAt = (revision) => {
	const strip = (path) =>
		path.replace(/^.*\//, "").replace(/\.json(\.gz)?$/, "");

	if (revision === undefined)
		return readdirSync(DIRECTORY)
			.filter((file) => /\.json(\.gz)?$/.test(file))
			.map(strip);

	return execFileSync(
		"git",
		["ls-tree", "--name-only", revision, `${DIRECTORY}/`],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter((file) => /\.json(\.gz)?$/.test(file))
		.map(strip);
};

const readMap = (file) => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(`cannot read ${file} (${error.message})`);
	}
};

/** `{ fixture: { name: value } }` as an allow file holds it, read for one fixture. */
const section = (file, fixture) => {
	if (!file) return {};

	const all = readMap(file);

	return all !== null && typeof all === "object" ? (all[fixture] ?? {}) : {};
};

function run(target, from, to, flags) {
	const fixtures =
		target === "--all"
			? [...new Set([...namesAt(from), ...namesAt(to)])].sort()
			: [target.replace(/\.json(\.gz)?$/, "")];

	let neutral = true;
	let unchanged = 0;

	for (const fixture of fixtures) {
		const before = fromRevision(fixture, from);
		const after = to ? fromRevision(fixture, to) : fromDisk(fixture);

		const result = compareFixture(before, after, {
			renames: section(flags.renames, fixture),
			allowShifts: section(flags.positions, fixture),
		});

		const same =
			result.identical.length === before.length &&
			result.added.length === 0 &&
			result.removed.length === 0;

		if (target === "--all" && same) {
			unchanged += 1;
			continue;
		}

		print(fixture, result);
		neutral &&= result.neutral;
	}

	if (target === "--all")
		console.log(
			`${fixtures.length - unchanged} of ${fixtures.length} fixtures differ`,
		);

	console.log(
		neutral ? "golden:neutral: NEUTRAL" : "golden:neutral: NOT NEUTRAL",
	);

	return neutral;
}

function main(argv) {
	const positional = [];
	const flags = {};

	for (let at = 0; at < argv.length; at += 1) {
		if (argv[at] === "--allow-renames") flags.renames = argv[++at];
		else if (argv[at] === "--allow-positions") flags.positions = argv[++at];
		else positional.push(argv[at]);
	}

	const [target, from = "HEAD", to] = positional;

	const missing = ["--allow-renames", "--allow-positions"].some(
		(flag) => argv.includes(flag) && !argv[argv.indexOf(flag) + 1],
	);

	if (!target || missing) {
		console.error(
			"usage: golden-neutral.mjs <fixture|--all> [<from> [<to>]] [--allow-renames <file>] [--allow-positions <file>]",
		);
		process.exit(2);
	}

	try {
		process.exit(run(target, from, to, flags) ? 0 : 1);
	} catch (error) {
		console.error(
			`golden:neutral: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(2);
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	main(process.argv.slice(2));
