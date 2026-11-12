import {
	d1Meta,
	fakeBatch,
	fakeFirst,
	fakeResult,
} from "./tests-lib-a-bindings";
import { double } from "./doubles";

/** A value node:sqlite returns for a column. */
type SqlValue = string | number | bigint | Uint8Array | null;

/** One row node:sqlite returns, keyed by the column names the statement selects. */
type SqlRow = Record<string, SqlValue>;

/** The part of node:sqlite's DatabaseSync that the D1 fake uses. */
export type SqliteDatabase = {
	exec(query: string): void;
	prepare(query: string): {
		run(...args: unknown[]): { changes: number };
		get(...args: unknown[]): SqlRow | undefined;
		all(...args: unknown[]): SqlRow[];
	};
};

/**
 * A D1 database backed by an in-memory SQLite database. Each statement runs against `sql` with the arguments
 * bound to it, and a batch runs its statements in one transaction.
 */
export function sqliteD1(sql: SqliteDatabase): D1Database {
	const pending = new WeakMap<
		D1PreparedStatement,
		{ query: string; args: unknown[] }
	>();

	const statement = (
		query: string,
		args: unknown[] = [],
	): D1PreparedStatement => {
		const prepared = double<D1PreparedStatement>({
			bind: (...values: unknown[]) => statement(query, values),
			run: fakeResult(() =>
				double<D1Result>({
					success: true,
					meta: d1Meta(sql.prepare(query).run(...args).changes),
					results: [],
				}),
			),
			all: fakeResult(() =>
				double<D1Result>({
					success: true,
					results: sql.prepare(query).all(...args),
				}),
			),
			first: fakeFirst(() => sql.prepare(query).get(...args) ?? null),
		});

		pending.set(prepared, { query, args });

		return prepared;
	};

	const statementOf = (item: D1PreparedStatement) => {
		const info = pending.get(item);

		if (!info) throw new Error("Expected a statement prepared by this fake.");

		return info;
	};

	return double<D1Database>({
		prepare: (query: string) => statement(query),
		batch: fakeBatch((statements) => {
			sql.exec("BEGIN");

			try {
				const results = statements.map((item) => {
					const { query, args } = statementOf(item);
					const prepared = sql.prepare(query);

					if (/\bRETURNING\b/i.test(query))
						return double<D1Result>({
							success: true,
							results: prepared.all(...args),
						});
					const result = prepared.run(...args);

					return double<D1Result>({
						success: true,
						meta: d1Meta(result.changes),
						results: [],
					});
				});

				sql.exec("COMMIT");

				return results;
			} catch (error) {
				sql.exec("ROLLBACK");
				throw error;
			}
		}),
	});
}
