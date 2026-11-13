import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getPlatformProxy } from "wrangler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findLocalD1File,
	openD1File,
	openLocalD1,
} from "../../scripts/screenshots/local-d1.mjs";

type D1Like = {
	exec(sql: string): Promise<void>;
	prepare(sql: string): {
		run(): Promise<void>;
		all(): Promise<{ results: { label: string }[] }>;
	};
};

let dir: string;
let state: string;
let migrations: string;

// Miniflare keeps each D1 database in a file named by a hash, under v3/d1/<class>/.
async function d1File(name: string, migrationNames: string[] | null) {
	const folder = join(state, "v3", "d1", "miniflare-D1DatabaseObject");
	await mkdir(folder, { recursive: true });

	const file = join(folder, `${name}.sqlite`);
	const db = new DatabaseSync(file);

	if (migrationNames) {
		db.exec(
			"CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
		);

		for (const migration of migrationNames)
			db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(migration);
	}

	db.close();

	return file;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "screenshot-local-d1-"));
	state = join(dir, "state");
	migrations = join(dir, "migrations");
	await mkdir(migrations, { recursive: true });
	await writeFile(join(migrations, "0001_music_schema.sql"), "-- test\n");
	await writeFile(join(migrations, "0002_owner_retention.sql"), "-- test\n");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("findLocalD1File", () => {
	it("finds the one database whose migrations table lists the first migration", async () => {
		const match = await d1File("aaa", ["0001_music_schema.sql"]);
		await d1File("bbb", ["0001_publication_journal.sql"]);
		await d1File("ccc", null);

		expect(
			findLocalD1File({
				stateDirectory: state,
				migrationsDirectory: migrations,
			}),
		).toBe(match);
	});

	it("throws when no database has the first migration", async () => {
		await d1File("aaa", ["0001_publication_journal.sql"]);

		expect(() =>
			findLocalD1File({
				stateDirectory: state,
				migrationsDirectory: migrations,
			}),
		).toThrow(/0001_music_schema\.sql.*found 0/);
	});

	it("throws when more than one database has the first migration", async () => {
		await d1File("aaa", ["0001_music_schema.sql"]);
		await d1File("bbb", ["0001_music_schema.sql", "0002_owner_retention.sql"]);

		expect(() =>
			findLocalD1File({
				stateDirectory: state,
				migrationsDirectory: migrations,
			}),
		).toThrow(/found 2/);
	});

	it("picks the database by the first migration name, not a later one", async () => {
		// The first file after sorting is 0001_music_schema.sql, not the second.
		await d1File("aaa", ["0002_owner_retention.sql"]);
		await d1File("bbb", ["0001_music_schema.sql"]);

		expect(
			findLocalD1File({
				stateDirectory: state,
				migrationsDirectory: migrations,
			}),
		).toMatch(/bbb\.sqlite$/);
	});
});

describe("openLocalD1 and openD1File", () => {
	it("opens the matching file and runs SQL against it", async () => {
		const file = await d1File("aaa", ["0001_music_schema.sql"]);

		const db = openLocalD1({
			stateDirectory: state,
			migrationsDirectory: migrations,
		});

		db.exec("CREATE TABLE notes (body TEXT)");
		db.exec(
			"INSERT INTO notes (body) VALUES ('one'); INSERT INTO notes (body) VALUES ('two');",
		);
		db.close();

		const check = new DatabaseSync(file, { readOnly: true });
		expect(
			check.prepare("SELECT body FROM notes ORDER BY rowid").all(),
		).toEqual([{ body: "one" }, { body: "two" }]);
		check.close();
	});
});

it("enforces foreign keys as D1 does", async () => {
	const file = await d1File("aaa", ["0001_music_schema.sql"]);
	const setup = new DatabaseSync(file);
	setup.exec(
		"CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (pid INTEGER REFERENCES parent(id))",
	);
	setup.close();

	const db = openD1File(file);

	expect(() => db.exec("INSERT INTO child (pid) VALUES (99)")).toThrow(
		/FOREIGN KEY/,
	);
	db.close();
});

describe("local D1 shared with wrangler's own binding", () => {
	it("sees writes made with node:sqlite while the binding is open, and the binding sees them back", async () => {
		await writeFile(
			join(dir, "wrangler.json"),
			JSON.stringify({
				name: "screenshot-local-d1-test",
				compatibility_date: "2026-05-14",
				d1_databases: [
					{
						binding: "DB",
						database_name: "screenshot-local-d1-test",
						database_id: "00000000-0000-0000-0000-000000000009",
						migrations_dir: migrations,
					},
				],
			}),
		);

		const proxy = await getPlatformProxy({
			configPath: join(dir, "wrangler.json"),
			persist: { path: join(state, "v3") },
		});

		try {
			// SAFETY: this is the DB binding the test configured above, a D1 database with exec and prepare.
			const binding = proxy.env.DB as D1Like;

			await binding.exec(
				"CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
			);
			await binding
				.prepare(
					"INSERT INTO d1_migrations (name) VALUES ('0001_music_schema.sql')",
				)
				.run();
			await binding.exec(
				"CREATE TABLE rows (id INTEGER PRIMARY KEY, label TEXT)",
			);
			await binding
				.prepare("INSERT INTO rows (label) VALUES ('from binding')")
				.run();

			const file = findLocalD1File({
				stateDirectory: state,
				migrationsDirectory: migrations,
			});

			const external = openD1File(file);

			external.exec("INSERT INTO rows (label) VALUES ('from node:sqlite')");

			const seen = await binding
				.prepare("SELECT label FROM rows ORDER BY id")
				.all();

			expect(seen.results.map((row) => row.label)).toEqual([
				"from binding",
				"from node:sqlite",
			]);

			await binding
				.prepare("INSERT INTO rows (label) VALUES ('binding again')")
				.run();
			external.close();

			const check = new DatabaseSync(file, { readOnly: true });
			expect(
				check
					.prepare("SELECT label FROM rows ORDER BY id")
					.all()
					.map((row) => row.label),
			).toEqual(["from binding", "from node:sqlite", "binding again"]);
			check.close();
		} finally {
			await proxy.dispose();
		}
	}, 60_000);
});
