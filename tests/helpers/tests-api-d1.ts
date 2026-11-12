import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { double } from "./doubles";

/** The part of a node:sqlite database handle that the D1 fake runs statements on. */
export type SqliteHandle = {
	exec(sql: string): void;
	prepare(query: string): {
		all(...args: SQLInputValue[]): Record<string, SQLOutputValue>[];
		get(...args: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
		run(...args: SQLInputValue[]): { changes: number | bigint };
	};
};

type BoundStatement = { query: string; args: SQLInputValue[] };

/**
 * Prepared statements that sqliteD1 made, mapped to their SQL and arguments, so batch() can run them and tests can
 * read the SQL of a statement they intercept.
 */
const bound = new WeakMap<D1PreparedStatement, BoundStatement>();

/** The SQL text of a statement that sqliteD1 prepared, or undefined for any other statement. */
export function boundQuery(statement: D1PreparedStatement): string | undefined {
	return bound.get(statement)?.query;
}

/**
 * The rows of a query, typed as the caller names them. Each row is a node:sqlite object keyed by the SELECT list of the
 * query that produced it; an expect() that reads a column the query does not select fails the test.
 */
function rowsAs<T>(rows: Record<string, SQLOutputValue>[]): T[] {
	// SAFETY: every row is keyed by the SELECT list of the query that returned it, and the caller's expect() calls read only the columns that list names.
	return rows as T[];
}

/**
 * A D1 binding that runs its statements on a node:sqlite database, with the RETURNING and batch behaviour the code under
 * test relies on. A batch statement returns rows when resultsFor matches its SQL, and runs for effect otherwise.
 */
export function sqliteD1(
	sql: SqliteHandle,
	resultsFor: RegExp = /RETURNING/i,
): D1Database {
	const statement = (
		query: string,
		args: SQLInputValue[] = [],
	): D1PreparedStatement => {
		const prepared = double<D1PreparedStatement>({
			bind: (...values: SQLInputValue[]) => statement(query, values),
			first: async <T>() => {
				// SAFETY: node:sqlite returns a plain object keyed by the SELECT list of this query, which the caller reads by column name with expect(); a row that lacks a named column fails that expect.
				return (sql.prepare(query).get(...args) ?? null) as T | null;
			},
			all: async <T>() =>
				double<D1Result<T>>({
					results: rowsAs<T>(sql.prepare(query).all(...args)),
				}),
			run: async <T>() => {
				const result = sql.prepare(query).run(...args);

				return double<D1Result<T>>({
					success: true,
					meta: double<D1Result<T>["meta"]>({
						changes: Number(result.changes),
					}),
				});
			},
		});

		bound.set(prepared, { query, args });

		return prepared;
	};

	return double<D1Database>({
		prepare: (query: string) => statement(query),
		batch: async <T>(items: D1PreparedStatement[]) => {
			sql.exec("BEGIN");

			try {
				const result = items.map((item) => {
					const run = bound.get(item);

					if (!run) throw new Error("statement was not prepared by sqliteD1");

					return double<D1Result<T>>({
						results: resultsFor.test(run.query)
							? rowsAs<T>(sql.prepare(run.query).all(...run.args))
							: (sql.prepare(run.query).run(...run.args), []),
					});
				});

				sql.exec("COMMIT");

				return result;
			} catch (error) {
				sql.exec("ROLLBACK");
				throw error;
			}
		},
	});
}
