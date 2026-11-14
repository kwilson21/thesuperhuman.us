import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// db/music.sql is the schema many tests load (the golden harness, the route and library tests). It is the music migrations in order, so a
// migration changed or added without regenerating it (`cat migrations/music/*.sql > db/music.sql`) would leave those tests on an old schema.

describe("db/music.sql", () => {
	it("is the concatenation of migrations/music/*.sql in file name order", () => {
		const directory = new URL("../../migrations/music/", import.meta.url);

		const migrations = readdirSync(directory)
			.filter((name) => name.endsWith(".sql"))
			.sort();

		expect(migrations.length).toBeGreaterThan(0);

		const joined = migrations
			.map((name) => readFileSync(new URL(name, directory), "utf8"))
			.join("");

		expect(
			readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
		).toBe(joined);
	});
});
