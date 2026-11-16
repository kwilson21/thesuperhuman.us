import type { APIContext } from "astro";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "~/pages/api/owner/projects/[id]/updates";
import { freshMusicDb } from "../golden/harness";
import { double, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import { stubResend } from "../helpers/resend-fetch";
import type { TestRuntime } from "../helpers/runtime";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";

type UpdateContext = APIContext & {
	/** Resolves once every background job the route scheduled has finished. */
	settled: () => Promise<void[]>;
};

/** Databases opened by the current test, closed after it even when an assertion fails. */
const openDatabases: SqliteDatabase[] = [];

/** A database with one reviewed service request and its project at `stage`. */
function projectDb(stage: string): SqliteDatabase {
	const sql = freshMusicDb();
	openDatabases.push(sql);
	sql.exec("PRAGMA foreign_keys=ON");
	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','reviewed','2026-09-22','2026-09-22')`)
		.run();
	sql
		.prepare("UPDATE audio_projects SET stage=? WHERE request_id='song-1'")
		.run(stage);

	return sql;
}

function context(
	sql: SqliteDatabase,
	body: JsonObject,
	options: { owner?: boolean; enabled?: boolean; origin?: string } = {},
): UpdateContext {
	const background: Promise<void>[] = [];

	return Object.assign(
		partial<APIContext>({
			params: { id: "song-1" },
			request: new Request(
				"https://thesuperhuman.us/api/owner/projects/song-1/updates",
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: options.origin ?? "https://thesuperhuman.us",
					},
					body: JSON.stringify(body),
				},
			),
			locals: {
				owner:
					options.owner === false ? undefined : { email: "owner@example.com" },
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>({
						AUDIO_CLIENT_PORTAL_ENABLED:
							options.enabled === false ? "false" : "true",
						MUSIC_DB: sqliteD1(sql),
						RESEND_API_KEY: "test",
						CONTACT_FROM_EMAIL: "studio@example.com",
					}),
					ctx: double<ExecutionContext>({
						waitUntil: vi.fn((work: Promise<unknown>) => {
							background.push(work.then(() => {}));
						}),
					}),
				}),
			},
		}),
		{ settled: () => Promise.all(background) },
	);
}

function updateCount(sql: SqliteDatabase): number {
	const row = sql
		.prepare("SELECT COUNT(*) AS count FROM audio_project_updates")
		.get();

	return Number(row?.count);
}

afterEach(() => {
	for (const sql of openDatabases.splice(0)) sql.close();
	vi.unstubAllGlobals();
});

it("allows only the owner through the disabled-by-default project gate", async () => {
	const sql = projectDb("in_progress");
	const emails = stubResend();

	expect(
		(
			await POST(
				context(
					sql,
					{ action: "progress", body: "Listening now." },
					{ owner: false },
				),
			)
		).status,
	).toBe(403);
	expect(
		(
			await POST(
				context(
					sql,
					{ action: "progress", body: "Listening now." },
					{ enabled: false },
				),
			)
		).status,
	).toBe(404);
	expect(updateCount(sql)).toBe(0);
	expect(emails).toHaveLength(0);
});

it("saves first and schedules a separate minimal email delivery", async () => {
	const sql = projectDb("in_progress");
	const emails = stubResend();

	const ctx = context(sql, {
		action: "progress",
		body: "I have started listening.",
	});

	const response = await POST(ctx);
	expect(response.status).toBe(200);
	await ctx.settled();
	expect(
		sql
			.prepare(
				"SELECT kind,body,actor,notification_status FROM audio_project_updates",
			)
			.all(),
	).toEqual([
		{
			kind: "progress",
			body: "I have started listening.",
			actor: "owner@example.com",
			notification_status: "sent",
		},
	]);
	expect(emails).toHaveLength(1);
	expect(emails[0].to).toEqual(["artist@example.com"]);
	expect(ctx.locals.runtime.ctx.waitUntil).toHaveBeenCalledOnce();
});

it("rejects invalid and cross-site updates without saving anything", async () => {
	const sql = projectDb("in_progress");
	const emails = stubResend();

	expect(
		(
			await POST(
				context(sql, {
					action: "revise_date",
					dueDate: "2026-02-30",
					reason: "protect_song",
					body: "More time.",
				}),
			)
		).status,
	).toBe(400);
	expect(
		(
			await POST(
				context(
					sql,
					{ action: "progress", body: "Cross-site" },
					{ origin: "https://other.example" },
				),
			)
		).status,
	).toBe(403);
	expect(updateCount(sql)).toBe(0);
	expect(emails).toHaveLength(0);
});

it("passes owner confirmation through when retrying an unconfirmed notification", async () => {
	const sql = projectDb("in_progress");
	sql
		.prepare(`INSERT INTO audio_project_updates(id,request_id,kind,body,actor,created_at,notification_status,notification_attempted_at)
    VALUES (7,'song-1','progress','We are set.','owner@example.com','2026-09-22','sending','2020-01-01T00:00:00.000Z')`)
		.run();
	const emails = stubResend();

	expect(
		(await POST(context(sql, { action: "retry_email", updateId: 7 }))).status,
	).toBe(409);
	expect(emails).toHaveLength(0);

	const ctx = context(sql, {
		action: "retry_email",
		updateId: 7,
		confirmedNotSent: true,
	});

	expect((await POST(ctx)).status).toBe(200);
	await ctx.settled();
	expect(emails).toHaveLength(1);
	expect(
		sql
			.prepare(
				"SELECT notification_status FROM audio_project_updates WHERE id=7",
			)
			.get(),
	).toEqual({ notification_status: "sent" });
});
