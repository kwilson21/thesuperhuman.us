// Proves that a fixture format re-record changed only what it is allowed to: format 3 to 4 (see ALLOWED below), or
// format 4 to 5 (see ALLOWED_PHASES).
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

/**
 * What the format 4 to format 5 re-record may change, and nothing else. Format 5 decides the phase of an effect, and the
 * state at the response, by what the response waited for instead of by when the effect happened to start:
 *
 * - `format` goes from 4 to 5, and both cases have the whole shape the formats require;
 * - an effect's `phase` may change from "request" to "background", never the other way: work the response did not wait
 *   for is no longer reported as started in the request;
 * - a step's `digest.atResponse` may differ: work not waited for has not begun when the response is read;
 * - the `state` of a `waitUntil` entry may differ, for the same reason: work handed to waitUntil begins after the call;
 * - the lines the route writes itself (`waitUntil`, `waitUntil-settled`, `console`) may sit at another place among the
 *   effects, because an effect now takes its place when it is released, not when it was first called. Every other effect
 *   (D1 statements and batches, R2, KV, fetch, AI, rate limits, markers) keeps its order, content and `state` exactly, and
 *   the written lines keep their order and content exactly (a `waitUntil` entry's `state` aside).
 *
 * Everything else (requests, answers, the digest after each step, dumps, the final state) is compared exactly.
 */
export const ALLOWED_PHASES = {
	fromFormat: 4,
	toFormat: 5,
};

const WRITTEN = new Set(["waitUntil", "waitUntil-settled", "console"]);

const isWritten = (effect) => WRITTEN.has(effect.kind);

const json = (value) => JSON.stringify(value);

const withoutPhase = ({ phase: _phase, ...rest }) => rest;

/** Which entries of a log are the route's own lines ("w") and which are effects ("e"), in order. */
const layout = (effects) =>
	effects.map((effect) => (isWritten(effect) ? "w" : "e")).join("");

/**
 * Compares a format 4 case with its format 5 recording as ALLOWED_PHASES says. Returns the counts of what changed, and
 * pushes a problem for the first thing that is not allowed. Each rule is per step: a relabel is allowed only as a suffix
 * of its step (in the later recording), and the digest at the response and the state of a waitUntil entry may differ only
 * in a step that holds a relabel. Counts that do not match are a problem, never a thrown error.
 */
