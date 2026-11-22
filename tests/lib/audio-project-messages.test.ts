import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	latestReviewDecision,
	listProjectMessages,
	revisionRoundsLeft,
	validateProjectMessage,
} from "~/lib/audio-project-messages";
import { sqliteD1 } from "../helpers/sqlite-d1";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

const AT = "2026-09-22T12:00:00.000Z";

function fixture() {
	const sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);
	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES ('song-1','service','artist@example.com','A song','new',?,?)`)
		.run(AT, AT);

	return { sql, db: sqliteD1(sql) };
}

describe("audio project messages", () => {
	it("accepts plain language and HTTPS shared links, but rejects unsafe or oversized input", () => {
		expect(validateProjectMessage("  Make the hook feel more open.  ")).toBe(
			"Make the hook feel more open.",
		);
		expect(
			validateProjectMessage(
				"Updated files: https://drive.google.com/file/example",
			),
		).toContain("https://");
		expect(validateProjectMessage("http://example.com/file")).toBeNull();
		expect(validateProjectMessage("www.example.com/file")).toBeNull();
		expect(
			validateProjectMessage("https://user:pass@example.com/file"),
		).toBeNull();
		expect(validateProjectMessage("x".repeat(4001))).toBeNull();
	});

	it("lists both sides in one thread, in order", async () => {
		const { sql, db } = fixture();

		const insert = sql.prepare(
			"INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at) VALUES ('song-1',?,'x',?,?)",
		);

		insert.run("client", "I updated the Drive link.", AT);
		insert.run("owner", "Thanks, I have it.", AT);

		expect(
			(await listProjectMessages(db, "song-1")).map((m) => m.body),
		).toEqual(["I updated the Drive link.", "Thanks, I have it."]);
		sql.close();
	});

	it("counts the revision rounds begun and reports the client's answer to the latest review", async () => {
		const { sql, db } = fixture();
		expect(await revisionRoundsLeft(db, "song-1")).toBe(2);
		expect(await latestReviewDecision(db, "song-1")).toBeNull();

		sql
			.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at)
      VALUES ('review-1','song-1','review','key-1','Mix.wav','audio/wav',10,'published',?,'2026-09-22T11:00:00.000Z')`)
			.run(AT);
		sql
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone)
        VALUES ('song-1','progress','Revising.','owner@example.com',?,'revision_started')`)
			.run(AT);
		expect(await revisionRoundsLeft(db, "song-1")).toBe(1);
		sql
			.prepare(`INSERT INTO audio_project_messages(request_id,actor,actor_id,body,created_at,review_decision)
        VALUES ('song-1','client','x','More air.',?,'changes')`)
			.run(AT);
		expect(await latestReviewDecision(db, "song-1")).toBe("changes");
		sql.close();
	});
});

it.each([null, undefined, 42, ["Make the hook feel more open."]])(
	"returns null for a message that is not text (%j)",
	(value) => {
		expect(validateProjectMessage(value)).toBeNull();
	},
);
