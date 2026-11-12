import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { double, fakeD1 } from "./doubles";

/**
 * A D1 binding backed by a node:sqlite database, for tests that run real SQL. Each statement the code under test
 * prepares is recorded, so a batch can replay its SQL and arguments on the same database.
 */
export function sqliteD1(database: DatabaseSync): D1Database {
	const statements = new WeakMap<
		D1PreparedStatement,
		{ query: string; args: SQLInputValue[] }
	>();

	const statement = (
		query: string,
		args: SQLInputValue[] = [],
	): D1PreparedStatement => {
		const prepared = double<D1PreparedStatement>({
			bind: (...values: SQLInputValue[]) => statement(query, values),
			first: async () => database.prepare(query).get(...args) ?? null,
			all: async <T = Record<string, SQLOutputValue>>() => ({
				success: true as const,
				meta: double<D1Response["meta"]>({}),
				// SAFETY: node:sqlite returns each row as the columns of the SELECT this statement prepared; T is the row type the caller names and the fake cannot check it.
				results: database.prepare(query).all(...args) as T[],
			}),
			run: async () => ({
				success: true as const,
				meta: double<D1Response["meta"]>({
					changes: Number(database.prepare(query).run(...args).changes),
				}),
				results: [],
			}),
		});
		statements.set(prepared, { query, args });

		return prepared;
	};

	return fakeD1({
		prepare: (query: string) => statement(query),
		batch: async <T = Record<string, SQLOutputValue>>(
			items: D1PreparedStatement[],
		) => {
			database.exec("BEGIN");

			try {
				const result = items.map((item) => {
					const queued = statements.get(item);

					if (!queued) throw new Error("Unknown statement in batch.");

					return {
						success: true as const,
						meta: double<D1Response["meta"]>({}),
						// SAFETY: as in all() above, node:sqlite returns the rows of the SELECT this statement prepared; T is the caller's row type and is not checked.
						results: /^SELECT|RETURNING/i.test(queued.query)
							? (database.prepare(queued.query).all(...queued.args) as T[])
							: (database.prepare(queued.query).run(...queued.args), []),
					};
				});

				database.exec("COMMIT");

				return result;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
	});
}
