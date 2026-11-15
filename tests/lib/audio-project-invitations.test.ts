import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	deliverProjectInvitation,
	queueProjectInvitation,
} from "~/lib/audio-project-invitations";
import { fakeFirst } from "../helpers/d1";
import { double, partial } from "../helpers/doubles";
import { stubResend } from "../helpers/resend-fetch";
import { sqliteD1 } from "../helpers/sqlite-d1";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

/** Databases opened by the current test, closed after it even when an assertion fails. */
const openDatabases: { close(): void }[] = [];

function fixture() {
	const sql = new DatabaseSync(":memory:");
	openDatabases.push(sql);
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);

	const db = sqliteD1(sql);

	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','new','2026-09-22','2026-09-22')`)
		.run();

	return { sql, db };
}

afterEach(() => {
	for (const sql of openDatabases.splice(0)) sql.close();
	vi.unstubAllGlobals();
});

describe("project invitations", () => {
	it("sends one sign-in notice and records success", async () => {
		const { sql, db } = fixture();
		const emails = stubResend();

		const env = partial<Env>({
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "studio@example.com",
		});

		await Promise.all([
			deliverProjectInvitation(db, "song-1", env),
			deliverProjectInvitation(db, "song-1", env),
		]);
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			authorization: "Bearer test",
			from: "studio@example.com",
			to: ["artist@example.com"],
			subject: "Your private studio project",
		});
		// The invitation template's wording, and not the update template's.
		expect(emails[0]?.text).toContain("Your song has a private studio.");
		expect(emails[0]?.html).toContain("Your song has a private studio.");
		expect(emails[0]?.text).not.toContain("You have a new studio update.");
		expect(emails[0]?.html).not.toContain("You have a new studio update.");
		expect(
			sql
				.prepare(
					"SELECT invitation_status,invitation_sent_at IS NOT NULL AS delivered FROM audio_projects WHERE request_id='song-1'",
				)
				.get(),
		).toEqual({ invitation_status: "sent", delivered: 1 });
		expect(await queueProjectInvitation(db, "song-1")).toBe(false);
	});

	it("retains a failed invitation for an explicit retry", async () => {
		const { sql, db } = fixture();
		const emails = stubResend({ resend: [{ status: 422 }] });

		const env = partial<Env>({
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "studio@example.com",
		});

		await deliverProjectInvitation(db, "song-1", env);
		expect(
			sql
				.prepare(
					"SELECT invitation_status FROM audio_projects WHERE request_id='song-1'",
				)
				.get(),
		).toEqual({ invitation_status: "failed" });
		expect(await queueProjectInvitation(db, "song-1")).toBe(true);
		await deliverProjectInvitation(db, "song-1", env);
		expect(emails).toHaveLength(2);
	});

	it("requires checking Resend before retrying an uncertain invitation", async () => {
		const { sql, db } = fixture();
		const emails = stubResend({ resend: [{ status: 500 }] });

		const env = partial<Env>({
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "studio@example.com",
		});

		await deliverProjectInvitation(db, "song-1", env);
		expect(
			sql
				.prepare(
					"SELECT invitation_status FROM audio_projects WHERE request_id='song-1'",
				)
				.get(),
		).toEqual({ invitation_status: "sending" });
		expect(
			await queueProjectInvitation(
				db,
				"song-1",
				false,
				new Date(Date.now() + 61_000),
			),
		).toBe(false);
		expect(
			await queueProjectInvitation(
				db,
				"song-1",
				true,
				new Date(Date.now() + 61_000),
			),
		).toBe(true);
		await deliverProjectInvitation(db, "song-1", env);
		expect(emails).toHaveLength(2);
	});

	it("does not invite a withdrawn or revoked project", async () => {
		const { sql, db } = fixture();
		const emails = stubResend();

		const env = partial<Env>({
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "studio@example.com",
		});

		sql
			.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='song-1'")
			.run();
		await deliverProjectInvitation(db, "song-1", env);
		expect(await queueProjectInvitation(db, "song-1")).toBe(false);
		expect(emails).toHaveLength(0);
	});

	it("does not send an invitation when access closes after the delivery claim", async () => {
		const { sql, db } = fixture();
		const emails = stubResend();

		const env = partial<Env>({
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "studio@example.com",
		});

		const interleavedDb = double<D1Database>({
			prepare(query: string) {
				const statement = db.prepare(query);

				if (!query.includes("SELECT r.email FROM owner_requests"))
					return statement;

				return double<D1PreparedStatement>({
					bind(...values: unknown[]) {
						const bound = statement.bind(...values);

						return double<D1PreparedStatement>({
							first: fakeFirst(async () => {
								sql
									.prepare(
										"UPDATE audio_projects SET revoked_at='2026-09-22' WHERE request_id='song-1'",
									)
									.run();

								return bound.first();
							}),
						});
					},
				});
			},
		});

		await deliverProjectInvitation(interleavedDb, "song-1", env);
		expect(emails).toHaveLength(0);
		expect(
			sql
				.prepare(
					"SELECT invitation_status FROM audio_projects WHERE request_id='song-1'",
				)
				.get(),
		).toEqual({ invitation_status: "sending" });
	});
});
