// Fresh in-memory databases with the real schema, a seeding API and a stable dump of a table's rows.
import { readdirSync, readFileSync } from "node:fs";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { DatabaseSync, type SqliteDatabase } from "../../helpers/sqlite-d1";
import { isBigint, plain, type Recorded } from "./plain";

const ROOT = new URL("../../../", import.meta.url);

/** A new in-memory MUSIC_DB with db/music.sql applied (the repository keeps it equal to migrations/music). */
export function freshMusicDb(): SqliteDatabase {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(readFileSync(new URL("db/music.sql", ROOT), "utf8"));

	return sqlite;
}

/** A new in-memory PUBLICATION_DB with every file in migrations/publication applied in name order. */
export function freshPublicationDb(): SqliteDatabase {
	const sqlite = new DatabaseSync(":memory:");
	const folder = new URL("migrations/publication/", ROOT);

	for (const name of readdirSync(folder)
		.filter((file) => file.endsWith(".sql"))
		.sort())
		sqlite.exec(readFileSync(new URL(name, folder), "utf8"));

	return sqlite;
}

/** One row to insert: column names to values. A column left out takes its default. */
export type SeedRow = { [column: string]: SQLInputValue };

/** Rows to insert, by table, in the order given. Tables are filled in the order of the keys. */
export type Seed = { [table: string]: readonly SeedRow[] };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identifier(name: string): string {
	if (!NAME.test(name)) throw new Error(`golden harness: bad name "${name}"`);

	return name;
}

/** Inserts the rows, table by table, with bound values. A row the schema rejects throws, naming the table. */
export function seed(sqlite: SqliteDatabase, rows: Seed) {
	for (const [table, list] of Object.entries(rows)) {
		for (const row of list) {
			const columns = Object.keys(row).map(identifier);

			try {
				sqlite
					.prepare(
						`INSERT INTO ${identifier(table)} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
					)
					.run(...Object.values(row));
			} catch (error) {
				throw new Error(
					`golden harness: seeding ${table} failed: ${error instanceof Error ? error.message : "unknown"}`,
				);
			}
		}
	}
}

function cell(value: SQLOutputValue): Recorded {
	if (value instanceof Uint8Array) return plain(value);

	if (isBigint(value)) return plain(value);

	return value;
}

/**
 * The rows of the tables, each table in rowid order (insertion order, so two runs agree), as plain objects. A table
 * with no rowid is ordered by every column. Use it to assert the final state of a database in a case.
 */
export function dump(
	sqlite: SqliteDatabase,
	tables: readonly string[],
): { [table: string]: Recorded } {
	return Object.fromEntries(
		tables.map((table) => {
			const name = identifier(table);

			const columns = sqlite
				.prepare(`PRAGMA table_info(${name})`)
				.all()
				.map((row) => String(row.name));

			if (columns.length === 0)
				throw new Error(`golden harness: no table "${table}"`);

			let rows: Record<string, SQLOutputValue>[];

			try {
				rows = sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
			} catch {
				rows = sqlite
					.prepare(`SELECT * FROM ${name} ORDER BY ${columns.join(",")}`)
					.all();
			}

			return [
				table,
				rows.map((row) =>
					Object.fromEntries(
						Object.entries(row).map(([column, value]) => [column, cell(value)]),
					),
				),
			];
		}),
	);
}
