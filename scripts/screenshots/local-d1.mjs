// Writes scenario seeds straight to the local D1 file that `wrangler dev` and the capture's dev server
// use, instead of starting wrangler once per statement. Miniflare names each database's file by a hash,
// so the file is found by its contents: the one whose d1_migrations table lists the first migration.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Miniflare's D1 files, under the state directory wrangler persists to (`--persist-to`). */
const d1Directory = (stateDirectory) => join(stateDirectory, "v3", "d1");

/** Whether the database has a row for the migration. A database without a d1_migrations table does not. */
function appliesMigration(file, migration) {
	const db = new DatabaseSync(file, { readOnly: true });

	try {
		return (
			db
				.prepare("SELECT 1 FROM d1_migrations WHERE name = ?")
				.get(migration) !== undefined
		);
	} catch (error) {
		if (String(error.message).includes("no such table: d1_migrations"))
			return false;

		throw error;
	} finally {
		db.close();
	}
}

/**
 * The path of the local D1 file for the database whose migrations directory is given. Throws unless
 * exactly one file matches.
 */
export function findLocalD1File({ stateDirectory, migrationsDirectory }) {
	const first = readdirSync(migrationsDirectory)
		.filter((name) => name.endsWith(".sql"))
		.sort()[0];

	if (!first) throw new Error(`No migrations in ${migrationsDirectory}.`);

	const directory = d1Directory(stateDirectory);
	let files;

	try {
		files = readdirSync(directory, { recursive: true })
			.filter((name) => String(name).endsWith(".sqlite"))
			.map((name) => join(directory, String(name)));
	} catch {
		throw new Error(
			`No local D1 storage in ${directory}. Run pnpm run screenshots:preview first.`,
		);
	}

	const matches = files.filter((file) => appliesMigration(file, first));

	if (matches.length !== 1)
		throw new Error(
			`Expected exactly one local D1 database with migration ${first} in ${directory}, found ${matches.length}.`,
		);

	return matches[0];
}

/** Opens a local D1 file for writes. Waits up to 10 s for a lock held by the dev server's own connection. */
export function openD1File(file) {
	const db = new DatabaseSync(file);
	db.exec("PRAGMA busy_timeout = 10000");

	return {
		exec: (sql) => db.exec(sql),
		close: () => db.close(),
	};
}

/** Opens the local D1 database for the given migrations directory. */
export function openLocalD1(options) {
	return openD1File(findLocalD1File(options));
}
