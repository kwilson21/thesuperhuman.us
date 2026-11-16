// The playback rule: may this event be stored, and what row is stored. A player on a release page reports start,
// progress, listen30, complete and replay events; each carries its place in the playthrough (`sequence`) and the seconds
// of listening so far. The rule judges the event against two facts read before it: the stored event with the same id, if
// any, and the playthrough's last stored event (with the time its first event was stored, the server's clock for the
// playthrough). It reads no clock and no database. The store's guards are the two unique constraints of
// `music_playback_events` (the event id, and the place in the playthrough), which stop two requests taking the same
// place after this rule decided; the flow asks the rule again on fresh facts when one fires (src/server/flows/music-event.ts).
import * as Data from "effect/Data";
import type { EventInput } from "../music-input";
import { rule, term, unless } from "../terms";
import type { CampaignTag } from "./campaign-tag";
import type { PlaybackMetadata } from "./visitor";

/** The step one report may add: a progress is sent every ten seconds, so more than this skipped required evidence. */
export const MAX_ADVANCE_SECONDS = 12;

/** The client's clock may run this far ahead of the server's before the report is refused. */
export const CLOCK_SLACK_SECONDS = 2;

/** A stored event, as far as the rule needs to know it. */
export type StoredPlayback = {
	readonly sessionId: string;
	readonly playthroughId: string;
	readonly sequence: number;
};

/** The playthrough's last stored event, and when its first event (sequence 1) was stored, or null when none is. */
export type LastPlayback = {
	readonly sequence: number;
	readonly accumulatedSeconds: number;
	readonly startedAt: string | null;
};

export type PlaybackRequest = {
	readonly event: EventInput;
	/** Who played (src/server/rules/visitor.ts). */
	readonly visitor: PlaybackMetadata;
	/** The campaign the playback counts for, or null (src/server/rules/campaign-tag.ts). What the client sent is never stored. */
	readonly tag: CampaignTag | null;
	readonly now: Date;
};

export type PlaybackFacts = {
	readonly duplicate: StoredPlayback | null;
	readonly last: LastPlayback | null;
};

/** The row to store: the event, the visitor, the campaign tag the owner defined (or none), and when. */
export type PlaybackWrite = PlaybackMetadata & {
	readonly eventId: string;
	readonly releaseId: string;
	readonly recordingId: string;
	readonly sessionId: string;
	readonly playthroughId: string;
	readonly sequence: number;
	readonly medium: EventInput["medium"];
	readonly event: EventInput["event"];
	readonly accumulatedSeconds: number;
	readonly mediaDurationSeconds: number;
	readonly campaignId: string | null;
	readonly channel: string | null;
	readonly creative: string | null;
	readonly occurredAt: string;
};

export class PlaybackIdReused extends Data.TaggedError("PlaybackIdReused") {
	readonly say = "Playback event identity was reused.";
}

export class PlaybackOutOfSequence extends Data.TaggedError(
	"PlaybackOutOfSequence",
) {
	readonly say = "Playback event sequence is invalid.";
}

export class ListenNotEarned extends Data.TaggedError("ListenNotEarned") {
	readonly say = "Reported listen is not earned.";
}

export class CompletionNotEarned extends Data.TaggedError(
	"CompletionNotEarned",
) {
	readonly say = "Reported completion is not earned.";
}

export class PlaybackHasNoStart extends Data.TaggedError("PlaybackHasNoStart") {
	readonly say = "Playback has no recorded start.";
}

export class ProgressSkipped extends Data.TaggedError("ProgressSkipped") {
	readonly say = "Reported playback skipped required progress evidence.";
}

export class FasterThanServerTime extends Data.TaggedError(
	"FasterThanServerTime",
) {
	readonly say = "Reported playback advanced faster than server time.";
}

type Given = {
	readonly event: EventInput;
	readonly request: PlaybackRequest;
	readonly duplicate: StoredPlayback | null;
	readonly last: LastPlayback | null;
	/** Seconds since the playthrough's first event was stored, or NaN when that time cannot be read. */
	readonly elapsed: number;
};

