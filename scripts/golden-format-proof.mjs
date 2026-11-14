// Proves that a fixture format re-record changed only what it is allowed to: format 3 to 4 (see ALLOWED below), or
// format 4 to 5 (see ALLOWED_PHASES).
//
//   node scripts/golden-format-proof.mjs <from> [<to>]
//
// For every fixture, in either revision, and every case, the later case must equal the earlier one field for field,
// apart from the allowed differences. Prints the number of fixtures and cases, the size of all fixtures before and after
// (compressed as stored, and as JSON text), how many recorded change counts changed and in which fixtures, and for the
// format 4 to 5 re-record the structural checks that every changed digest at the response and waitUntil state passed (see
// ALLOWED_PHASES for exactly what those checks prove and what they do not), and exits 1 on any other difference.
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
 *
 * The changed values are then checked by structure, in every step that holds a relabel (`provePhases`):
 *
 *   1. The digest at the response, and its touched set, equal those of the LAST request-labelled effect of the step that
 *      carries a state (the response is read right after it), unless a row-changing request statement is logged after that
 *      effect. Then they are only bounded: the touched set keeps the effect's tables and the statement's own table.
 *   2. A waitUntil entry that no request effect follows has the digest at the response as its state.
 *   3. The digest at the response differs from the end of the step in each database that a relabelled statement changed
 *      rows in (a committed statement or batch with a changed count), and equals it in each database that no relabelled
 *      effect could have written to. A database a fired hook may have written to is not checked either way.
 *   4. The touched set at the response is contained in the old recording's, and in the touched set of every later
 *      background effect of the step (each is read after the response, and the set only grows within a step).
 *
 * What is proved: for every changed value of the real fixtures, the rules above hold (their counts are printed). What is
 * NOT proved: the digest at the response as a value. Neither recording holds it: the old recording took it after the
 * background work had begun, and the new one can only give the state of the last request effect, which the rules above
 * tie to it. So the exact value of a relabelled step's digest at the response is established by the harness tests
 * (tests/golden/harness/phases.test.ts), not by this proof.
 *
 * Limits: the touched set at the end of a step is not recorded, so rule 4 can only check against the later background
 * effects. Rule 3 treats a same-value UPDATE as no write, so it would reject a recording where one changed no digest; no
 * real fixture has one. A relabel of an effect that changes no row is seen only through its own recorded fields, which stay
 * exact. The statements are read from the SQL (`statementOf`); a statement that cannot be read is a write with no table.
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

const isD1 = (entry) => entry.kind === "d1" || entry.kind === "d1-batch";

/** Whether a recorded D1 entry changed rows: a statement with a changed count, or a batch that committed with one. */
const changedRows = (entry) =>
	entry.kind === "d1-batch"
		? entry.result === "committed" &&
			entry.statements.some((statement) => statement.outcome?.changes > 0)
		: entry.outcome?.changes > 0;

/** The tables a recorded D1 entry changed rows in by its own statements (a trigger's table is not named here). */
const ownTables = (entry) => {
	const statements =
		entry.kind === "d1-batch"
			? entry.result === "committed"
				? entry.statements
				: []
			: [entry];

	return statements.flatMap((statement) => {
		if (!(statement.outcome?.changes > 0)) return [];

		try {
			const { table } = statementOf(statement.sql);

			return table ? [table] : [];
		} catch {
			return [];
		}
	});
};

const databaseOf = (entry) => (entry.db === "MUSIC_DB" ? "music" : "publication");

/** The database state of a recorded entry, as the proof compares it: music, publication and the tables touched in the step. */
const stateKey = (state) =>
	json([state.music, state.publication, state.touched]);

/** The entries of step `s` of a case, each with its place in the case's log. */
const entriesOfStep = (next, s) =>
	next.effects.flatMap((entry, index) =>
		entry.step === s ? [{ entry, index }] : [],
	);

/** The last request-labelled entry of a step that carries a state: the response is read right after it (rule 1). */
const anchorOf = (items) =>
	items
		.filter(({ entry }) => entry.phase === "request" && entry.state !== undefined)
		.at(-1);

/**
 * The state the response of a step is tied to (rule 1): its anchor's, or, when the step has no entry with a state, the
 * state the step started in (the previous step's digest, no table touched). `index` is the anchor's place in the log, and
 * -1 for the start, so every request statement of the step counts as after it.
 */
