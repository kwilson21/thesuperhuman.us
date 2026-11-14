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
// Different formats cannot be compared with each other: the digests exist on one side only, or differ in kind, so
// neutrality cannot be shown, and the tool says so and exits 1. Within one format below 4 (recorded before the state at
// each outside effect and at the response was complete) a case whose D1 statements differ is NOT COMPARABLE too, since an
// effect may have moved across a write unseen; a case with identical D1 statements is compared field for field as usual.
// The older recorder's fixtures (contact, resume-request, resume-approve) have no D1 entries, so they are always compared
// field for field: what the tool shows for them is that responses and every KV and fetch effect are identical.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { differences, fromDisk, fromRevision } from "./golden-diff.mjs";
import { ranDirectly } from "./ran-directly.mjs";

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

const formatOf = (entry) => (entry.format === undefined ? 1 : entry.format);

/** The formats this tool understands. Any other number, higher or not, is an error, never "not comparable". */
export const KNOWN_FORMATS = [1, 2, 3, 4, 5];

/** The first format that records the state of the databases at every outside effect and at the response. Every format from here on has the full shape. */
const STATE_FORMAT = 4;

/** The newest format. Format 5 has the shape of format 4, but `phase` and the digest at the response mean what the response waited for (tests/golden/README.md). */
export const CURRENT_FORMAT = 5;

/** Log entries that carry no `state`: D1 statements and the harness's own markers (the same set as tests/golden/harness/log.ts). */
export const UNSTATED_KINDS = new Set([
	"d1",
	"d1-batch",
	"interleave",
	"trigger-hit",
	"advance",
]);

const HEX = /^[0-9a-f]{64}$/;

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** A list of table names in strictly increasing order: sorted, and no name twice. */
const isSortedNames = (list) =>
	Array.isArray(list) &&
	list.every(
		(name, index) =>
			typeof name === "string" &&
			name !== "" &&
			(index === 0 || list[index - 1] < name),
	);

/**
 * Checks the whole shape of a current-format case, and throws an Error naming the case, the step or the effect and the
 * field. Without it two records that both stopped recording a field would agree on "missing against missing" and a
 * comparison would pass.
 */
export function assertCompleteRecord(entry) {
	const fail = (where, what) => {
		throw new Error(`case "${entry?.name}", ${where}: ${what}`);
	};

	const hex = (where, field, value) => {
		if (typeof value !== "string" || !HEX.test(value))
			fail(
				where,
				`${field} must be a SHA-256 (64 hex characters), got ${show(value)}`,
			);
	};

	const sets = (where, field, value) => {
		if (value === null || typeof value !== "object" || Array.isArray(value))
			fail(where, `${field} is missing`);

		hex(where, `${field}.music`, value.music);
		hex(where, `${field}.publication`, value.publication);

		if (!isSortedNames(value.touched))
			fail(
				where,
				`${field}.touched must be a sorted list of table names, got ${show(value.touched)}`,
			);
	};

	if (
		entry === null ||
		typeof entry !== "object" ||
		typeof entry.name !== "string"
	)
		throw new Error("a case has no name");

	if (!Array.isArray(entry.steps) || entry.steps.length === 0)
		fail("the case", "steps is missing or empty");

	if (!Array.isArray(entry.effects)) fail("the case", "effects is missing");

	for (const [index, step] of entry.steps.entries()) {
		const where = `step ${index}`;

		if (step === null || typeof step !== "object")
			fail(where, "is not an object");

		if (step.digest === null || typeof step.digest !== "object")
			fail(where, "digest is missing");

		for (const field of ["music", "publication", "r2", "kv"])
			hex(where, `digest.${field}`, step.digest[field]);

		sets(where, "digest.atResponse", step.digest.atResponse);
	}

	for (const [index, effect] of entry.effects.entries()) {
		const where = `effect ${index} (${effect?.kind === undefined ? "no kind" : describeEffect(effect)})`;

		if (
			effect === null ||
			typeof effect !== "object" ||
			typeof effect.kind !== "string"
		)
			fail(`effect ${index}`, "has no kind");

		if (
			!Number.isInteger(effect.step) ||
			effect.step < 0 ||
			effect.step >= entry.steps.length
		)
			fail(
				where,
				`step must be the index of one of the ${entry.steps.length} steps, got ${show(effect.step)}`,
			);

		if (effect.phase !== "request" && effect.phase !== "background")
			fail(
				where,
				`phase must be "request" or "background", got ${show(effect.phase)}`,
			);

		if (!UNSTATED_KINDS.has(effect.kind)) sets(where, "state", effect.state);

		if (effect.kind === "d1") {
			const outcome = effect.outcome;

			if (outcome === null || typeof outcome !== "object")
				fail(where, "outcome is missing");

			// An outcome either threw (with a message) or changed a count of rows; `threw: null` is neither.
			if ("threw" in outcome) {
				if (typeof outcome.threw !== "string" || outcome.threw === "")
					fail(
						where,
						`outcome.threw must be a message, got ${show(outcome.threw)}`,
					);
			} else if (!isCount(outcome.changes))
				fail(
					where,
					`outcome.changes must be a count of rows, got ${show(outcome.changes)}`,
				);
		}

		if (effect.kind === "d1-batch") {
			if (!Array.isArray(effect.statements))
				fail(where, "statements is missing");

			for (const [at, statement] of effect.statements.entries())
				if (
					effect.result === "committed" &&
					!isCount(statement?.outcome?.changes)
				)
					fail(
						where,
						`statements[${at}].outcome.changes must be a count of rows, got ${show(statement?.outcome?.changes)}`,
					);
		}
	}

	const final = entry.finalState;

	if (final === null || typeof final !== "object")
		fail("the case", "finalState is missing");

	for (const database of ["music", "publication"]) {
		const part = final[database];

		if (part === null || typeof part !== "object")
			fail("finalState", `${database} is missing`);

		hex("finalState", `${database}.sha256`, part.sha256);

		if (
			part.tables === null ||
			typeof part.tables !== "object" ||
			Array.isArray(part.tables)
		)
			fail("finalState", `${database}.tables is missing`);

		for (const [table, digest] of Object.entries(part.tables)) {
			if (!isCount(digest?.rows))
				fail(
					"finalState",
					`${database}.tables.${table}.rows must be a count of rows`,
				);

			hex("finalState", `${database}.tables.${table}.sha256`, digest?.sha256);
		}
	}

	for (const store of ["r2", "kv"])
		if (
			final[store] === undefined ||
			final[store] === null ||
			typeof final[store] !== "object"
		)
			fail("finalState", `${store} is missing`);
}

