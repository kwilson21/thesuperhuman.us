import { createRequire } from "node:module";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { boundStatement, preparedStatement } from "./d1";
import { double, partial } from "./doubles";

// Native loading avoids older Vite versions treating node:sqlite as a package.
export const { DatabaseSync }: typeof import("node:sqlite") = createRequire(
	import.meta.url,
)("node:sqlite");

/** An in-memory or file node:sqlite database. */
export type SqliteDatabase = InstanceType<typeof DatabaseSync>;

/** One row node:sqlite returns, keyed by the column names the statement selects. */
export type SqliteRow = Record<string, SQLOutputValue>;

/**
 * A batch statement returns rows when its SQL starts with SELECT or contains RETURNING, and runs for effect otherwise.
 */
const RETURNS_ROWS = /^\s*SELECT\b|\bRETURNING\b/i;

/** A row, typed as the row type `T` that the caller names. */
function rowAs<T>(row: SqliteRow): T {
	// SAFETY: node:sqlite and D1 both return one object per row, keyed by the column names of the statement's SELECT or RETURNING list; T is the row type the src caller of all(), first() or batch() names for that statement, and a rowD1 row is a partial fake carrying only the columns the tested path reads.
	return row as T;
}

/** A D1 result with the rows given and, for a statement that wrote, the number of rows it changed. */
function d1Result<T>(results: T[], changes?: number): D1Result<T> {
	return partial<D1Result<T>>({
		success: true,
		results,
		meta: partial<D1Result<T>["meta"]>(
			changes === undefined ? {} : { changes },
		),
	});
}

/**
 * A D1 binding that runs its statements on a node:sqlite database, so a test runs the real SQL.
 * - first() resolves to the first row, or null when there is none.
 * - all() resolves to a result with every row.
 * - run() resolves to a result with no rows and `meta.changes`.
 * - batch() runs in one transaction (BEGIN, then COMMIT, or ROLLBACK if a statement throws). A statement whose SQL
 *   matches `returnsRows` yields its rows; any other runs for effect and yields `meta.changes`.
 * Statements are recorded, so boundQuery() gives the SQL of one a test intercepts.
 */
export function sqliteD1(
	database: SqliteDatabase,
	returnsRows: RegExp = RETURNS_ROWS,
): D1Database {
	const members = (query: string, args: SQLInputValue[]) => ({
		first: async <T>() => {
			const row = database.prepare(query).get(...args);

			return row === undefined ? null : rowAs<T>(row);
		},
		all: async <T>() =>
			d1Result(
				database
					.prepare(query)
					.all(...args)
					.map((row) => rowAs<T>(row)),
			),
		run: async <T>() =>
			d1Result<T>([], Number(database.prepare(query).run(...args).changes)),
	});

	return double<D1Database>({
		prepare: (query: string) => preparedStatement(query, [], members),
		batch: async <T>(items: D1PreparedStatement[]) => {
			database.exec("BEGIN");

			try {
				const results = items.map((item) => {
					const { query, args } = boundStatement(item);
					const prepared = database.prepare(query);

					return returnsRows.test(query)
						? d1Result<T>(prepared.all(...args).map((row) => rowAs<T>(row)))
						: d1Result<T>([], Number(prepared.run(...args).changes));
				});

				database.exec("COMMIT");

				return results;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
	});
}

/**
 * A D1 binding whose first() answers with the row that rowFor gives for the SQL. A route that reads one row by column
 * name is served by it; a column the row does not carry is undefined to that route.
 */
export function rowD1(rowFor: (query: string) => SqliteRow): D1Database {
	const statement = (query: string): D1PreparedStatement =>
		double<D1PreparedStatement>({
			bind: () => statement(query),
			first: async <T>() => rowAs<T>(rowFor(query)),
		});

	return double<D1Database>({ prepare: (query: string) => statement(query) });
}