const referenceOf = (items, previous) => {
	const anchor = anchorOf(items);

	if (anchor) return { state: anchor.entry.state, index: anchor.index };

	return {
		state: previous && {
			music: previous.digest.music,
			publication: previous.digest.publication,
			touched: [],
		},
		index: -1,
	};
};

/** The row-changing request statements of a step logged after `index` (rule 1: the response is only bounded when one exists). */
const requestWritesAfter = (items, index) =>
	items.filter(
		({ entry, index: at }) =>
			at > index &&
			entry.phase === "request" &&
			isD1(entry) &&
			changedRows(entry),
	);

/**
 * The databases a step's background effects may have written to: `certain` for a committed statement that changed rows,
 * `possible` for a hook that fired on a write (the hook's own writes are not recorded).
 */
const writersOf = (items) => {
	const certain = new Set();
	const possible = new Set();

	for (const { entry } of items) {
		if (entry.phase !== "background") continue;

		if (isD1(entry) && changedRows(entry)) certain.add(databaseOf(entry));

		if (
			entry.kind === "trigger-hit" &&
			entry.hits.some((hit) => hit.access === "write")
		)
			possible.add(databaseOf(entry));
	}

	return { certain, possible };
};

/**
 * Compares a format 4 case with its format 5 recording as ALLOWED_PHASES says. Returns the counts of what changed, and
 * pushes a problem for the first thing that is not allowed. Each rule is per step: a relabel is allowed only as a suffix
 * of its step (in the later recording), and the digest at the response and the state of a waitUntil entry may differ only
 * in a step that holds a relabel. The structural checks of ALLOWED_PHASES then apply to every such step. Counts that do not
 * match are a problem, never a thrown error.
 */