function provePhases(old, next, problems) {
	const stats = { relabelled: 0, atResponse: 0, waitUntilState: 0, moved: 0 };

	const fail = (what) => {
		problems.push(`${old.name}: ${what}`);

		return stats;
	};

	try {
		assertCompleteRecord(old);
		assertCompleteRecord(next);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}

	if (old.steps.length !== next.steps.length)
		return fail(`${old.steps.length} steps before, ${next.steps.length} after`);

	if (old.effects.length !== next.effects.length)
		return fail(
			`${old.effects.length} effects before, ${next.effects.length} after`,
		);

	const effectsOld = old.effects.filter((effect) => !isWritten(effect));
	const effectsNext = next.effects.filter((effect) => !isWritten(effect));
	const writtenOld = old.effects.filter(isWritten);
	const writtenNext = next.effects.filter(isWritten);

	if (effectsOld.length !== effectsNext.length)
		return fail(
			`${effectsOld.length} effects before, ${effectsNext.length} after, not counting the lines the route writes`,
		);

	if (writtenOld.length !== writtenNext.length)
		return fail(
			`${writtenOld.length} lines written by the route before, ${writtenNext.length} after`,
		);

	/** The steps that hold a relabelled entry, and the later entries that were relabelled. */
	const relabelledSteps = new Set();
	const relabelled = new Set();

	/** Whether the later phase is allowed; counts a relabel and records it. */
	const phaseOk = (before, after) => {
		if (before.phase === after.phase) return true;

		if (before.phase !== "request" || after.phase !== "background")
			return false;

		stats.relabelled += 1;
		relabelledSteps.add(before.step);
		relabelled.add(after);

		return true;
	};

	for (const [index, effect] of effectsOld.entries()) {
		const after = effectsNext[index];

		if (json(withoutPhase(effect)) !== json(withoutPhase(after)))
			return fail(`effect ${index} (${effect.kind}) differs beyond its phase`);

		if (!phaseOk(effect, after))
			return fail(
				`effect ${index} (${effect.kind}) went from ${effect.phase} to ${after.phase}`,
			);
	}

	for (const [index, effect] of writtenOld.entries()) {
		const after = writtenNext[index];
		const { state: _was, ...before } = withoutPhase(effect);
		const { state: _now, ...later } = withoutPhase(after);

		if (json(before) !== json(later))
			return fail(
				`line ${index} (${effect.kind}) differs beyond its phase, state and place`,
			);

		if (!phaseOk(effect, after))
			return fail(
				`line ${index} (${effect.kind}) went from ${effect.phase} to ${after.phase}`,
			);
	}

	// A relabelled effect must be followed, in the later recording, only by background effects of its step.
	const flippedSteps = new Set();

	for (const entry of next.effects) {
		if (relabelled.has(entry)) flippedSteps.add(entry.step);
		else if (flippedSteps.has(entry.step) && entry.phase !== "background")
			return fail(
				`step ${entry.step}: a ${entry.kind} after a relabelled effect is still request, so the relabelled effects are not a suffix of the step`,
			);
	}

	// A line the route wrote may sit anywhere within its own step: no effect of an earlier step after it, none of a later step before it.
	const stepsBefore = [];
	const stepsAfter = [];
	let highest = Number.NEGATIVE_INFINITY;

	for (const entry of next.effects) {
		stepsBefore.push(highest);

		if (!isWritten(entry)) highest = Math.max(highest, entry.step);
	}

	let lowest = Number.POSITIVE_INFINITY;

	for (const entry of next.effects.toReversed()) {
		stepsAfter.unshift(lowest);

		if (!isWritten(entry)) lowest = Math.min(lowest, entry.step);
	}

	for (const [position, entry] of next.effects.entries()) {
		if (!isWritten(entry)) continue;

		if (stepsBefore[position] > entry.step || stepsAfter[position] < entry.step)
			return fail(
				`line ${entry.kind} at step ${entry.step} sits outside its own step`,
			);
	}

	// The states of waitUntil entries and the digests at the response may change only in a step that holds a relabel.
	for (const [index, effect] of writtenOld.entries()) {
		const after = writtenNext[index];

		if (json(effect.state) === json(after.state)) continue;

		if (effect.kind !== "waitUntil")
			return fail(`line ${index} (${effect.kind}) has another state`);

		if (!relabelledSteps.has(effect.step))
			return fail(
				`waitUntil ${index} changed its state in step ${effect.step}, which holds no relabelled effect`,
			);

		stats.waitUntilState += 1;
	}

	const atResponseChanged = [];

	for (const [index, step] of old.steps.entries()) {
		const after = next.steps[index];
		const { atResponse: was, ...before } = step.digest;
		const { atResponse: now, ...later } = after.digest;

		if (json({ ...step, digest: before }) !== json({ ...after, digest: later }))
			return fail(`step ${index} differs beyond its digest at the response`);

		if (json(was) !== json(now)) atResponseChanged.push(index);
	}

	for (const index of atResponseChanged) {
		if (!relabelledSteps.has(index))
			return fail(
				`step ${index}: the digest at the response changed, but no effect of the step was relabelled`,
			);

		stats.atResponse += 1;
	}

	if (layout(old.effects) !== layout(next.effects)) stats.moved += 1;

	const { effects: _a, steps: _b, format: _c, ...restOld } = old;
	const { effects: _d, steps: _e, format: _f, ...restNext } = next;

	if (json(restOld) !== json(restNext))
		return fail("the final state or another field of the case differs");

	return stats;
}

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

	const phases = {
		cases: 0,
		relabelled: 0,
		atResponse: 0,
		waitUntilState: 0,
		moved: 0,
	};

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

		if (
			old.format === ALLOWED_PHASES.fromFormat &&
			next.format === ALLOWED_PHASES.toFormat
		) {
			const stats = provePhases(old, next, problems);

			if (Object.values(stats).some((count) => count > 0)) phases.cases += 1;

			for (const key of Object.keys(stats)) phases[key] += stats[key];

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

	return { problems, counts, touched, phases };
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
	const changedPhases = new Map();

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

		if (proved.phases.cases > 0) changedPhases.set(fixture, proved.phases);

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

	const sum = (key) =>
		[...changedPhases.values()].reduce((total, item) => total + item[key], 0);

	if (changedPhases.size > 0)
		console.log(
			`format 4 to 5: ${sum("cases")} cases differ in ${changedPhases.size} fixtures: ${sum("relabelled")} effects relabelled request to background, ${sum("atResponse")} digests at the response, ${sum("waitUntilState")} waitUntil states, ${sum("moved")} cases where a written line (waitUntil, console) sits at another place${[
				...changedPhases,
			]
				.map(
					([fixture, item]) =>
						`\n  ${fixture}: ${item.cases} cases, ${item.relabelled} relabelled, ${item.atResponse} at the response, ${item.waitUntilState} waitUntil states, ${item.moved} moved`,
				)
				.join("")}`,
		);

	for (const problem of problems.slice(0, 20))
		console.log(`  DIFFERENT: ${problem}`);

	console.log(
		problems.length === 0
			? changedPhases.size > 0
				? "golden-format-proof: the only differences are the format number, effects relabelled request to background, the digests at the response, the states of waitUntil entries, and the place of the lines a route writes itself"
				: "golden-format-proof: the only differences are the format number, the `touched` sets, and read change counts that now say 0"
			: `golden-format-proof: ${problems.length} problems, so this is not only a format change`,
	);

	process.exit(problems.length === 0 ? 0 : 1);
}

if (ranDirectly(import.meta.url)) main(process.argv.slice(2));
