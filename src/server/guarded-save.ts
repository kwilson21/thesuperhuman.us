// The read, decide and save loop every converted area shares. The rule decides in TypeScript; the save's guard raises an
// error when what the rule read has changed since, and this asks again on fresh facts. Copied from kwilson21/tally
// `src/db/guarded-save.ts` and `src/db/errors.ts`, with the guard recognition changed to this site's two guard forms.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

/** The save found the facts changed since the rule read them. Never shown to a person: the rule is asked again. */
export class ChangedSinceRead extends Data.TaggedError("ChangedSinceRead") {}

const MAX_CAUSE_DEPTH = 5;

/** Whether the message of `cause`, or of any cause down its chain (five levels at most, so a loop ends), matches. */
function chainMatches(cause: Error, pattern: RegExp): boolean {
	let current: unknown = cause;

	for (
		let depth = 0;
		depth <= MAX_CAUSE_DEPTH && current instanceof Error;
		depth++
	) {
		if (pattern.test(current.message)) return true;
		current = current.cause;
	}

	return false;
}

/**
 * The site's batch guard is `SELECT CASE WHEN <still true> THEN 1 ELSE json_extract('<message>','$') END`. SQLite
 * cannot raise in a plain statement, so a guard that fails asks json_extract to read its message as JSON, and that
 * raises "malformed JSON" (D1 prefixes it with D1_ERROR). Nothing else in the site's SQL parses JSON text that is not
 * JSON, so this wording is how a failed guard is told from any other failure.
 */
const GUARD_RAISED = /malformed JSON/;

/** True when a database error is a failed batch guard (see GUARD_RAISED). */
export function isGuardRaised(error: Error): boolean {
	return chainMatches(error, GUARD_RAISED);
}

const UNIQUE = /UNIQUE/;

/** True when a database error is a UNIQUE violation, found down the cause chain. Non-Error values never are. */
export function isUniqueViolation(cause: unknown): boolean {
	return cause instanceof Error && chainMatches(cause, UNIQUE);
}

/**
 * The second guard form: `UPDATE ... WHERE <what was read> RETURNING ...`, which returns no row when what was read
 * has changed. Gives the returned row, or fails with ChangedSinceRead when there is none.
 */
export const rowOrChanged = <Row>(rows: readonly Row[]) => {
	const row = rows.at(0);

	return row === undefined
		? Effect.fail(new ChangedSinceRead())
		: Effect.succeed(row);
};

/**
 * Reads the facts, asks the rule and saves what it decides. When the save's guard raises (another writer changed the
 * facts between the read and the save), it reads and decides again, three times in all, so two taps at once both
 * count; it then gives up with the `gaveUp` error. Answers with the facts it decided on, what the rule decided (nothing,
 * when what was asked is already true), and what the save answered, which is there only when something was saved.
 */
export const decideAndSave = <F, W, E, S, E2, R1, R2>(steps: {
	facts: Effect.Effect<F, never, R1>;
	decide: (facts: F) => Effect.Effect<Option.Option<W>, E>;
	save: (write: W) => Effect.Effect<S, ChangedSinceRead | E2, R2>;
	gaveUp: string;
}) =>
	Effect.gen(function* () {
		const facts = yield* steps.facts;
		const decided = yield* steps.decide(facts);

		const saved = Option.isSome(decided)
			? yield* steps.save(decided.value)
			: undefined;

		return { facts, decided, saved };
	}).pipe(
		Effect.retry({ times: 2, while: Predicate.isTagged("ChangedSinceRead") }),
		Effect.catchTag("ChangedSinceRead", () =>
			Effect.die(new Error(steps.gaveUp)),
		),
	);

/**
 * Runs a save and says what its failure was: a failed batch guard (isGuardRaised) becomes ChangedSinceRead, a name the
 * unique indexes refuse becomes the refusal `whenNameTaken` makes (for a save that stores a name), and anything else is
 * a defect, so the request fails as it would have.
 */
export const guardedSave = <A, E = never>(
	run: () => Promise<A>,
	whenNameTaken?: () => E,
) =>
	Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
		Effect.catch((cause): Effect.Effect<never, ChangedSinceRead | E> => {
			if (cause instanceof Error && isGuardRaised(cause))
				return Effect.fail(new ChangedSinceRead());

			return whenNameTaken && isUniqueViolation(cause)
				? Effect.fail(whenNameTaken())
				: Effect.die(cause);
		}),
	);
