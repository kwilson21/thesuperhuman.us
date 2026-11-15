import { freshPublicationDb } from "../golden/harness";
import { DatabaseSync, sqliteD1, type SqliteDatabase } from "./sqlite-d1";

/** Every database this module opened and no test has closed yet. */
const opened: SqliteDatabase[] = [];

function served(database: SqliteDatabase): D1Database {
	opened.push(database);

	return sqliteD1(database);
}

/** A publication database in memory, with every migration in migrations/publication applied, served through D1. */
export function publicationD1(): D1Database {
	return served(freshPublicationDb());
}

/** An in-memory database with no tables, so every query fails the way a database without its migration does. */
export function unmigratedD1(): D1Database {
	return served(new DatabaseSync(":memory:"));
}

/** Closes every database publicationD1() and unmigratedD1() opened. Call it in afterEach, after any background work is awaited. */
export function closePublicationDbs(): void {
	for (const database of opened.splice(0)) database.close();
}
