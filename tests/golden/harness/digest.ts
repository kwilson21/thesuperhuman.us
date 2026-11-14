// A digest of the whole of a database, so a write to a table a case does not dump still shows in the fixture.
//
// Dumps hold only the tables a case names, and the music database has dozens, so an extra INSERT into an audit table, or
// an UPDATE of another column, would leave the fixture untouched. Every step and the end of every case therefore records,
// for EVERY table of every database the case has, a row count and a SHA-256 over a canonical serialisation of all its rows
// (see `fixture format 2` in tests/golden/README.md). Tables are read in primary key order, or rowid order when the table
// has no primary key, with all columns in schema order. Each cell is written with a type tag and, for text and blobs, a
// length, so no two different tables serialise alike: NULL as `N;`, a number as `D<number>;`, a bigint as `I<number>;`,
// text as `T<bytes>:<text>`, a blob as `B<bytes>:<hex>`.
//
// A table with no rows is not listed in the per-table record (it is `rows: 0` by absence), but it is part of the database
// digest, which covers every table by name, so a table that gains a row changes it.
import { createHash } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import { isText } from "~/lib/type-guards";
import { isBigint } from "./plain";
import type { SqliteDatabase } from "../../helpers/sqlite-d1";

export type TableDigest = { rows: number; sha256: string };

export type DatabaseDigest = {
	/** One digest over every table (empty ones included) in name order. */
	sha256: string;
	/** The tables that hold rows. */
	tables: { [table: string]: TableDigest };
};

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function cellText(value: SQLOutputValue): string {
	if (value === null) return "N;";

	if (isBigint(value)) return `I${value};`;

	if (value instanceof Uint8Array)
		return `B${value.byteLength}:${Buffer.from(value).toString("hex")};`;

	if (isText(value)) return `T${Buffer.byteLength(value)}:${value};`;

	return `D${Object.is(value, -0) ? "-0" : value};`;
}

function digestTable(sqlite: SqliteDatabase, table: string): TableDigest {
	const info = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
	const columns = info.map((column) => String(column.name));

	const keys = info
		.filter((column) => Number(column.pk) > 0)
		.sort((a, b) => Number(a.pk) - Number(b.pk))
		.map((column) => quote(String(column.name)));

	const order = keys.length > 0 ? keys.join(",") : "rowid";

	const rows = sqlite
		.prepare(`SELECT * FROM ${quote(table)} ORDER BY ${order}`)
		.all();

	const hash = createHash("sha256");

	for (const row of rows) {
		for (const column of columns) hash.update(cellText(row[column] ?? null));

		hash.update("\n");
	}

	return { rows: rows.length, sha256: hash.digest("hex") };
}

/** The digest of every table of the database. */
export function digestDatabase(sqlite: SqliteDatabase): DatabaseDigest {
	const names = sqlite
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all()
		.map((row) => String(row.name));

	const whole = createHash("sha256");
	const tables: { [table: string]: TableDigest } = {};

	for (const name of names) {
		const digest = digestTable(sqlite, name);

		whole.update(`${name}\0${digest.rows}\0${digest.sha256}\n`);

		if (digest.rows > 0) tables[name] = digest;
	}

	return { sha256: whole.digest("hex"), tables };
}
