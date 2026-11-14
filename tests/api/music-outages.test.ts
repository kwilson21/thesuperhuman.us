import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as event } from "~/pages/api/music-event";
import { POST as interest } from "~/pages/api/music-interest";
import { boundStatement } from "../helpers/d1";
import { double, fakeKv, partial } from "../helpers/doubles";
import { testRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// How the public music routes answer when storage fails or another request gets there first. The owner's decisions
// (2026-11-14): an unexpected database or store error answers 500 with the route's fixed generic sentence and never raw
// error text; a real lost race stays 409 (or, for the same event delivered twice, the duplicate's own 200); a missing
// binding is a deliberate 503. The real catalog (src/content: release "old-news-single", recording "old-news-recording")
// and the real music schema are used; nothing is mocked.

const SENTENCE = "Your request could not be saved. Please try again shortly.";
const RELEASE = "old-news-single";
const RECORDING = "old-news-recording";
const SESSION = "22222222-2222-4222-8222-222222222222";
const PLAY = "33333333-3333-4333-8333-333333333333";

const eid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const start = {
	releaseId: RELEASE,
	recordingId: RECORDING,
	sessionId: SESSION,
	playthroughId: PLAY,
	eventId: eid(1),
	sequence: 1,
	medium: "audio",
	event: "start",
	accumulatedSeconds: 0,
	mediaDurationSeconds: 160,
};

const wish = {
	releaseId: RELEASE,
	email: "fan@example.com",
	interest: "song",
	merchandise: [],
	suggestion: "",
	cityRegion: "",
	consent: true,
	turnstileToken: "token-1",
};

type Parts = {
	/** Runs before any statement whose SQL matches; it may throw to fail the statement. */
	before?: [RegExp, () => void];
	kv?: "missing" | "get fails" | "put fails" | "delete fails";
	db?: "missing";
	omit?: string[];
};

function world(parts: Parts = {}) {
	const sql = new DatabaseSync(":memory:");

	sql.exec(
		readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
	);
	const real = sqliteD1(sql);
	const [pattern, act] = parts.before ?? [/(?!)/, () => {}];

	const db = double<D1Database>({
		prepare: (query: string) => {
			if (pattern.test(query)) act();

			return real.prepare(query);
		},
		batch: async <T>(items: D1PreparedStatement[]) => {
			if (items.some((item) => pattern.test(boundStatement(item).query)))
				act();

			return real.batch<T>(items);
		},
	});

	const counts = new Map<string, string>();

	const kv = fakeKv({
		get: async (key: string) => {
			if (parts.kv === "get fails") throw new Error("kv down");

			return counts.get(key) ?? null;
		},
		put: async (key: string, value: string) => {
			if (parts.kv === "put fails") throw new Error("kv down");
			counts.set(key, value);
		},
		delete: async (key: string) => {
			if (parts.kv === "delete fails") throw new Error("kv down");
			counts.delete(key);
		},
	});

	const env = {
		MUSIC_DB: parts.db === "missing" ? undefined : db,
		RATE_LIMIT: parts.kv === "missing" ? undefined : kv,
		TURNSTILE_SECRET_KEY: "turnstile-secret",
		RESEND_API_KEY: "resend-key",
		CONTACT_FROM_EMAIL: "site@example.test",
		CONTACT_TO_EMAIL: "owner@example.test",
	};

	for (const name of parts.omit ?? []) Reflect.deleteProperty(env, name);

	return { sql, counts, env };
}

type Env = ReturnType<typeof world>["env"];

function context(path: string, body: object, env: Env) {
	return partial<APIContext>({
		request: new Request(`https://thesuperhuman.us${path}`, {
			method: "POST",
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json",
				"cf-connecting-ip": "203.0.113.7",
			},
			body: JSON.stringify(body),
		}),
		locals: partial<APIContext["locals"]>({ runtime: testRuntime(env) }),
	});
}

const play = (body: object, env: Env) =>
	event(context("/api/music-event", body, env));

const want = (body: object, env: Env) =>
	interest(context("/api/music-interest", body, env));

const sent: string[] = [];

const alerts = () => sent.filter((url) => url.includes("resend"));

beforeEach(() => {
	sent.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			sent.push(String(url));

			return Response.json({ success: true });
		}),
	);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

type Sql = InstanceType<typeof DatabaseSync>;

const stored = (sql: Sql) =>
	sql
		.prepare("SELECT id,sequence FROM music_playback_events ORDER BY sequence")
		.all()
		.map((row) => ({ id: row.id, sequence: row.sequence }));

const fails = (what: string) => () => {
	throw new Error(what);
};

