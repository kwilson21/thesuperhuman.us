import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { recordPlayback } from "../../src/server/flows/music-event";
import type { EventInput } from "../../src/server/music-input";
import type { Visitor } from "../../src/server/rules/visitor";
import { MusicDb, RateLimit } from "../../src/server/services";
import { fakeKv } from "../helpers/doubles";
import { musicWorld, type MusicWorldOptions } from "../helpers/music-world";
import { answerOfRun, refuseWith, refuse } from "../helpers/rule-answers";
import type { SqliteDatabase } from "../helpers/sqlite-d1";

// The playback flow as stories: a player's events arrive over time, the same event is delivered again, other requests
// store events between this one's read and its insert, and the stores fail. Each story runs the real flow against the real
// schema, with the clock and the rate limit store as inputs.

const SESSION = "22222222-2222-4222-8222-222222222222";
const PLAY = "33333333-3333-4333-8333-333333333333";

const eid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const event = (
	n: number,
	seconds: number,
	over: Partial<EventInput> = {},
): EventInput => ({
	releaseId: "old-news-single",
	recordingId: "old-news-recording",
	sessionId: SESSION,
	playthroughId: PLAY,
	eventId: eid(n),
	sequence: n,
	medium: "audio",
	event: n === 1 ? "start" : "progress",
	accumulatedSeconds: seconds,
	mediaDurationSeconds: 200,
	campaignId: undefined,
	channel: undefined,
	creative: undefined,
	...over,
});

const person: Visitor = {
	verifiedBot: false,
	userAgent: "Mozilla/5.0 Firefox/120.0",
	country: undefined,
	region: undefined,
	city: undefined,
};

const at = (time: string) => () => new Date(`2026-09-19T${time}Z`);

type World = ReturnType<typeof musicWorld>;

/** Delivers one event at `time` and says what the flow answered. */
const deliver = (
	world: World,
	input: EventInput,
	time: string,
	visitor: Visitor = person,
) =>
	answerOfRun(
		recordPlayback({ input, ip: "203.0.113.7", visitor, now: at(time) }).pipe(
			Effect.provide(
				Context.make(MusicDb, world.db).pipe(Context.add(RateLimit, world.kv)),
			),
		),
	);

const stored = (sql: SqliteDatabase) =>
	sql
		.prepare(
			"SELECT sequence,medium,event FROM music_playback_events ORDER BY sequence",
		)
		.all()
		.map((row) => `${row.sequence} ${row.medium} ${row.event}`);

/** The flow finished, and when it stored nothing (a duplicate) there is nothing saved. */
const finished = { kind: "done" };

describe("a playthrough's events", () => {
	it("are stored in order, across audio and video, and a retry stores nothing more", async () => {
		const world = musicWorld();

		await deliver(world, event(1, 0), "12:00:00.000");
		await deliver(world, event(1, 0), "12:00:00.000");
		await deliver(world, event(2, 10, { medium: "video" }), "12:00:10.000");
		await deliver(world, event(3, 20, { medium: "video" }), "12:00:20.000");

		const listen = await deliver(
			world,
			event(4, 30, { medium: "video", event: "listen30" }),
			"12:00:30.000",
		);

		expect(listen.kind).toBe("done");
		expect(stored(world.sql)).toEqual([
			"1 audio start",
			"2 video progress",
			"3 video progress",
			"4 video listen30",
		]);
	});

	it("catch up after a delivery delay, since the server's clock has moved on", async () => {
		const world = musicWorld();

		await deliver(world, event(1, 0), "12:00:00.000");
		await deliver(world, event(2, 10), "12:00:30.000");
		await deliver(world, event(3, 20), "12:00:30.000");

		const listen = await deliver(
			world,
			event(4, 30, { event: "listen30" }),
			"12:00:30.000",
		);

		expect(listen.kind).toBe("done");
	});

	it("refuse listening that runs faster than the server's clock", async () => {
		const world = musicWorld();

		await deliver(world, event(1, 0), "12:00:00.000");

		expect(await deliver(world, event(2, 12), "12:00:01.000")).toEqual(
			refuse(
				"FasterThanServerTime",
				"Reported playback advanced faster than server time.",
			),
		);
	});

	it("do not turn an idle gap into earned listening", async () => {
		const world = musicWorld();

		await deliver(world, event(1, 0), "12:00:00.000");

		// Thirty seconds in one step skips the evidence a progress every ten seconds gives.
		expect(
			await deliver(world, event(2, 30, { event: "listen30" }), "12:01:00.000"),
		).toEqual(
			refuse(
				"ProgressSkipped",
				"Reported playback skipped required progress evidence.",
			),
		);
	});

	it("keep two playthroughs apart", async () => {
		const world = musicWorld();
		const other = "55555555-5555-4555-8555-555555555555";

		await deliver(world, event(1, 0), "12:00:00.000");
		await deliver(
			world,
			event(11, 0, { playthroughId: other, sequence: 1, event: "start" }),
			"12:00:00.000",
		);

		expect((await deliver(world, event(2, 5), "12:00:06.000")).kind).toBe(
			"done",
		);
		expect(stored(world.sql)).toHaveLength(3);
	});
});

