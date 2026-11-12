import { double, fakeD1 } from "./doubles";

type SqliteValue = string | number | bigint | null | Uint8Array;

/** The node:sqlite database members that sqliteD1 calls. */
export interface SqliteDatabase {
	prepare(query: string): {
		get(...args: SqliteValue[]): Record<string, SqliteValue> | undefined;
		all(...args: SqliteValue[]): Record<string, SqliteValue>[];
	};
}

/**
 * A D1 binding over a node:sqlite database. Each prepared statement runs the SQL it was given
 * against the database, so a test seeds rows with sqlite and the code under test reads them
 * through D1's prepare, bind, first and all.
 */
export function sqliteD1(sql: SqliteDatabase): D1Database {
	return fakeD1({ prepare: (query) => sqliteStatement(sql, query, []) });
}

function sqliteStatement(
	sql: SqliteDatabase,
	query: string,
	args: SqliteValue[],
): D1PreparedStatement {
	// SAFETY: first and all return the node:sqlite rows as they are, plain objects keyed by column name, and D1's generic row types are not otherwise expressible for a sqlite fake; the code under test reads only the columns its own query selects.
	return {
		bind: (...values: SqliteValue[]) => sqliteStatement(sql, query, values),
		first: async () => sql.prepare(query).get(...args) ?? null,
		all: async () => ({ results: sql.prepare(query).all(...args) }),
	} as D1PreparedStatement;
}

/**
 * Locals for an Astro container render: a runtime whose env has the members the test supplies,
 * and the owner when the test signs one in. The code under test reads only these members.
 */
export function fakeLocals(
	env: Partial<Env>,
	owner?: { email: string },
): App.Locals {
	return double<App.Locals>({
		owner,
		runtime: double<App.Locals["runtime"]>({
			env: double<App.Locals["runtime"]["env"]>(env),
		}),
	});
}