/** True when the stored event is this very event again (the player's retry), not another that reused the id. */
const sameEvent = (given: Given) =>
	given.duplicate !== null &&
	given.duplicate.sessionId === given.event.sessionId &&
	given.duplicate.playthroughId === given.event.playthroughId &&
	given.duplicate.sequence === given.event.sequence;

const startsPlaythrough = (event: EventInput) =>
	event.event === "start" || event.event === "replay";

export const judgePlayback = rule({
	name: "Store a playback event",
	given: (request: PlaybackRequest, facts: PlaybackFacts): Given => ({
		event: request.event,
		request,
		duplicate: facts.duplicate,
		last: facts.last,
		elapsed:
			facts.last?.startedAt == null
				? Number.NaN
				: Math.max(
						0,
						(request.now.getTime() - new Date(facts.last.startedAt).getTime()) /
							1000,
					),
	}),
	nothingToDoIf: term<Given>(
		"the same event was already stored with the same place in the playthrough",
		sameEvent,
	),
	refusals: [
		unless(
			term<Given>(
				"no other event has stored this event's id",
				(g) => g.duplicate === null,
			),
			() => new PlaybackIdReused(),
		),
		unless(
			term<Given>(
				"it is the playthrough's first event at zero seconds, or the next in sequence with no seconds lost",
				(g) =>
					startsPlaythrough(g.event)
						? g.last === null &&
							g.event.sequence === 1 &&
							g.event.accumulatedSeconds === 0
						: g.last !== null &&
							g.event.sequence === g.last.sequence + 1 &&
							g.event.accumulatedSeconds >= g.last.accumulatedSeconds,
			),
			() => new PlaybackOutOfSequence(),
		),
		unless(
			term<Given>(
				"a listen30 has at least 30 seconds",
				(g) => g.event.event !== "listen30" || g.event.accumulatedSeconds >= 30,
			),
			() => new ListenNotEarned(),
		),
		unless(
			term<Given>(
				"a complete follows a known length and at least 90% of it",
				(g) =>
					g.event.event !== "complete" ||
					(g.event.mediaDurationSeconds > 0 &&
						g.event.accumulatedSeconds * 10 >=
							g.event.mediaDurationSeconds * 9),
			),
			() => new CompletionNotEarned(),
		),
		unless(
			term<Given>(
				"the playthrough's first event is stored, to time the report against",
				(g) => g.last === null || g.last.startedAt !== null,
			),
			() => new PlaybackHasNoStart(),
		),
		unless(
			term<Given>(
				`the report adds at most ${MAX_ADVANCE_SECONDS} seconds to the last`,
				(g) =>
					g.last === null ||
					g.event.accumulatedSeconds - g.last.accumulatedSeconds <=
						MAX_ADVANCE_SECONDS,
			),
			() => new ProgressSkipped(),
		),
		unless(
			term<Given>(
				`the reported seconds are at most ${CLOCK_SLACK_SECONDS} ahead of the server's time since the first event`,
				(g) =>
					g.last === null ||
					(Number.isFinite(g.elapsed) &&
						g.event.accumulatedSeconds <= g.elapsed + CLOCK_SLACK_SECONDS),
			),
			() => new FasterThanServerTime(),
		),
	],
	writes: (g): PlaybackWrite => ({
		eventId: g.event.eventId,
		releaseId: g.event.releaseId,
		recordingId: g.event.recordingId,
		sessionId: g.event.sessionId,
		playthroughId: g.event.playthroughId,
		sequence: g.event.sequence,
		medium: g.event.medium,
		event: g.event.event,
		accumulatedSeconds: g.event.accumulatedSeconds,
		mediaDurationSeconds: g.event.mediaDurationSeconds,
		campaignId: g.request.tag?.campaignId ?? null,
		channel: g.request.tag?.channel ?? null,
		creative: g.request.tag?.creative ?? null,
		...g.request.visitor,
		occurredAt: g.request.now.toISOString(),
	}),
	writesText: "the event, with who played it and when",
});
