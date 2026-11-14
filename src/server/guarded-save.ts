// The read, decide and save loop every converted area shares. The rule decides in TypeScript; the save's guard raises an
// error when what the rule read has changed since, and this asks again on fresh facts. Copied from kwilson21/tally
// `src/db/guarded-save.ts` and `src/db/errors.ts`; the guard recognition is a parameter per call, as it is there, and
// `raisedByJsonGuard` is this site's default for the guard form its SQL uses today.
//
// Rules every later layer relies on:
//
// (a) A save passed to `decideAndSave` is database work only. The whole save may run up to three times, so it must not
//     send an email, call Stripe or write to R2. Outside work belongs before or after the loop, once.
// (b) A SQL guard only signals "the facts changed since they were read". Every business condition a guard encodes (for
//     example "wait before requesting another link", "link already used", "already signed", "offer still sending")
//     must ALSO be decided in the rule as a named refusal, so the retry on fresh facts ends in that refusal instead of
//     spinning. A guard that fires for a business reason the rule does not know about burns three tries and then ends
//     in `SaveKeptChanging`.
// (c) A check against what the page saw (`expectedUpdatedAt` and similar) is a refusal in the rule, never something a
//     retry may silently satisfy: a retry reads fresh facts, so it would pass a check the person's page had failed.
// (d) `isUniqueViolation` also matches primary-key collisions ("UNIQUE constraint failed" is SQLite's wording for
//     both), so a save that stores a name must not also insert a row whose primary key can collide.
//
// Anything that is not a recognised guard or a unique violation stays a defect. That is NOT "fails as it would have" for
// every route. Two differences from today's answers are choices the route's own layer must make explicit, and the owner
// decides each one:
//
// (e) An unrelated database error is a defect here: the route answers 500. Some routes answer 409 for it today: for
//     example `src/pages/api/owner/requests/[id].ts` catches ANY error from `changeOwnerRequest` and answers 409.
//     Reproducing today's answer means that route catching that case deliberately (and saying so), not relying on this.
// (f) With `rowOrChanged`, a lost race is retried on fresh facts and may then succeed, where today an empty `RETURNING`
//     answers 409 at once. For exact parity a route maps the empty `RETURNING` straight to its refusal and does not
//     use `rowOrChanged`.
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

/** Says whether a database error is the failure of a batch guard. Each call to `guardedSave` names its own. */
export type IsGuard = (error: Error) => boolean;

/**
 * The site's batch guard is `SELECT CASE WHEN <still true> THEN 1 ELSE json_extract('<message>','$') END`. SQLite
 * cannot raise in a plain statement, so a guard that fails asks json_extract to read its message as JSON, and that
 * raises "malformed JSON" (D1 prefixes it with D1_ERROR).
 *
 * Limits: the guard's own sentence ('Template changed', 'Link already consumed') never appears in the error, so this
 * cannot say which guard fired, nor tell guards apart. It also cannot tell a failed guard from any other
 * `json_each`, `json_extract` or `json_set` over a stored value that is not JSON (several JSON columns have no
 * `json_valid` check, and some guard batches run `json_each` over stored columns): that data error reads the same and
 * would be retried as a guard, then end in `SaveKeptChanging`. A caller whose batch also parses stored JSON passes its
 * own recogniser instead.
 */
const JSON_GUARD_RAISED = /malformed JSON/;

/** The default `IsGuard` for this site's raise form (see JSON_GUARD_RAISED for what it cannot tell apart). */
export function raisedByJsonGuard(error: Error): boolean {
	return chainMatches(error, JSON_GUARD_RAISED);
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
 * The save's guard kept raising across every try: the facts changed under each attempt. Each route must map it
 * explicitly to the answer it gives today (a 429, a 401 or a 409); it is not a defect and not a refusal of the rule.
 */
export class SaveKeptChanging extends Data.TaggedError("SaveKeptChanging") {}

/**
 * Reads the facts, asks the rule and saves what it decides. When the save's guard raises (another writer changed the
 * facts between the read and the save), it reads and decides again, three times in all, so two taps at once both
 * count; it then fails with `SaveKeptChanging`. Answers with the facts it decided on, what the rule decided (nothing,
 * when what was asked is already true), and what the save answered, which is there only when something was saved.
 */
export const decideAndSave = <F, W, E, S, E0, E2, R1, R2>(steps: {
	facts: Effect.Effect<F, E0, R1>;
	decide: (facts: F) => Effect.Effect<Option.Option<W>, E>;
	save: (write: W) => Effect.Effect<S, ChangedSinceRead | E2, R2>;
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
			Effect.fail(new SaveKeptChanging()),
		),
	);

/**
 * Runs a save and says what its failure was: a failed batch guard (`isGuard`, per call; `raisedByJsonGuard` is the default) becomes ChangedSinceRead, a name the
 * unique indexes refuse becomes the refusal `whenNameTaken` makes (for a save that stores a name), and anything else is
 * a defect, so the request fails as it would have.
 */
export const guardedSave = <A, E = never>(
	run: () => Promise<A>,
	isGuard: IsGuard,
	whenNameTaken?: () => E,
) =>
	Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
		Effect.catch((cause): Effect.Effect<never, ChangedSinceRead | E> => {
			if (cause instanceof Error && isGuard(cause))
				return Effect.fail(new ChangedSinceRead());

			return whenNameTaken && isUniqueViolation(cause)
				? Effect.fail(whenNameTaken())
				: Effect.die(cause);
		}),
	);
