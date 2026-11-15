// What the brief suggestion route reads from and writes to the budget table (brief_suggestion_budget in MUSIC_DB). A read
// asks for the stored count and decides nothing. A reservation is a guarded write: the upsert adds one only while the count
// is under its cap, so the table can never pass the cap even when two requests read the same count. Each database
// failure is a BudgetStoreFailed carrying what it raised, which the route logs the way it always has.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { MusicDb } from "./services";

/** The budget table failed (a read, a reservation or the cleanup). */
export class BudgetStoreFailed extends Data.TaggedError("BudgetStoreFailed")<{
	readonly failure: unknown;
}> {}

/** The stored count of the site for `day`, or null when no row has been written that day. */
export const readSiteCount = (day: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(
						"SELECT count FROM brief_suggestion_budget WHERE day = ? AND scope = ?",
					)
					.bind(day, "site")
					.first<{ count: number }>(),
			catch: (cause) => new BudgetStoreFailed({ failure: cause }),
		}).pipe(Effect.map((row) => row?.count ?? null));
	});

/**
 * Adds one to the count of `scope` for `day`, only while it is under `cap`. Answers the new count, or null when the cap is
 * reached (the guard refused the write).
 */
export const reserve = (day: string, scope: string, cap: number) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(`INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, 1)
        ON CONFLICT (day, scope) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`)
					.bind(day, scope, cap)
					.first<{ count: number }>(),
			catch: (cause) => new BudgetStoreFailed({ failure: cause }),
		}).pipe(Effect.map((row) => row?.count ?? null));
	});

/**
 * Deletes up to 1000 rows of days before `previousDay`. A background task, so it is a promise: it runs once the response
 * is sent, and a rejection is the caller's to log.
 */
export const clearOldDays = (db: D1Database, previousDay: string) =>
	db
		.prepare(`DELETE FROM brief_suggestion_budget WHERE rowid IN (
          SELECT rowid FROM brief_suggestion_budget WHERE day < ? LIMIT 1000
        )`)
		.bind(previousDay)
		.run();
