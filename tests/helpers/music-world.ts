import { readFileSync } from "node:fs";
import { boundStatement } from "./d1";
import { double, fakeKv } from "./doubles";
import { DatabaseSync, sqliteD1 } from "./sqlite-d1";

// A music database that runs the real schema (db/music.sql) on node:sqlite, and a rate limit namespace kept in a map, for the
// flow stories. `beforeStatement` runs just before the first statement or batch whose SQL matches `pattern`, the way the
// golden harness's interleave does, so a story can put another request's write between a read and a write.

export type MusicWorldOptions = {
	/** Another request's work, run before each statement whose SQL matches. It may throw to fail that statement. */
	readonly beforeStatement?: readonly [RegExp, () => void];
	/** Reads (SELECT statements) answer as though the tables were empty, while writes reach the real database. */
	readonly blindReads?: boolean;
};

export function musicWorld(options: MusicWorldOptions = {}) {
	const sql = new DatabaseSync(":memory:");

	sql.exec(
		readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
	);
	const real = sqliteD1(sql);

	const [pattern, act] = options.beforeStatement ?? [/(?!)/, () => {}];

	const blindStatement: D1PreparedStatement = double<D1PreparedStatement>({
		bind: () => blindStatement,
		first: async () => null,
	});

	const db = double<D1Database>({
		prepare: (query: string) => {
			if (pattern.test(query)) act();

			return options.blindReads && /^\s*SELECT/i.test(query)
				? blindStatement
				: real.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			if (items.some((item) => pattern.test(boundStatement(item).query))) act();

			return real.batch<T>(items);
		},
	});

	const counts = new Map<string, string>();

	const kv = fakeKv({
		get: async (key: string) => counts.get(key) ?? null,
		put: async (key: string, value: string) => {
			counts.set(key, value);
		},
		delete: async (key: string) => {
			counts.delete(key);
		},
	});

	return { sql, db, kv, counts };
}
