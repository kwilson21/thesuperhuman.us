import { beforeEach, describe, expect, it } from "vitest";
import { boundQuery } from "./d1";
import { DatabaseSync, rowD1, sqliteD1 } from "./sqlite-d1";

type Item = { id: number; name: string };

let database: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
	database = new DatabaseSync(":memory:");
	database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
	database.exec("INSERT INTO items (id, name) VALUES (1, 'a'), (2, 'b')");
});

describe("sqliteD1 statements", () => {
	it("first() resolves to the first row, or null when there is none", async () => {
		const db = sqliteD1(database);

		expect(
			await db.prepare("SELECT * FROM items WHERE id=?").bind(2).first<Item>(),
		).toEqual({ id: 2, name: "b" });
		expect(
			await db.prepare("SELECT * FROM items WHERE id=?").bind(9).first<Item>(),
		).toBeNull();
	});

	it("all() resolves to every row with success and empty meta", async () => {
		const result = await sqliteD1(database)
			.prepare("SELECT * FROM items ORDER BY id")
			.all<Item>();

		expect(result.success).toBe(true);
		expect(result.results).toEqual([
			{ id: 1, name: "a" },
			{ id: 2, name: "b" },
		]);
		expect(result.meta).toEqual({});
	});

	it("run() resolves to no rows and the number of changed rows", async () => {
		const result = await sqliteD1(database)
			.prepare("UPDATE items SET name='z'")
			.run();

		expect(result.success).toBe(true);
		expect(result.results).toEqual([]);
		expect(result.meta.changes).toBe(2);
	});

	it("bind() returns a statement with the arguments bound and leaves the original unbound", async () => {
		const db = sqliteD1(database);
		const statement = db.prepare("SELECT name FROM items WHERE id=?");

		expect(await statement.bind(1).first<{ name: string }>()).toEqual({
			name: "a",
		});
		expect(await statement.bind(2).first<{ name: string }>()).toEqual({
			name: "b",
		});
	});

	it("records the SQL of the statements it prepares, and no others", () => {
		const statement = sqliteD1(database).prepare("SELECT 1");

		expect(boundQuery(statement)).toBe("SELECT 1");
		expect(boundQuery(rowD1(() => ({})).prepare("SELECT 1"))).toBeUndefined();
	});
});

describe("sqliteD1 batch", () => {
	it("returns rows for SELECT and RETURNING, in any case, and meta.changes for other statements", async () => {
		const db = sqliteD1(database);

		const results = await db.batch<Item>([
			db.prepare("select * from items where id=?").bind(1),
			db.prepare("UPDATE items SET name='z' WHERE id=2 returning id, name"),
			db.prepare("DELETE FROM items WHERE id=1"),
		]);

		expect(results.map((result) => result.results)).toEqual([
			[{ id: 1, name: "a" }],
			[{ id: 2, name: "z" }],
			[],
		]);
		expect(results[2]?.meta.changes).toBe(1);
		expect(results.every((result) => result.success)).toBe(true);
	});

	it("takes the statements that return rows from the second argument", async () => {
		const db = sqliteD1(database, /(?!)/);

		const [result] = await db.batch<Item>([
			db.prepare("UPDATE items SET name='z' WHERE id=2 RETURNING id, name"),
		]);

		expect(result?.results).toEqual([]);
		expect(result?.meta.changes).toBe(1);
	});

	it("commits every statement together", async () => {
		const db = sqliteD1(database);

		await db.batch([
			db.prepare("INSERT INTO items VALUES (3, 'c')"),
			db.prepare("INSERT INTO items VALUES (4, 'd')"),
		]);

		expect(database.prepare("SELECT count(*) AS n FROM items").get()).toEqual({
			n: 4,
		});
	});

	it("rolls back every statement when one throws", async () => {
		const db = sqliteD1(database);

		await expect(
			db.batch([
				db.prepare("INSERT INTO items VALUES (3, 'c')"),
				db.prepare("INSERT INTO items VALUES (1, 'duplicate')"),
			]),
		).rejects.toThrow();
		expect(database.prepare("SELECT count(*) AS n FROM items").get()).toEqual({
			n: 2,
		});
	});

	it("rejects a statement that the fake did not prepare", async () => {
		const db = sqliteD1(database);

		await expect(
			db.batch([rowD1(() => ({})).prepare("SELECT 1")]),
		).rejects.toThrow("Expected a statement prepared by this fake.");
	});
});

describe("rowD1", () => {
	it("first() resolves to the row for the SQL, whatever the bound arguments", async () => {
		const db = rowD1((query) => ({ query, count: 3 }));

		expect(await db.prepare("SELECT 1").bind("x").first()).toEqual({
			query: "SELECT 1",
			count: 3,
		});
	});

	it("throws when the code under test calls a member it does not supply", () => {
		expect(() =>
			rowD1(() => ({}))
				.prepare("SELECT 1")
				.all(),
		).toThrow(TypeError);
	});
});
