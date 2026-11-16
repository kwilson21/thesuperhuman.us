import { describe, expect, it } from "vitest";
import type { EventInput } from "../../src/server/music-input";
import {
	type LastPlayback,
	type PlaybackFacts,
	type PlaybackRequest,
	judgePlayback,
} from "../../src/server/rules/playback";
import { answerOf, nothingToDo, refuse } from "../helpers/rule-answers";

// The playback rule as stories: what was stored (the same event, the playthrough's last event and when it began), what
// the player reported, and what the rule answered. The clock is an input: events are judged at 12:00:00.

const NOW = new Date("2026-11-13T12:00:00.000Z");
const BEGAN = "2026-11-13T11:59:30.000Z";

const report: EventInput = {
	releaseId: "old-news-single",
	recordingId: "old-news-recording",
	sessionId: "22222222-2222-4222-8222-222222222222",
	playthroughId: "33333333-3333-4333-8333-333333333333",
	eventId: "00000000-0000-4000-8000-000000000002",
	sequence: 2,
	medium: "audio",
	event: "progress",
	accumulatedSeconds: 10,
	mediaDurationSeconds: 160,
	campaignId: undefined,
	channel: undefined,
	creative: undefined,
};

const visitor = {
	trafficClass: "human",
	country: "US",
	region: "",
	city: "",
} as const;

const last = (over: Partial<LastPlayback> = {}): LastPlayback => ({
	sequence: 1,
	accumulatedSeconds: 0,
	startedAt: BEGAN,
	...over,
});

const ask = (
	over: Partial<EventInput> = {},
	facts: Partial<PlaybackFacts> = { last: last() },
	now = NOW,
) => {
	const request: PlaybackRequest = {
		event: { ...report, ...over },
		visitor,
		tag: null,
		now,
	};

	return answerOf(
		judgePlayback.decide(request, { duplicate: null, last: null, ...facts }),
	);
};

const says = new Map([
	["PlaybackIdReused", "Playback event identity was reused."],
	["PlaybackOutOfSequence", "Playback event sequence is invalid."],
	["ListenNotEarned", "Reported listen is not earned."],
	["CompletionNotEarned", "Reported completion is not earned."],
	["PlaybackHasNoStart", "Playback has no recorded start."],
	["ProgressSkipped", "Reported playback skipped required progress evidence."],
	[
		"FasterThanServerTime",
		"Reported playback advanced faster than server time.",
	],
]);

const sentence = (type: string) => refuse(type, says.get(type) ?? "");

describe("the first event of a playthrough", () => {
	const start = { event: "start", sequence: 1, accumulatedSeconds: 0 } as const;

	it("is stored with the visitor, no campaign and the time", () => {
		expect(ask(start, { last: null })).toMatchObject({
			kind: "write",
			save: {
				eventId: report.eventId,
				sequence: 1,
				event: "start",
				trafficClass: "human",
				country: "US",
				campaignId: null,
				channel: null,
				creative: null,
				occurredAt: "2026-11-13T12:00:00.000Z",
			},
		});
	});

	it.each([
		["a start that is not sequence 1", { ...start, sequence: 2 }],
		[
			"a start that is not at zero seconds",
			{ ...start, accumulatedSeconds: 5 },
		],
		[
			"a replay that is not sequence 1",
			{ ...start, event: "replay", sequence: 3 },
		],
	] as const)("%s is out of sequence", (_name, over) => {
		expect(ask(over, { last: null })).toEqual(
			sentence("PlaybackOutOfSequence"),
		);
	});

	it("is out of sequence when the playthrough already began", () => {
		expect(ask(start, { last: last() })).toEqual(
			sentence("PlaybackOutOfSequence"),
		);
	});
});

