import { POST } from "~/pages/api/music-event";
import type { JsonObject, JsonValue } from "../helpers/json";
import {
	asVisitor,
	defineCorpus,
	type Case,
	type Dump,
	type SeedRow,
	type Step,
} from "./harness";
import { IP, ORIGIN, rawVisit, visit } from "./areas/public";

// The golden corpus for POST /api/music-event: the player on a release page reports a playback event (start, progress,
// listen30, complete, replay). The route validates the body, checks the release and recording against the real catalog
// (src/content: release "old-news-single" with recording "old-news-recording", 160 seconds, audio and video), limits the
// address twice, resolves the campaign tag, classifies the visitor and stores the event. Playback evidence is checked
// in saveEvent (src/lib/music-demand.ts): the sequence, the accumulated seconds and the server's own clock.
//
// Every response branch, and the cases that reach it:
//
//   musicRequest (src/lib/music-request.ts, 8192-byte limit)
//   403 / 415 / 400 / 413               no Origin, another site, www, http; text/plain, no content type, form; no body,
//                                       empty, broken JSON; over 8192 bytes
//   400 { ok: false }  eventSchema      every field missing, wrong type, malformed or out of range; a body that is not an
//                                       object
//   204 (no body)                       MUSIC_EVENTS_ENABLED "false" (a bad body is still 400 first); "true", "0", "" and
//                                       absent all keep recording
//   404 { ok: false }                   an unknown release, an unknown recording, a release id given as the recording
//                                       and the reverse, the release's slug. (Two branches need a second recording: one
//                                       the release does not list, and a video event for a recording with no video. The
//                                       catalog has one recording, which has a video, so neither is reachable here.)
//   503 "could not be saved"            no MUSIC_DB; no RATE_LIMIT
//   500 "could not be saved"            KV read or write throws; a database error in any statement of saveEvent
//                                       (duplicate lookup, last-event lookup, insert, campaign lookup). An unexpected
//                                       failure, never the error's own text.
//   429 { ok: false }                   the all-events counter (240 a window), the per-event counter (60 a window),
//                                       counts just below the limits, a count that is not a number
//   409 { ok: false }  PlaybackSequenceError
//                                       an event id reused by another session, playthrough or sequence; a start or replay
//                                       that is not the first, not sequence 1 or not at 0 seconds; a progress, listen30
//                                       or complete with no earlier event, a sequence gap or repeat, seconds going back;
//                                       a listen30 under 30 seconds; a complete under 90% (or at exactly 90%); more than
//                                       12 seconds in one step; seconds more than 2 ahead of the server's clock (and
//                                       exactly 2 ahead, which is allowed); a playthrough with no sequence 1 row; another
//                                       event taking the same place just before the insert. The "complete with a zero duration" check
//                                       cannot be reached: the route always passes the catalog's 160 seconds.
//   200 { ok: true }                    start and replay, audio and video; a duplicate delivery (same identity, nothing
//                                       stored), including the same event stored by another request just before the
//                                       insert; a full listen; the campaign tag matched, not matched, inactive, partial;
//                                       the client's own duration ignored; the stored location, traffic class and the
//                                       rules that blank a location part
//
//   sequences                           a whole listen, delivered events, a replay after a complete

const PATH = "/api/music-event";
const RELEASE = "old-news-single";
const RECORDING = "old-news-recording";
const SESSION = "22222222-2222-4222-8222-222222222222";
const PLAY = "33333333-3333-4333-8333-333333333333";

