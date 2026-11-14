import { afterEach, expect, it } from "vitest";
import {
	closePublicationDbs,
	publicationD1,
	unmigratedD1,
} from "./publication-d1";

afterEach(closePublicationDbs);

it("applies every publication migration, so the journal tables exist", async () => {
	expect(
		await publicationD1()
			.prepare("SELECT count(*) AS n FROM publication_events")
			.first(),
	).toEqual({ n: 0 });
	expect(
		await publicationD1()
			.prepare("SELECT count(*) AS n FROM publication_outbox")
			.first(),
	).toEqual({ n: 0 });
});

it("fails a query against a database without the migrations", async () => {
	await expect(
		unmigratedD1().prepare("SELECT * FROM publication_events").all(),
	).rejects.toThrow();
});

it("closes the databases it opened, so a query after closePublicationDbs() fails", async () => {
	const database = publicationD1();

	closePublicationDbs();

	await expect(
		database.prepare("SELECT count(*) AS n FROM publication_events").first(),
	).rejects.toThrow();
});