const seedEvent = (sql: Sql, id: string, sequence: number, at: string) =>
	sql.exec(
		`INSERT INTO music_playback_events (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,traffic_class,occurred_at) VALUES ('${id}','${RELEASE}','${RECORDING}','${SESSION}','${PLAY}',${sequence},'audio','${sequence === 1 ? "start" : "progress"}',0,160,'human','${at}')`,
	);

describe("an outage in a store answers 500 with the route's own sentence", () => {
	it.each([
		["the duplicate lookup", /SELECT session_id,playthrough_id,sequence/],
		["the last-event lookup", /SELECT sequence,accumulated_seconds/],
		["the insert", /INSERT INTO music_playback_events/],
	])("music-event: %s fails", async (_name, pattern) => {
		const { env } = world({
			before: [pattern, fails("d1 down: secret table")],
		});

		const response = await play(start, env);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
	});

	it("music-event: the campaign lookup fails", async () => {
		const { env } = world({
			before: [/FROM owner_campaign_tags/, fails("d1 down")],
		});

		const response = await play(
			{ ...start, campaignId: "c", channel: "i", creative: "r" },
			env,
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
	});

	it.each(["get fails", "put fails"] as const)(
		"music-event: the rate limit store %s",
		async (kv) => {
			const { env } = world({ kv });
			const response = await play(start, env);

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		},
	);

	it("music-interest: the write fails", async () => {
		const { env, counts } = world({
			before: [/INSERT INTO music_interest/, fails("d1 down: secret table")],
		});

		const response = await want(wish, env);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		// The visitor's allowance is given back and the owner is told.
		expect(counts.has("rl:music-interest:203.0.113.7")).toBe(false);
		expect(alerts()).toHaveLength(1);
	});

	it.each(["get fails", "put fails"] as const)(
		"music-interest: the rate limit store %s",
		async (kv) => {
			const { env } = world({ kv });
			const response = await want(wish, env);

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		},
	);

	it("music-interest: the owner is still told when giving the allowance back fails", async () => {
		const { env } = world({
			before: [/INSERT INTO music_interest/, fails("d1 down")],
		});

		// Fail only the delete, after the counts have been made.
		const kv = env.RATE_LIMIT;

		if (!kv) throw new Error("the world has a rate limit namespace");
		kv.delete = async () => {
			throw new Error("kv down");
		};

		const response = await want(wish, env);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		expect(alerts()).toHaveLength(1);
	});
});

describe("a missing binding stays a deliberate 503", () => {
	it("music-event without the rate limit namespace or the database", async () => {
		for (const parts of [{ kv: "missing" }, { db: "missing" }] as const) {
			const { env } = world(parts);
			const response = await play(start, env);

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		}
	});

	it("music-interest without the rate limit namespace, the database or the captcha secret", async () => {
		for (const parts of [
			{ kv: "missing" },
			{ db: "missing" },
			{ omit: ["TURNSTILE_SECRET_KEY"] },
		] as const) {
			const { env } = world(parts);
			const response = await want(wish, env);

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ ok: false, error: SENTENCE });
		}
	});
});

describe("a playback event that loses a race", () => {
	it("is a duplicate delivery when the same event arrives from another connection first", async () => {
		let act = () => {};

		const { sql, env } = world({
			before: [/INSERT INTO music_playback_events/, () => act()],
		});

		act = () => seedEvent(sql, eid(1), 1, "2026-11-13T11:59:59.000Z");
		const response = await play(start, env);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(stored(sql)).toEqual([{ id: eid(1), sequence: 1 }]);
	});

	it("is a 409 when another event took the same place in the playthrough", async () => {
		let act = () => {};

		const { sql, env } = world({
			before: [/INSERT INTO music_playback_events/, () => act()],
		});

		act = () => seedEvent(sql, eid(2), 1, "2026-11-13T11:59:59.000Z");
		const response = await play(start, env);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ ok: false });
		expect(stored(sql)).toEqual([{ id: eid(2), sequence: 1 }]);
	});
});

describe("a playthrough whose first event is gone", () => {
	it("is refused, not accepted without the server clock to check it against", async () => {
		const { sql, env } = world();

		seedEvent(sql, eid(2), 2, "2026-11-13T11:50:00.000Z");

		const response = await play(
			{
				...start,
				eventId: eid(3),
				sequence: 3,
				event: "progress",
				accumulatedSeconds: 0,
			},
			env,
		);

		expect(response.status).toBe(409);
		expect(stored(sql)).toEqual([{ id: eid(2), sequence: 2 }]);
	});
});