describe("a later event", () => {
	it("is stored when it is the next in sequence and adds up to twelve seconds", () => {
		expect(ask({ accumulatedSeconds: 12 }, { last: last() }).kind).toBe(
			"write",
		);
	});

	it.each([
		["with no earlier event", { last: null }, {}],
		["that skips a sequence number", { last: last() }, { sequence: 3 }],
		["that repeats a sequence number", { last: last() }, { sequence: 1 }],
		[
			"whose seconds go backwards",
			{ last: last({ accumulatedSeconds: 8 }) },
			{ accumulatedSeconds: 3 },
		],
	] as const)("%s is out of sequence", (_name, facts, over) => {
		expect(ask(over, facts)).toEqual(sentence("PlaybackOutOfSequence"));
	});

	it("is refused when it adds more than twelve seconds", () => {
		expect(ask({ accumulatedSeconds: 13 }, { last: last() })).toEqual(
			sentence("ProgressSkipped"),
		);
	});

	it("is refused when the playthrough has no recorded start to time it against", () => {
		expect(ask({}, { last: last({ startedAt: null }) })).toEqual(
			sentence("PlaybackHasNoStart"),
		);
	});

	it("is refused when the first event's time cannot be read", () => {
		expect(ask({}, { last: last({ startedAt: "not a time" }) })).toEqual(
			sentence("FasterThanServerTime"),
		);
	});

	it.each([
		["exactly two seconds ahead of the server's clock", 20, 32, true],
		["more than two seconds ahead of the server's clock", 21, 33, false],
	] as const)("%s", (_name, before, reported, stored) => {
		// The first event was stored 30 seconds ago, so the server's clock allows 32 seconds of listening.
		const answer = ask(
			{ accumulatedSeconds: reported },
			{ last: last({ sequence: 1, accumulatedSeconds: before }) },
		);

		expect(answer.kind === "write").toBe(stored);
	});
});

describe("a listen or a completion", () => {
	const later = { sequence: 4, event: "listen30" } as const;

	it("a listen30 under thirty seconds is not earned", () => {
		expect(
			ask(
				{ ...later, accumulatedSeconds: 20 },
				{ last: last({ sequence: 3, accumulatedSeconds: 18 }) },
			),
		).toEqual(sentence("ListenNotEarned"));
	});

	it.each([
		["under ninety percent", 143, "CompletionNotEarned"],
		["at exactly ninety percent", 144, "write"],
	] as const)("a complete %s", (_name, seconds, outcome) => {
		const answer = ask(
			{ sequence: 4, event: "complete", accumulatedSeconds: seconds },
			{ last: last({ sequence: 3, accumulatedSeconds: seconds - 5 }) },
			new Date("2026-11-13T12:10:00.000Z"),
		);

		expect(outcome === "write" ? answer.kind : answer).toEqual(
			outcome === "write" ? "write" : sentence(outcome),
		);
	});

	it("a complete with no known length is not earned", () => {
		expect(
			ask(
				{
					sequence: 4,
					event: "complete",
					accumulatedSeconds: 10,
					mediaDurationSeconds: 0,
				},
				{ last: last({ sequence: 3, accumulatedSeconds: 5 }) },
			),
		).toEqual(sentence("CompletionNotEarned"));
	});
});

describe("an event that was stored before", () => {
	const stored = {
		sessionId: report.sessionId,
		playthroughId: report.playthroughId,
		sequence: 2,
	};

	it("has nothing to do when it is the same event again", () => {
		expect(ask({}, { duplicate: stored, last: null })).toEqual(nothingToDo());
	});

	it.each([
		["another session", { sessionId: "44444444-4444-4444-8444-444444444444" }],
		[
			"another playthrough",
			{ playthroughId: "55555555-5555-4555-8555-555555555555" },
		],
		["another sequence", { sequence: 7 }],
	] as const)("is refused when it reuses the id for %s", (_name, over) => {
		expect(ask({}, { duplicate: { ...stored, ...over }, last: null })).toEqual(
			sentence("PlaybackIdReused"),
		);
	});
});

describe("what the player says about a campaign is never stored", () => {
	it("stores the tag the owner defined, not the player's own words", () => {
		const request: PlaybackRequest = {
			event: {
				...report,
				campaignId: "mine",
				channel: "mine",
				creative: "mine",
			},
			visitor,
			tag: { campaignId: "spring", channel: "instagram", creative: "reel" },
			now: NOW,
		};

		expect(
			answerOf(
				judgePlayback.decide(request, { duplicate: null, last: last() }),
			),
		).toMatchObject({
			save: { campaignId: "spring", channel: "instagram", creative: "reel" },
		});
	});
});