const eid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const start: JsonObject = {
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

const progress = (
	n: number,
	seconds: number,
	over: JsonObject = {},
): JsonObject => ({
	...start,
	eventId: eid(n),
	sequence: n,
	event: "progress",
	accumulatedSeconds: seconds,
	...over,
});

const FINAL: Dump = {
	music: ["music_playback_events"],
	kv: ["RATE_LIMIT"],
};

/** A stored event of the playthrough, ten minutes before the frozen clock unless given. */
const stored = (n: number, seconds: number, over: SeedRow = {}): SeedRow => ({
	id: eid(n),
	release_id: RELEASE,
	recording_id: RECORDING,
	session_id: SESSION,
	playthrough_id: PLAY,
	sequence: n,
	medium: "audio",
	event: n === 1 ? "start" : "progress",
	accumulated_seconds: seconds,
	media_duration_seconds: 160,
	traffic_class: "human",
	occurred_at: "2026-11-13T11:50:00.000Z",
	...over,
});

const earlier = (...events: SeedRow[]) => ({
	music: { seed: { music_playback_events: events } },
});

const send = (body: JsonValue | undefined, over: Partial<Step> = {}): Step =>
	visit(PATH, body, over);

const single = (
	name: string,
	body: JsonValue | undefined,
	extra: Partial<Case> = {},
	over: Partial<Step> = {},
): Case => ({ name, steps: [send(body, over)], final: FINAL, ...extra });

const withBody = (
	name: string,
	change: JsonObject,
	extra: Partial<Case> = {},
) => single(name, { ...start, ...change }, extra);

const raw = (
	name: string,
	body: string | undefined,
	headers: { [name: string]: string },
	extra: Partial<Case> = {},
): Case => ({
	name,
	steps: [rawVisit(PATH, body, headers)],
	final: FINAL,
	...extra,
});

const jsonHeaders = { origin: ORIGIN, "content-type": "application/json" };
const ALL = `rl:music-event-all:${IP}`;
const EACH = `rl:music-event:${RELEASE}:${RECORDING}:audio:start:${IP}`;

const campaign = (status: string) => ({
	owner_campaigns: [
		{
			id: "spring-launch",
			subject_type: "release",
			subject_id: RELEASE,
			name: "Spring launch",
			primary_goal: "listens",
			starts_at: "2026-11-01T00:00:00.000Z",
			status,
			created_at: "2026-11-01T00:00:00.000Z",
			updated_at: "2026-11-01T00:00:00.000Z",
		},
	],
	owner_campaign_tags: [
		{ campaign_id: "spring-launch", channel: "instagram", creative: "reel-1" },
	],
});

const tagged = {
	campaignId: "spring-launch",
	channel: "instagram",
	creative: "reel-1",
};

const cases: Case[] = [
	// musicRequest
	raw("no Origin header", JSON.stringify(start), {
		"content-type": "application/json",
	}),
	raw("another site's Origin", JSON.stringify(start), {
		...jsonHeaders,
		origin: "https://example.com",
	}),
	raw("the www host as Origin", JSON.stringify(start), {
		...jsonHeaders,
		origin: "https://www.thesuperhuman.us",
	}),
	raw("an http Origin", JSON.stringify(start), {
		...jsonHeaders,
		origin: "http://thesuperhuman.us",
	}),
	raw("a text/plain body", JSON.stringify(start), {
		origin: ORIGIN,
		"content-type": "text/plain",
	}),
	raw("no content type", JSON.stringify(start), { origin: ORIGIN }),
	raw("a form content type", "a=1", {
		origin: ORIGIN,
		"content-type": "application/x-www-form-urlencoded",
	}),
	raw("no body at all", undefined, jsonHeaders),
	raw("an empty body", "", jsonHeaders),
	raw("broken JSON", '{"releaseId":', jsonHeaders),
	single("a body over 8192 bytes", { ...start, padding: "x".repeat(9000) }),

	// the schema
	single("a body that is null", null),
	single("a body that is a list", []),
	single("an empty object", {}),
	withBody("a release id that is not a slug shape", { releaseId: "Old News" }),
	withBody("a recording id over 100 characters", {
		recordingId: "a".repeat(101),
	}),
	withBody("a session id that is not a UUID", { sessionId: "session-1" }),
	withBody("a playthrough id that is not a UUID", { playthroughId: 7 }),
	withBody("an event id that is not a UUID", { eventId: "x" }),
	withBody("sequence 0", { sequence: 0 }),
	withBody("sequence 10001", { sequence: 10_001 }),
	withBody("sequence as a fraction", { sequence: 1.5 }),
	withBody("sequence as text", { sequence: "1" }),
	withBody("a medium that is not audio or video", { medium: "text" }),
	withBody("an event that is not one of five", { event: "pause" }),
	withBody("negative accumulated seconds", { accumulatedSeconds: -1 }),
	withBody("fractional accumulated seconds", { accumulatedSeconds: 0.5 }),
	withBody("accumulated seconds over a day", { accumulatedSeconds: 86_401 }),
	withBody("a duration over a day", { mediaDurationSeconds: 86_401 }),
	withBody("no duration", { mediaDurationSeconds: undefined }),
	withBody("a campaign id that is not a slug shape", {
		campaignId: "Spring Launch",
	}),
	withBody("a channel as a number", { channel: 3 }),

	// the switch
	withBody(
		"events switched off",
		{},
		{ env: { MUSIC_EVENTS_ENABLED: "false" } },
	),
	single(
		"events switched off and a bad body is still refused",
		{},
		{ env: { MUSIC_EVENTS_ENABLED: "false" } },
	),
	withBody(
		"events switched off and an unknown release is not looked up",
		{ releaseId: "no-such-release" },
		{ env: { MUSIC_EVENTS_ENABLED: "false" } },
	),
	withBody(
		"the switch set to 0 keeps recording",
		{},
		{ env: { MUSIC_EVENTS_ENABLED: "0" } },
	),
	withBody(
		"the switch set to an empty string keeps recording",
		{},
		{ env: { MUSIC_EVENTS_ENABLED: "" } },
	),
	withBody(
		"the switch absent keeps recording",
		{},
		{ omit: ["MUSIC_EVENTS_ENABLED"] },
	),

	// the catalog
	withBody("an unknown release", { releaseId: "no-such-release" }),
	withBody("an unknown recording", { recordingId: "no-such-recording" }),
	withBody("the release id sent as the recording", { recordingId: RELEASE }),
	withBody("the recording id sent as the release", { releaseId: RECORDING }),
	withBody("the release's slug instead of its id", { releaseId: "old-news" }),
	withBody("a video event for a recording that has a video", {
		medium: "video",
	}),

	// bindings
	withBody("no MUSIC_DB", {}, { music: { missing: true } }),
	withBody(
		"no RATE_LIMIT namespace",
		{},
		{ kv: { RATE_LIMIT: { missing: true } } },
	),
	withBody(
		"the rate limit read throws",
		{},
		{ kv: { RATE_LIMIT: { fails: ["get"] } } },
	),
	withBody(
		"the rate limit write throws",
		{},
		{ kv: { RATE_LIMIT: { fails: ["put"] } } },
	),

	// the rate limits
	withBody(
		"the all-events counter is full",
		{},
		{ kv: { RATE_LIMIT: { seed: { [ALL]: "240" } } } },
	),
	withBody(
		"the all-events counter is one below",
		{},
		{ kv: { RATE_LIMIT: { seed: { [ALL]: "239" } } } },
	),
	withBody(
		"the per-event counter is full",
		{},
		{ kv: { RATE_LIMIT: { seed: { [EACH]: "60" } } } },
	),
	withBody(
		"the per-event counter is one below",
		{},
		{ kv: { RATE_LIMIT: { seed: { [EACH]: "59" } } } },
	),
	withBody(
		"a full per-event counter for another event does not block",
		{},
		{
			kv: {
				RATE_LIMIT: {
					seed: {
						[`rl:music-event:${RELEASE}:${RECORDING}:audio:progress:${IP}`]:
							"60",
					},
				},
			},
		},
	),
	withBody(
		"an all-events count that is not a number",
		{},
		{ kv: { RATE_LIMIT: { seed: { [ALL]: "many" } } } },
	),
	withBody(
		"a per-event count that is not a number",
		{},
		{ kv: { RATE_LIMIT: { seed: { [EACH]: "NaN" } } } },
	),
	withBody(
		"a full counter that has expired by the request",
		{},
		{
			kv: {
				RATE_LIMIT: { seed: { [ALL]: { value: "240", expirationTtl: 30 } } },
			},
			steps: [send(start, { advanceMs: 31_000 })],
		},
	),
	{
		name: "sixty-one starts of one kind from one address",
		steps: Array.from({ length: 61 }, (_, index) =>
			send(
				{
					...start,
					eventId: eid(index + 1),
					sessionId: `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`,
				},
				{ advanceMs: 1000 },
			),
		),
		final: { kv: ["RATE_LIMIT"] },
	},

	// database errors
	withBody(
		"the duplicate lookup throws",
		{},
		{
			failures: [
				{ on: /SELECT session_id,playthrough_id,sequence/, message: "d1 down" },
			],
		},
	),
	withBody(
		"the last-event lookup throws",
		{},
		{
			failures: [
				{ on: /SELECT sequence,accumulated_seconds/, message: "d1 down" },
			],
		},
	),
	withBody(
		"the insert throws",
		{},
		{
			failures: [
				{ on: /INSERT INTO music_playback_events/, message: "d1 down" },
			],
		},
	),
	withBody("the campaign lookup throws", tagged, {
		failures: [{ on: /FROM owner_campaign_tags/, message: "d1 down" }],
	}),
	withBody(
		"another request stores the same event id just before the insert",
		{},
		{
			interleave: [
				{
					on: /INSERT INTO music_playback_events/,
					label: "the same event arrived from another connection",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO music_playback_events (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,traffic_class,occurred_at) VALUES ('${eid(1)}','${RELEASE}','${RECORDING}','${SESSION}','${PLAY}',1,'audio','start',0,160,'human','2026-11-13T11:59:59.000Z')`,
						),
				},
			],
		},
	),
	withBody(
		"another request takes the same place in the playthrough just before the insert",
		{},
		{
			interleave: [
				{
					on: /INSERT INTO music_playback_events/,
					label: "a different event arrived from another connection at sequence 1",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO music_playback_events (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,media_duration_seconds,traffic_class,occurred_at) VALUES ('${eid(2)}','${RELEASE}','${RECORDING}','${SESSION}','${PLAY}',1,'audio','start',0,160,'human','2026-11-13T11:59:59.000Z')`,
						),
				},
			],
		},
	),

	// stored starts
	single("a start", start),
	withBody("a start for video", { medium: "video" }),
	withBody("a replay as the first event", { event: "replay" }),
	withBody("the client's own duration is ignored", { mediaDurationSeconds: 1 }),
	withBody(
		"a start from a visitor with no address header",
		{},
		{
			steps: [send(start, { as: asVisitor() })],
		},
	),

	// traffic class and location
	single(
		"a crawler user agent",
		start,
		{},
		{ headers: { "user-agent": "Googlebot/2.1" } },
	),
	single(
		"a link preview user agent",
		start,
		{},
		{ headers: { "user-agent": "Slackbot-LinkExpanding (preview)" } },
	),
	single(
		"a browser user agent",
		start,
		{},
		{
			headers: {
				"user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0",
			},
		},
	),
	single(
		"a verified bot from Cloudflare",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { botManagement: { verifiedBot: true } } }) },
	),
	single(
		"a bot score that is not verified",
		start,
		{},
		{
			as: asVisitor({ ip: IP, cf: { botManagement: { verifiedBot: false } } }),
		},
	),
	single(
		"a location from Cloudflare",
		start,
		{},
		{
			as: asVisitor({
				ip: IP,
				cf: { country: "US", region: "Virginia", city: "Roanoke" },
			}),
		},
	),
	single(
		"a unicode city",
		start,
		{},
		{
			as: asVisitor({
				ip: IP,
				cf: { country: "JP", region: "Tōkyō", city: "東京" },
			}),
		},
	),
	single(
		"a city of exactly 80 characters",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { city: "c".repeat(80) } }) },
	),
	single(
		"a city of 81 characters is blanked",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { city: "c".repeat(81) } }) },
	),
	single(
		"a region with a control character is blanked",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { region: "Vir\u0007ginia" } }) },
	),
	single(
		"a country that is a number is blanked",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { country: 840 } }) },
	),
	single(
		"a location with only a country",
		start,
		{},
		{ as: asVisitor({ ip: IP, cf: { country: "DE" } }) },
	),

	// the campaign tag
	withBody("a campaign tag that matches an active campaign", tagged, {
		music: { seed: campaign("active") },
	}),
	withBody("a campaign tag for a draft campaign", tagged, {
		music: { seed: campaign("draft") },
	}),
	withBody("a campaign tag for a finished campaign", tagged, {
		music: { seed: campaign("complete") },
	}),
	withBody(
		"a campaign tag whose creative does not match",
		{ ...tagged, creative: "reel-2" },
		{ music: { seed: campaign("active") } },
	),
	withBody(
		"a campaign tag with no creative",
		{ campaignId: "spring-launch", channel: "instagram" },
		{ music: { seed: campaign("active") } },
	),
	withBody(
		"a campaign tag with only a campaign id",
		{ campaignId: "spring-launch" },
		{ music: { seed: campaign("active") } },
	),
	withBody("a campaign tag with no campaigns at all", tagged),

	// sequence evidence: starts and replays
	withBody("a start that is not sequence 1", { sequence: 2 }),
	withBody("a start that is not at zero seconds", { accumulatedSeconds: 5 }),
	withBody(
		"a start when the playthrough already began",
		{ eventId: eid(9) },
		earlier(stored(1, 0)),
	),
	withBody(
		"a replay when the playthrough already began",
		{ event: "replay", eventId: eid(9) },
		earlier(stored(1, 0)),
	),

	// sequence evidence: later events
	single("a progress with no start", progress(2, 5)),
	single(
		"a progress that skips a sequence number",
		progress(3, 5),
		earlier(stored(1, 0)),
	),
	single(
		"a progress that repeats a sequence number",
		progress(1, 5, { eventId: eid(9) }),
		earlier(stored(1, 0)),
	),
	single(
		"a progress whose seconds go backwards",
		progress(3, 3),
		earlier(stored(1, 0), stored(2, 8)),
	),
	single(
		"a progress with the same seconds is stored",
		progress(3, 8),
		earlier(stored(1, 0), stored(2, 8)),
	),
	single(
		"a progress of exactly 12 seconds",
		progress(2, 12),
		earlier(stored(1, 0)),
	),
	single("a progress of 13 seconds", progress(2, 13), earlier(stored(1, 0))),
	single(
		"a progress more than two seconds ahead of the clock",
		progress(2, 12),
		earlier(stored(1, 0, { occurred_at: "2026-11-13T11:59:51.000Z" })),
	),
	single(
		"a progress exactly two seconds ahead of the clock",
		progress(2, 12),
		earlier(stored(1, 0, { occurred_at: "2026-11-13T11:59:50.000Z" })),
	),
	single(
		"a progress that matches the clock",
		progress(2, 10),
		earlier(stored(1, 0, { occurred_at: "2026-11-13T11:59:50.000Z" })),
	),
	single(
		"a progress when the first event's time is unreadable",
		progress(2, 5),
		earlier(stored(1, 0, { occurred_at: "not a time" })),
	),
	single(
		"a progress when the playthrough has no sequence 1 row skips the clock check",
		progress(3, 5),
		earlier(stored(2, 0)),
	),
	single(
		"a listen30 under thirty seconds",
		progress(3, 20, { event: "listen30" }),
		earlier(stored(1, 0), stored(2, 20)),
	),
	single(
		"a listen30 at thirty seconds",
		progress(4, 30, { event: "listen30" }),
		earlier(stored(1, 0), stored(2, 20), stored(3, 28)),
	),
	single(
		"a complete under ninety percent",
		progress(4, 143, { event: "complete" }),
		earlier(stored(1, 0), stored(2, 135), stored(3, 140)),
	),
	single(
		"a complete at exactly ninety percent",
		progress(4, 144, { event: "complete" }),
		earlier(stored(1, 0), stored(2, 135), stored(3, 140)),
	),
	single(
		"a complete of the full length",
		progress(4, 150, { event: "complete" }),
		earlier(stored(1, 0), stored(2, 140), stored(3, 145)),
	),

	// duplicates
	single("the same event delivered again", start, earlier(stored(1, 0))),
	single(
		"an event id reused by another session",
		{ ...start, sessionId: "44444444-4444-4444-8444-444444444444" },
		earlier(stored(1, 0)),
	),
	single(
		"an event id reused by another playthrough",
		{ ...start, playthroughId: "55555555-5555-4555-8555-555555555555" },
		earlier(stored(1, 0)),
	),
	single(
		"an event id reused with another sequence",
		progress(1, 0, { eventId: eid(1), sequence: 2, event: "progress" }),
		earlier(stored(1, 0)),
	),

	// sequences
	{
		name: "a whole listen, one event at a time",
		steps: [
			send(start),
			send(progress(2, 10), { advanceMs: 10_000 }),
			send(progress(3, 20), { advanceMs: 10_000 }),
			send(progress(4, 30, { event: "listen30" }), { advanceMs: 10_000 }),
			send(progress(5, 42), { advanceMs: 12_000 }),
		],
		final: FINAL,
	},
	{
		name: "a listen that reports faster than the clock",
		steps: [send(start), send(progress(2, 10), { advanceMs: 1000 })],
		final: FINAL,
	},
	{
		name: "the same events delivered twice",
		steps: [
			send(start),
			send(progress(2, 4), { advanceMs: 5000 }),
			send(start),
			send(progress(2, 4)),
		],
		final: FINAL,
	},
	{
		name: "a replay after a complete is refused as a late start",
		steps: [send({ ...start, event: "replay", eventId: eid(9) })],
		...earlier(stored(1, 0), stored(2, 150, { event: "complete" })),
		final: FINAL,
	},
	{
		name: "two playthroughs interleaved",
		steps: [
			send(start),
			send({
				...start,
				playthroughId: "55555555-5555-4555-8555-555555555555",
				eventId: eid(11),
			}),
			send(progress(2, 5), { advanceMs: 6000 }),
			send({
				...progress(2, 5, { eventId: eid(12) }),
				playthroughId: "55555555-5555-4555-8555-555555555555",
			}),
		],
		final: FINAL,
	},
];

defineCorpus("music-event", POST, cases);