function provePhases(old, next, problems) {
	const stats = {
		relabelled: 0,
		atResponse: 0,
		derived: 0,
		bounded: 0,
		writerDiffer: 0,
		writerEqual: 0,
		writerHook: 0,
		waitUntilState: 0,
		waitUntilConsistent: 0,
		waitUntilNotApplicable: 0,
		moved: 0,
	};

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

	// The states of waitUntil entries may change only in a step that holds a relabel.
	const changedWaitUntil = new Set();

	for (const [index, effect] of writtenOld.entries()) {
		const after = writtenNext[index];

		if (json(effect.state) === json(after.state)) continue;

		if (effect.kind !== "waitUntil")
			return fail(`line ${index} (${effect.kind}) has another state`);

		if (!relabelledSteps.has(effect.step))
			return fail(
				`waitUntil ${index} changed its state in step ${effect.step}, which holds no relabelled effect`,
			);

		changedWaitUntil.add(after);
	}

	stats.waitUntilState = changedWaitUntil.size;

	// The digests at the response may change only in a step that holds a relabel.
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
	}

	stats.atResponse = atResponseChanged.length;

	// Rule 2: a waitUntil entry that no request effect follows is the state at the response.
	for (const [index, entry] of next.effects.entries()) {
		if (entry.kind !== "waitUntil" || !relabelledSteps.has(entry.step))
			continue;

		const changed = changedWaitUntil.has(entry);

		const followed = next.effects.some(
			(later, at) =>
				at > index &&
				later.step === entry.step &&
				later.phase === "request" &&
				!isWritten(later),
		);

		if (followed) {
			if (changed) stats.waitUntilNotApplicable += 1;

			continue;
		}

		const response = next.steps[entry.step].digest.atResponse;

		if (stateKey(entry.state) !== stateKey(response))
			return fail(
				`waitUntil ${entry.id} in step ${entry.step} has a state that differs from the digest at the response, though no request effect follows it`,
			);

		if (changed) stats.waitUntilConsistent += 1;
	}

	const changedAt = new Set(atResponseChanged);

	for (const s of [...relabelledSteps].sort((a, b) => a - b)) {
		const items = entriesOfStep(next, s);
		const final = next.steps[s].digest;
		const response = final.atResponse;
		const changed = changedAt.has(s);
		const reference = referenceOf(items, s > 0 ? next.steps[s - 1] : undefined);
		const later = requestWritesAfter(items, reference.index);

		// Rule 1.
		if (reference.state !== undefined && later.length === 0) {
			if (
				reference.state.music !== response.music ||
				reference.state.publication !== response.publication
			)
				return fail(
					`step ${s}: the digest at the response is not the state the last request effect recorded`,
				);

			if (json(reference.state.touched) !== json(response.touched))
				return fail(
					`step ${s}: the touched tables at the response are not those the last request effect recorded`,
				);

			if (changed) stats.derived += 1;
		} else {
			if (
				reference.state !== undefined &&
				!reference.state.touched.every((table) => response.touched.includes(table))
			)
				return fail(
					`step ${s}: a table touched before the last request effect is missing from the touched tables at the response`,
				);

			for (const { entry } of later)
				for (const table of ownTables(entry))
					if (!response.touched.includes(table))
						return fail(
							`step ${s}: a request write to ${table} is missing from the touched tables at the response`,
						);

			if (changed) stats.bounded += 1;
		}

		// Rule 4.
		const oldTouched = old.steps[s].digest.atResponse.touched;

		if (!response.touched.every((table) => oldTouched.includes(table)))
			return fail(
				`step ${s}: the touched tables at the response are not all in the old recording's`,
			);

		for (const { entry } of items)
			if (
				entry.phase === "background" &&
				entry.state !== undefined &&
				!response.touched.every((table) => entry.state.touched.includes(table))
			)
				return fail(
					`step ${s}: a background effect's touched tables do not contain those at the response`,
				);

		// Rule 3.
		const writers = writersOf(items);

		for (const database of ["music", "publication"]) {
			if (
				writers.certain.has(database) &&
				response[database] === final[database]
			)
				return fail(
					`step ${s}: the digest at the response equals the digest at the end of the step, though a relabelled statement wrote rows to ${database}`,
				);

			if (
				!writers.certain.has(database) &&
				!writers.possible.has(database) &&
				response[database] !== final[database]
			)
				return fail(
					`step ${s}: the digest at the response differs from the end of the step, though no relabelled effect could have written to ${database}`,
				);
		}

		if (changed) {
			if (writers.certain.size > 0) stats.writerDiffer += 1;
			else if (writers.possible.size > 0) stats.writerHook += 1;
			else stats.writerEqual += 1;
		}
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
 * The differences between two revisions of one fixture's cases, as { problems, counts, touched, phases }: `counts` is how
 * many recorded D1 change counts changed, all of them reads that now say 0; `phases` counts the format 4 to 5 checks (see
 * ALLOWED_PHASES), and `touched` lists the format 4 to 4 cases whose table sets differ.
 */
export function proveFixtureDetailed(before, after) {
	const problems = [];
	const touched = [];

	const phases = {
		cases: 0,
		relabelled: 0,
		atResponse: 0,
		derived: 0,
		bounded: 0,
		writerDiffer: 0,
		writerEqual: 0,
		writerHook: 0,
		waitUntilState: 0,
		waitUntilConsistent: 0,
		waitUntilNotApplicable: 0,
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

	if (changedPhases.size > 0)
		console.log(
			`format 4 to 5 structural checks, of the changed values: ${sum("derived")} of ${sum("atResponse")} digests at the response and touched sets equal those of the last request effect of their step, ${sum("bounded")} only bounded by it (a request write follows); the writer rule: ${sum("writerDiffer")} steps differ from their end, ${sum("writerEqual")} equal it, ${sum("writerHook")} not checked (a hook may have written); ${sum("waitUntilConsistent")} of ${sum("waitUntilState")} waitUntil states equal the digest at the response, ${sum("waitUntilNotApplicable")} not applicable (a request effect follows). Not proved: the value of the digest at the response (see ALLOWED_PHASES)`,
		);

	for (const problem of problems.slice(0, 20))
		console.log(`  DIFFERENT: ${problem}`);

	console.log(
		problems.length === 0
			? changedPhases.size > 0
				? "golden-format-proof: the only differences are the format number, effects relabelled request to background, the digests at the response, the states of waitUntil entries, and the place of the lines a route writes itself, and every changed value passes the structural checks"
				: "golden-format-proof: the only differences are the format number, the `touched` sets, and read change counts that now say 0"
			: `golden-format-proof: ${problems.length} problems, so this is not only a format change`,
	);

	process.exit(problems.length === 0 ? 0 : 1);
}

if (ranDirectly(import.meta.url)) main(process.argv.slice(2));