describe("a campaign", () => {
	const campaign = (status: string) => (world: World) =>
		world.sql.exec(`INSERT INTO owner_campaigns (id,subject_type,subject_id,name,primary_goal,starts_at,status,created_at,updated_at)
      VALUES ('old-news','release','old-news-single','Old News launch','Listening','2026-09-16','${status}','now','now');
      INSERT INTO owner_campaign_tags VALUES ('old-news','instagram','lyric-clip');`);

	const tagged = event(1, 0, {
		campaignId: "old-news",
		channel: "instagram",
		creative: "lyric-clip",
	});

	const tagOf = (world: World) =>
		world.sql
			.prepare("SELECT campaign_id,channel,creative FROM music_playback_events")
			.get();

	it("tags a playback the owner defined for an active campaign", async () => {
		const world = musicWorld();

		campaign("active")(world);
		await deliver(world, tagged, "12:00:00.000");
		expect(tagOf(world)).toEqual({
			campaign_id: "old-news",
			channel: "instagram",
			creative: "lyric-clip",
		});
	});

	it.each(["draft", "complete"])(
		"leaves a playback untagged for a %s campaign",
		async (status) => {
			const world = musicWorld();

			campaign(status)(world);
			await deliver(world, tagged, "12:00:00.000");
			expect(tagOf(world)).toEqual({
				campaign_id: null,
				channel: null,
				creative: null,
			});
		},
	);

	it("never stores the names the player sent when the owner defined none", async () => {
		const world = musicWorld();

		await deliver(world, tagged, "12:00:00.000");
		expect(tagOf(world)).toEqual({
			campaign_id: null,
			channel: null,
			creative: null,
		});
	});
});

describe("a request that loses a race for the event's place", () => {
	const competing = (world: () => World, id: string) => () =>
		world().sql.exec(
			`INSERT INTO music_playback_events (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,traffic_class,occurred_at) VALUES ('${id}','old-news-single','old-news-recording','${SESSION}','${PLAY}',1,'audio','start',0,200,'human','2026-09-19T11:59:59.000Z')`,
		);

	const raced = (id: string): World => {
		const options: MusicWorldOptions = {
			beforeStatement: [/INSERT INTO music_playback_events/, () => act()],
		};

		const made = musicWorld(options);

		act = competing(() => made, id);

		return made;
	};

	let act = () => {};

	it("is a duplicate delivery when the same event was stored first", async () => {
		const world = raced(eid(1));

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toMatchObject(
			finished,
		);
		expect(stored(world.sql)).toEqual(["1 audio start"]);
	});

	it("is out of sequence when another event took the place", async () => {
		const world = raced(eid(9));

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toMatchObject({
			kind: "refuse",
			type: "PlaybackOutOfSequence",
		});
		expect(stored(world.sql)).toEqual(["1 audio start"]);
	});

	it("gives up after three reads that cannot see what the insert keeps meeting", async () => {
		const world = musicWorld({ blindReads: true });

		world.sql.exec(
			`INSERT INTO music_playback_events (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,traffic_class,occurred_at) VALUES ('${eid(9)}','old-news-single','old-news-recording','${SESSION}','${PLAY}',1,'audio','start',0,200,'human','2026-09-19T11:59:59.000Z')`,
		);

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toMatchObject({
			kind: "refuse",
			type: "SaveKeptChanging",
		});
	});
});

describe("the rate limits", () => {
	it("refuse the 241st event of any kind from one address in the window", async () => {
		const world = musicWorld();

		world.counts.set("rl:music-event-all:203.0.113.7", "240");

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toMatchObject({
			kind: "refuse",
			type: "TooManyPlaybacks",
		});
		expect(stored(world.sql)).toEqual([]);
	});

	it("refuse the 61st event of one kind, and count the first limit before the second", async () => {
		const world = musicWorld();

		world.counts.set(
			"rl:music-event:old-news-single:old-news-recording:audio:start:203.0.113.7",
			"60",
		);

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toMatchObject({
			kind: "refuse",
			type: "TooManyPlaybacks",
		});
		expect(world.counts.get("rl:music-event-all:203.0.113.7")).toBe("1");
	});
});

describe("a store that fails", () => {
	it("is a named failure for the database, never raw text", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO music_playback_events/,
				() => {
					throw new Error("d1 down: secret");
				},
			],
		});

		expect(await deliver(world, event(1, 0), "12:00:00.000")).toEqual(
			refuseWith("MusicStoreFailed", {}),
		);
	});

	it("is a named failure for the rate limit store", async () => {
		const world = musicWorld();

		const broken = fakeKv({
			get: async () => {
				throw new Error("kv down: secret");
			},
		});

		const answer = await answerOfRun(
			recordPlayback({
				input: event(1, 0),
				ip: "203.0.113.7",
				visitor: person,
				now: at("12:00:00.000"),
			}).pipe(
				Effect.provide(
					Context.make(MusicDb, world.db).pipe(Context.add(RateLimit, broken)),
				),
			),
		);

		expect(answer).toMatchObject({
			kind: "refuse",
			type: "RateLimitStoreFailed",
		});
	});
});
