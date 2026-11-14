import type { APIContext } from "astro";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import { testRuntime } from "../helpers/runtime";
import { sqliteD1, type SqliteDatabase } from "../helpers/sqlite-d1";
import { freshMusicDb, rows, seed, type SeedRow } from "../golden/harness";
import { hashValue } from "~/lib/audio-client-access";
import { POST } from "~/pages/api/studio/projects/[id]/messages";

// Seeded times are relative to the run, so the test does not depend on the date it runs on.
const EARLIER = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const FAR_FUTURE = "2100-01-01T00:00:00.000Z";
const PROJECT = "song-1";
const CLIENT = "grace@example.test";
const token = "00000000-0000-4000-8000-000000000000".repeat(2);

let sql: SqliteDatabase, db: D1Database;

// A published review file. The newest published review is the one a client can answer.
function reviewFile(id: string, publishedAt: string): SeedRow {
	return {
		id,
		request_id: PROJECT,
		version: "review",
		object_key: `projects/${PROJECT}/${id}`,
		display_name: "Mix.mp3",
		media_type: "audio/mpeg",
		byte_size: 1000,
		downloadable: 0,
		status: "published",
		uploaded_at: publishedAt,
		published_at: publishedAt,
	};
}

// Owner revision rounds already begun. Two rounds used means the client has no change requests left.
function revisionRounds(count: number) {
	seed(sql, {
		audio_project_updates: Array.from({ length: count }, (_, index) => ({
			request_id: PROJECT,
			kind: "progress",
			body: "Revision started",
			actor: "owner@example.test",
			created_at: new Date(Date.parse(EARLIER) + index * 1000).toISOString(),
			milestone: "revision_started",
		})),
	});
}

function messages() {
	return sql
		.prepare(
			"SELECT actor,body,review_decision FROM audio_project_messages ORDER BY id",
		)
		.all();
}

function projectRevoked() {
	return sql
		.prepare("SELECT revoked_at IS NOT NULL AS revoked FROM audio_projects")
		.get();
}

function context(body: JsonObject): APIContext {
	return partial<APIContext>({
		params: { id: PROJECT },
		request: new Request(
			`https://thesuperhuman.us/api/studio/projects/${PROJECT}/messages`,
			{
				method: "POST",
				headers: {
					origin: "https://thesuperhuman.us",
					"content-type": "application/json",
					cookie: `studio_session=${token}`,
				},
				body: JSON.stringify(body),
			},
		),
		locals: {
			runtime: testRuntime({
				AUDIO_CLIENT_PORTAL_ENABLED: "true",
				MUSIC_DB: db,
			}),
		},
	});
}

// Moves the fake clock forward, so each step is stamped after the one before it and no stamp is in the future.
function advanceClock(ms: number) {
	vi.setSystemTime(new Date(Date.now() + ms));
}

afterEach(() => {
	sql.close();
	vi.useRealTimers();
});

beforeEach(async () => {
	// Only Date is faked. The clock starts at the real time and is moved by advanceClock() between steps.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date());
	sql = freshMusicDb();
	db = sqliteD1(sql);
	seed(sql, {
		owner_requests: [
			rows.ownerRequest(PROJECT, {
				kind: "service",
				email: CLIENT,
				status: "reviewed",
			}),
		],
	});
	sql
		.prepare(
			"UPDATE audio_projects SET stage='review_ready' WHERE request_id=?",
		)
		.run(PROJECT);
	seed(sql, {
		audio_client_sessions: [
			{
				token_hash: await hashValue(token),
				email: CLIENT,
				created_at: EARLIER,
				expires_at: FAR_FUTURE,
				last_seen_at: EARLIER,
			},
		],
		audio_project_files: [reviewFile("review-1", EARLIER)],
	});
});

it("approves with a default note, requires notes for changes, and never closes access for either", async () => {
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-1",
					decision: "approved",
					body: "",
				}),
			)
		).status,
	).toBe(200);
	expect(messages()).toEqual([
		{
			actor: "client",
			body: "I approve this mix.",
			review_decision: "approved",
		},
	]);
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-1",
					decision: "changes",
					body: "  ",
				}),
			)
		).status,
	).toBe(400);
	// The approval answered review-1, so a change request needs a review published after it. Review-2 is published
	// one second after the approval, and the client answers it one second after that.
	advanceClock(1000);
	seed(sql, {
		audio_project_files: [reviewFile("review-2", new Date().toISOString())],
	});
	advanceClock(1000);
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-2",
					decision: "changes",
					body: "Vocal up in verse two.",
				}),
			)
		).status,
	).toBe(200);
	expect(messages().at(-1)).toEqual({
		actor: "client",
		body: "Vocal up in verse two.",
		review_decision: "changes",
	});
	expect(projectRevoked()).toEqual({ revoked: 0 });
	// That answer closed review-2, so a second answer to it is refused and nothing is saved.
	advanceClock(1000);
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-2",
					decision: "changes",
					body: "A second note on the same review.",
				}),
			)
		).status,
	).toBe(409);
	expect(messages()).toHaveLength(2);
});

it("passes a stop through with a default note", async () => {
	revisionRounds(2);
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-1",
					decision: "stopped",
					body: "",
				}),
			)
		).status,
	).toBe(200);
	expect(messages()).toEqual([
		{
			actor: "client",
			body: "I’m stopping the project here.",
			review_decision: "stopped",
		},
	]);
	expect(projectRevoked()).toEqual({ revoked: 1 });
});

it("refuses an answer the project does not allow, and one without the review it answers", async () => {
	// Stopping is allowed only once both revision rounds are used, so with none used this is refused.
	expect(
		(
			await POST(
				context({
					action: "respond",
					reviewId: "review-1",
					decision: "stopped",
					body: "",
				}),
			)
		).status,
	).toBe(409);
	expect(messages()).toEqual([]);
	expect(projectRevoked()).toEqual({ revoked: 0 });
	expect(
		(await POST(context({ action: "respond", decision: "approved", body: "" })))
			.status,
	).toBe(400);
});
