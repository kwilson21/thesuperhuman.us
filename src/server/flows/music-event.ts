// The playback event flow: a player reports an event; the visitor's address is counted twice (all events, and this kind of
// event), the campaign tag is looked up if the player named one, and the event is judged against what is stored and
// stored. The sequence is order that matters across requests: the counts come before any read, the campaign lookup is
// a read of its own, and the judge-and-store loop runs again on fresh facts when another request stores an event for the
// same id or the same place in the playthrough between this one's read and its insert (three tries in all, src/server/guarded-save.ts).
// It builds no response text; the route maps each named failure.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { decideAndSave } from "../guarded-save";
import {
	findCampaignTag,
	findPlayback,
	insertPlayback,
	lastPlayback,
} from "../music-store";
import type { EventInput } from "../music-input";
import { tagPlayback } from "../rules/campaign-tag";
import { judgePlayback } from "../rules/playback";
import { type Visitor, classifyVisitor } from "../rules/visitor";
import { countRequest } from "./rate-limit";

/** One address sent too many playback events in the window (either count). */
export class TooManyPlaybacks extends Data.TaggedError("TooManyPlaybacks") {}

/** How many playback events one address may send in a window, of all kinds. */
export const ALL_EVENTS_PER_WINDOW = 240;

/** How many playback events of one kind (release, recording, medium and event) one address may send in a window. */
export const EACH_EVENT_PER_WINDOW = 60;

export type PlaybackReport = {
	/** The event as the player sent it, with the duration of the recording from the catalog in place of the player's own. */
	readonly input: EventInput;
	/** The address Cloudflare saw. */
	readonly ip: string;
	readonly visitor: Visitor;
	/** The time of the request; read once, when the event is judged. */
	readonly now: () => Date;
};

/** A rule that refuses nothing and has something to do always answers a write. */
const always = <W>(answer: Effect.Effect<Option.Option<W>>) =>
	Effect.map(answer, Option.getOrThrow);

export const recordPlayback = (report: PlaybackReport) =>
	Effect.gen(function* () {
		const { input, ip, visitor } = report;

		if (
			!(yield* countRequest(ip, "rl:music-event-all:", ALL_EVENTS_PER_WINDOW))
		)
			return yield* Effect.fail(new TooManyPlaybacks());

		const prefix = `rl:music-event:${input.releaseId}:${input.recordingId}:${input.medium}:${input.event}:`;

		if (!(yield* countRequest(ip, prefix, EACH_EVENT_PER_WINDOW)))
			return yield* Effect.fail(new TooManyPlaybacks());

		const { campaignId, channel, creative } = input;

		// The player names all three or none; the store is asked only when it names all three.
		const stored =
			campaignId && channel && creative
				? yield* findCampaignTag({ campaignId, channel, creative })
				: null;

		const tag = Option.getOrNull(
			yield* tagPlayback.decide({ campaignId, channel, creative }, stored),
		);

		const metadata = yield* always(classifyVisitor.decide(visitor, {}));
		const now = report.now();

		return yield* decideAndSave({
			facts: Effect.gen(function* () {
				const duplicate = yield* findPlayback(input.eventId);

				// A stored event with this id settles the answer without the playthrough's last event.
				const last =
					duplicate === null
						? yield* lastPlayback(input.sessionId, input.playthroughId)
						: null;

				return { duplicate, last };
			}),
			decide: (facts) =>
				judgePlayback.decide(
					{ event: input, visitor: metadata, tag, now },
					facts,
				),
			save: insertPlayback,
		});
	});
