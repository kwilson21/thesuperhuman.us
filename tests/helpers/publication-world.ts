import * as Context from "effect/Context";
import { PublicationDb } from "../../src/server/services";
import { freshPublicationDb } from "../golden/harness";
import { boundStatement } from "./d1";
import { double } from "./doubles";
import { sqliteD1, type SqliteDatabase } from "./sqlite-d1";

/** The publication database with every migration applied, and what a test may do to it: run SQL, fail a batch, run code before one. */
export type PublicationWorld = {
	readonly sql: SqliteDatabase;
	readonly db: D1Database;
	readonly services: Context.Context<PublicationDb>;
	/** Runs `act` once, just before the next batch whose SQL matches `pattern` (the other writer who gets there first). */
	readonly before: (pattern: RegExp, act: () => void | Promise<void>) => void;
	/** Fails every batch whose SQL matches `pattern`, with an error that carries private text. */
	readonly failing: (pattern: RegExp | null) => void;
	/** Every batch run, as the SQL of its statements. */
	readonly batches: string[][];
};

export function publicationWorld(): PublicationWorld {
	const sql = freshPublicationDb();
	const real = sqliteD1(sql);
	const hooks: { pattern: RegExp; act: () => void | Promise<void> }[] = [];
	let failing: RegExp | null = null;
	const batches: string[][] = [];

	const db = double<D1Database>({
		prepare: (query: string) => real.prepare(query),
		batch: async <T>(items: D1PreparedStatement[]) => {
			const queries = items.map((item) => boundStatement(item).query);

			batches.push(queries);

			if (failing && queries.some((query) => failing?.test(query)))
				throw new Error("private database details for threadline");

			const at = hooks.findIndex((hook) =>
				queries.some((query) => hook.pattern.test(query)),
			);

			if (at >= 0) {
				const [hook] = hooks.splice(at, 1);

				await hook.act();
			}

			return real.batch<T>(items);
		},
	});

	return {
		sql,
		db,
		services: Context.make(PublicationDb, db),
		before: (pattern, act) => {
			hooks.push({ pattern, act });
		},
		failing: (pattern) => {
			failing = pattern;
		},
		batches,
	};
}
