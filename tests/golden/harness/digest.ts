// A digest of the whole of a database, so a write to a table a case does not dump still shows in the fixture, and so the
// state that existed when an email or a Stripe call went out is part of the record.
//
// Dumps hold only the tables a case names, and the music database has dozens, so an extra INSERT into an audit table, or
// an UPDATE of another column, would leave a fixture untouched. The record therefore holds, for EVERY table of every
// database the case has, a row count and a SHA-256 over a canonical serialisation of all its rows (see `Fixture format`
// in tests/golden/README.md):
//
// - Tables are read in primary key order, or rowid order when the table has no primary key (`sqlite_sequence`, which
//   holds the AUTOINCREMENT counters, in name order). It is part of the state.
// - Each table's digest starts with its column names in schema order, so a schema difference cannot hide, even in an
//   empty table.
// - Every cell is written with a tag from SQLite's own `typeof()` of the stored value, so 1 and 1.0 differ: NULL as `N;`,
//   an integer as `I<digits>;` (read through CAST(... AS TEXT), so a value above 2^53 keeps every digit), a real as
//   `R<number>;`, text as `T<bytes>:<text>`, a blob as `B<bytes>:<hex>;`.
//
// A table with no rows is not listed in the per-table record (it is `rows: 0` by absence), but it is part of the database
// digest, which covers every table by name, so a table that gains a row changes it.
//
// `DatabaseDigester` answers "what is the digest now" many times a case (at every outside effect). It hashes again only
// when SQLite's `total_changes()`, `schema_version` or AUTOINCREMENT counters have moved since the last answer (and never across a ROLLBACK or a failed statement, which the fake D1 reports with `invalidate()`):
// `total_changes()` counts every row changed through the connection, by a statement, a trigger, a hook or a setup script
// alike, and the counters are the one write that moves without a row (an ignored INSERT). With GOLDEN_VERIFY_DIGESTS=1 every answer taken from the cache is also computed in full and compared.
import { createHash } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import type { SqliteDatabase } from "../../helpers/sqlite-d1";

export type TableDigest = { rows: number; sha256: string };

export type DatabaseDigest = {
	/** One digest over every table (empty ones included) in name order. */
	sha256: string;
	/** The tables that hold rows. */
	tables: { [table: string]: TableDigest };
};

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

const VERIFY = process.env.GOLDEN_VERIFY_DIGESTS === "1";

/** The text a stored cell is serialised as, from its SQLite type and the value read for it. */
function cellText(type: SQLOutputValue, value: SQLOutputValue): string {
	switch (type) {
		case "null":
			return "N;";
		case "integer":
			return `I${value};`;
		case "real":
			return `R${Object.is(value, -0) ? "-0" : value};`;
		case "blob":
			return value instanceof Uint8Array
				? `B${value.byteLength}:${Buffer.from(value).toString("hex")};`
				: "B?;";
		default:
			return `T${Buffer.byteLength(String(value))}:${value};`;
	}
}

function digestTable(sqlite: SqliteDatabase, table: string): TableDigest {
	const info = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all();
	const columns = info.map((column) => String(column.name));

	const keys = info
		.filter((column) => Number(column.pk) > 0)
		.sort((a, b) => Number(a.pk) - Number(b.pk))
		.map((column) => quote(String(column.name)));

	const order =
		table === "sqlite_sequence"
			? "name"
			: keys.length > 0
				? keys.join(",")
				: "rowid";

	const selected = columns
		.map(
			(column, index) =>
				`typeof(${quote(column)}) AS t${index}, CASE WHEN typeof(${quote(column)}) = 'integer' THEN CAST(${quote(column)} AS TEXT) ELSE ${quote(column)} END AS v${index}`,
		)
		.join(", ");

	const rows = sqlite
		.prepare(`SELECT ${selected} FROM ${quote(table)} ORDER BY ${order}`)
		.all();

	const hash = createHash("sha256");

	hash.update(
		`${columns.map((column) => `${column.length}:${column}`).join(",")}\n`,
	);

	for (const row of rows) {
		for (const index of columns.keys())
			hash.update(cellText(row[`t${index}`], row[`v${index}`]));

		hash.update("\n");
	}

	return { rows: rows.length, sha256: hash.digest("hex") };
}

/** Every table's digest, empty tables included, and the digest of the whole database. */
function digestAll(sqlite: SqliteDatabase) {
	const names = sqlite
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND (name NOT LIKE 'sqlite\\_%' ESCAPE '\\' OR name = 'sqlite_sequence') ORDER BY name",
		)
		.all()
		.map((row) => String(row.name));

	const whole = createHash("sha256");
	const tables: { [table: string]: TableDigest } = {};
	const perTable: Map<string, string> = new Map();

	for (const name of names) {
		const digest = digestTable(sqlite, name);

		whole.update(`${name}\0${digest.rows}\0${digest.sha256}\n`);
		perTable.set(name, `${digest.rows}:${digest.sha256}`);

		if (digest.rows > 0) tables[name] = digest;
	}

	return { digest: { sha256: whole.digest("hex"), tables }, perTable };
}

/** The digest of every table of the database, computed in full. */
export function digestDatabase(sqlite: SqliteDatabase): DatabaseDigest {
	return digestAll(sqlite).digest;
}

/** The digest of one database now, hashed again only after something was written (or the schema changed). */
export class DatabaseDigester {
	private stamp = "";
	private stale = false;
	private cached: DatabaseDigest | undefined;
	private tables: ReadonlyMap<string, string> = new Map();

	constructor(private readonly sqlite: SqliteDatabase) {}

	/**
	 * What says the database may have changed: row changes, the schema, and the AUTOINCREMENT counters, which an ignored
	 * INSERT moves without changing a row.
	 */
	private stampNow(): string {
		const changes = this.sqlite.prepare("SELECT total_changes() AS n").get();
		const schema = this.sqlite.prepare("PRAGMA schema_version").get();
		let counters = "";

		try {
			counters = JSON.stringify(
				this.sqlite
					.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name")
					.all(),
			);
		} catch {
			// No AUTOINCREMENT table yet: the schema version moves when one is created.
		}

		return `${changes?.n}:${schema?.schema_version}:${counters}`;
	}

	/**
	 * Forgets the cached answer. A ROLLBACK, or a statement that failed part way, puts rows back without moving
	 * `total_changes()`, so whoever runs one (the fake D1) says so here.
	 */
	invalidate() {
		this.stale = true;
	}

	/** The digest of every table now (empty ones included), by table name, from the same cache as `current()`. */
	perTable(): ReadonlyMap<string, string> {
		this.current();

		return this.tables;
	}

	current(): DatabaseDigest {
		const stamp = this.stampNow();

		if (this.cached && !this.stale && stamp === this.stamp) {
			if (VERIFY) {
				const full = digestDatabase(this.sqlite);

				if (full.sha256 !== this.cached.sha256) {
					const names = new Set([
						...Object.keys(full.tables),
						...Object.keys(this.cached.tables),
					]);

					const differing = [...names].filter(
						(name) =>
							full.tables[name]?.sha256 !== this.cached?.tables[name]?.sha256,
					);

					throw new Error(
						`golden harness: the cached database digest differs from the full one in ${differing.join(", ") || "an empty table or a schema"}; something wrote to the database without changing total_changes().`,
					);
				}
			}

			return this.cached;
		}

		const all = digestAll(this.sqlite);

		this.cached = all.digest;
		this.tables = all.perTable;
		this.stamp = stamp;
		this.stale = false;

		return this.cached;
	}
}
