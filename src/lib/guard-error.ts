// Recognises a failed database guard and a UNIQUE violation from the error a D1 batch raises. Lives in src/lib so that
// shared code can use it; src/server/guarded-save.ts re-exports it. The rules for what a guard is are written there.

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
