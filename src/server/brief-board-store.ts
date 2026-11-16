// What the brief board's route reads from and writes to MUSIC_DB (the MusicDb service), one function each: the day's
// interpretation counts in `brief_suggestion_budget`, the table the autocomplete also counts in under its own scopes. A
// read decides nothing; the reservation stores what `reserveInterpretation` (src/server/rules/brief-board.ts) decided,
// behind a guard that re-checks both limits in the same batch, which becomes ChangedSinceRead so the flow reads and
// decides again. Any other database failure is a BoardStoreFailed, which the route answers with its fixed sentence.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChangedSinceRead, raisedByJsonGuard } from "./guarded-save";
import type { BoardBudget, BoardReservation } from "./rules/brief-board";
import { MusicDb } from "./services";

/** The database failed, and nothing says it is only unavailable. The error carries no text. */
export class BoardStoreFailed extends Data.TaggedError("BoardStoreFailed") {}

const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: () => new BoardStoreFailed(),
		});
	});

/** The day's counts for the visitor's scope and the site's, read in one statement (0 when there is no row). */
export const readBoardBudget = (
	day: string,
	visitorScope: string,
	siteScope: string,
) =>
	asked((db) =>
		db
			.prepare(
				`SELECT
          COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?1 AND scope = ?2), 0) AS visitor,
          COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?1 AND scope = ?3), 0) AS site`,
			)
			.bind(day, visitorScope, siteScope)
			.first<BoardBudget>(),
	).pipe(Effect.map((row) => row ?? { visitor: 0, site: 0 }));

/**
 * Counts one interpretation for the visitor and the site, in one batch. The guard raises (the site's form,
 * `json_extract` of a sentence) unless both counts are still under their limits, and the batch then writes nothing: that
 * is ChangedSinceRead. Any other failure is a BoardStoreFailed.
 */
export const reserveBoardBudget = (write: BoardReservation) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		const upsert = (scope: string) =>
			db
				.prepare(
					`INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, 1)
          ON CONFLICT (day, scope) DO UPDATE SET count = count + 1`,
				)
				.bind(write.day, scope);

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(
							`SELECT CASE WHEN
                COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?1 AND scope = ?2), 0) < ?3
                AND COALESCE((SELECT count FROM brief_suggestion_budget WHERE day = ?1 AND scope = ?4), 0) < ?5
              THEN 1 ELSE json_extract('Board budget changed', '$') END`,
						)
						.bind(
							write.day,
							write.visitorScope,
							write.visitorLimit,
							write.siteScope,
							write.siteLimit,
						),
					upsert(write.visitorScope),
					upsert(write.siteScope),
				]),
			catch: (cause) =>
				cause instanceof Error && raisedByJsonGuard(cause)
					? new ChangedSinceRead()
					: new BoardStoreFailed(),
		});
	});

/** Removes up to 1,000 rows of days before `before`, of every scope, as the autocomplete's first reservation of a day does. */
export const forgetOldBudgetDays = (before: string) =>
	asked((db) =>
		db
			.prepare(
				`DELETE FROM brief_suggestion_budget WHERE rowid IN (
          SELECT rowid FROM brief_suggestion_budget WHERE day < ? LIMIT 1000
        )`,
			)
			.bind(before)
			.run(),
	);