/** Throws unless the format is one this tool understands. */
function assertKnownFormat(entry, side) {
	const format = formatOf(entry);

	if (!KNOWN_FORMATS.includes(format))
		throw new Error(
			`case "${entry.name}" (${side}): format ${show(entry.format)} is not one this tool understands (it knows ${KNOWN_FORMATS[0]} to ${KNOWN_FORMATS[KNOWN_FORMATS.length - 1]}), so it cannot say anything about it`,
		);
}

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
	assertKnownFormat(before, "earlier revision");
	assertKnownFormat(after, "later revision");

	for (const entry of [before, after])
		if (formatOf(entry) >= STATE_FORMAT) assertCompleteRecord(entry);

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

	// Before format 4 nothing records the database state at each outside effect, so a case with D1 statements that is not
	// byte-identical cannot be shown not to have moved an effect across a write, whatever else differs.
	if (
		formatOf(before) < STATE_FORMAT &&
		[...before.effects, ...after.effects].some(isD1)
	)
		return {
			status: "not-comparable",
			difference: {
				area: "no state at each outside effect",
				path: "case",
				reason: `format ${formatOf(before)} recordings do not hold the database state at each outside effect, so a difference in a case with D1 statements cannot be shown not to have moved an effect across a write`,
				expected: formatOf(before),
				actual: formatOf(after),
			},
		};

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

		const how = /\.state\.[a-z]+/.test(path)
			? "the database or the tables written before this effect changed, so a write moved or changed"
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
	// Every case of both revisions is read before any is compared, the added and the removed ones included.
	for (const [side, list] of [
		["earlier revision", before],
		["later revision", after],
	])
		for (const entry of list) {
			assertKnownFormat(entry, side);

			if (formatOf(entry) >= STATE_FORMAT) assertCompleteRecord(entry);
		}

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
	 * @type {{ identical: string[], d1Only: string[], nonNeutral: { name: string }[], notComparable: { name: string, expected?: number, actual?: number, reason?: string }[], added: string[], removed: string[], renamed: { from: string, to: string, status: string }[], compared: number, neutral: boolean }}
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
		const [{ expected, actual, reason }] = result.notComparable;

		console.log(
			reason
				? `  NOT COMPARABLE: ${result.notComparable.length} cases differ, have D1 statements, and were recorded in format ${expected}, which ${reason.replace(/^format \d+ recordings do not hold/, "does not hold")}.`
				: `  NOT COMPARABLE: ${result.notComparable.length} cases are format ${expected} before and format ${actual} after. The digests differ between formats (format 5 records whether the response waited for an effect, where format 4 recorded when it started), so neutrality cannot be shown across a format change. Re-record the earlier revision's fixture with the later revision's harness first.`,
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
		let result;

		try {
			result = compareFixture(before, after, { renames: renames[fixture] });
		} catch (error) {
			throw new Error(
				`fixture "${fixture}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}

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

if (ranDirectly(import.meta.url)) main(process.argv.slice(2));
