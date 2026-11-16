import type { APIContext } from "astro";
import { afterEach, expect, it, type Mock, vi } from "vitest";
import { POST } from "~/pages/api/owner/projects/[id]/invitation";
import { freshMusicDb } from "../golden/harness";
import { double, partial } from "../helpers/doubles";
import { stubResend } from "../helpers/resend-fetch";
import type { TestRuntime } from "../helpers/runtime";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";

type InvitationContext = APIContext & {
	waitUntil: Mock;
	/** Resolves once every background job the route scheduled has finished. */
	settled: () => Promise<void[]>;
};

/** Databases opened by the current test, closed after it even when an assertion fails. */
const openDatabases: SqliteDatabase[] = [];

/** A database with one service request, whose project invitation starts at `status`. */
function projectDb(status: string): SqliteDatabase {
	const sql = freshMusicDb();
	openDatabases.push(sql);
	sql.exec("PRAGMA foreign_keys=ON");
	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','new','2026-09-22','2026-09-22')`)
		.run();
	sql
		.prepare(
			"UPDATE audio_projects SET invitation_status=? WHERE request_id='song-1'",
		)
		.run(status);

	return sql;
}

function invitationStatus(sql: SqliteDatabase): string {
	const row = sql
		.prepare(
			"SELECT invitation_status FROM audio_projects WHERE request_id='song-1'",
		)
		.get();

	return String(row?.invitation_status);
}

function context(
	sql: SqliteDatabase,
	options: {
		owner?: boolean;
		enabled?: boolean;
		action?: string;
		confirmedNotSent?: boolean;
	} = {},
): InvitationContext {
	const background: Promise<void>[] = [];

	const waitUntil = vi.fn((work: Promise<unknown>) => {
		background.push(work.then(() => {}));
	});

	const env: Partial<TestRuntime["env"]> = {
		AUDIO_CLIENT_PORTAL_ENABLED: options.enabled === false ? "false" : "true",
		MUSIC_DB: sqliteD1(sql),
		RESEND_API_KEY: "test",
		CONTACT_FROM_EMAIL: "studio@example.com",
	};

	return double<InvitationContext>({
		params: { id: "song-1" },
		request: new Request(
			"https://thesuperhuman.us/api/owner/projects/song-1/invitation",
			{
				method: "POST",
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					action: options.action ?? "send",
					confirmedNotSent: options.confirmedNotSent ?? false,
				}),
			},
		),
		locals: {
			owner:
				options.owner === false ? undefined : { email: "owner@example.com" },
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>(env),
				ctx: double<ExecutionContext>({ waitUntil }),
			}),
		},
		waitUntil,
		settled: () => Promise.all(background),
	});
}

afterEach(() => {
	for (const sql of openDatabases.splice(0)) sql.close();
	vi.unstubAllGlobals();
});

it("keeps invitation sending behind the owner and portal gates", async () => {
	const sql = projectDb("failed");
	const emails = stubResend();

	expect((await POST(context(sql, { owner: false }))).status).toBe(403);
	expect((await POST(context(sql, { enabled: false }))).status).toBe(404);
	expect((await POST(context(sql, { action: "wrong" }))).status).toBe(400);
	expect(invitationStatus(sql)).toBe("failed");
	expect(emails).toHaveLength(0);
});

it("queues one owner-triggered invitation and schedules delivery", async () => {
	const sql = projectDb("failed");
	const emails = stubResend();

	const ctx = context(sql);
	expect((await POST(ctx)).status).toBe(200);
	await ctx.settled();
	expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
	expect(emails).toHaveLength(1);
	expect(emails[0]).toMatchObject({
		to: ["artist@example.com"],
		subject: "Your private studio project",
	});
	// The invitation template's wording, and not the update template's.
	expect(emails[0]?.text).toContain("Your song has a private studio.");
	expect(emails[0]?.html).toContain("Your song has a private studio.");
	expect(emails[0]?.text).not.toContain("You have a new studio update.");
	expect(emails[0]?.html).not.toContain("You have a new studio update.");
	expect(invitationStatus(sql)).toBe("sent");

	// A sent invitation cannot be queued again without a stale claim to recover.
	expect((await POST(context(sql))).status).toBe(409);
	expect(emails).toHaveLength(1);

	sql
		.prepare(
			"UPDATE audio_projects SET invitation_status='sending',invitation_attempted_at='2020-01-01T00:00:00.000Z' WHERE request_id='song-1'",
		)
		.run();
	// A plain send does not count as the owner's confirmation that the stale email was not sent.
	const plain = context(sql);
	expect((await POST(plain)).status).toBe(409);
	await plain.settled();
	expect(emails).toHaveLength(1);

	const retry = context(sql, { confirmedNotSent: true });
	expect((await POST(retry)).status).toBe(200);
	await retry.settled();
	expect(emails).toHaveLength(2);
	expect(invitationStatus(sql)).toBe("sent");
});
