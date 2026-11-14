// What the music routes read from and write to MUSIC_DB (the MusicDb service), one function each. A read asks for
// stored facts and decides nothing; a write stores the values a rule computed. Each statement is plain: the only SQL
// that can refuse is a unique constraint of the table, which `insertPlayback` turns into ChangedSinceRead so the flow
// asks the rule again on fresh facts. Any other database failure is a MusicStoreFailed, which a route answers with its
// fixed sentence and never with the failure's own text (the error carries none).
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChangedSinceRead, isUniqueViolation } from "./guarded-save";
import type { InterestWrite } from "./rules/music-interest";
import type {
	CampaignAttribution,
	StoredCampaignTag,
} from "./rules/campaign-tag";
import type {
	LastPlayback,
	PlaybackWrite,
	StoredPlayback,
} from "./rules/playback";
import { MusicDb } from "./services";

/** The music database failed, and nothing says it is only unavailable: an outage, a bad statement, a failed batch. */
export class MusicStoreFailed extends Data.TaggedError("MusicStoreFailed") {}

/** Runs one database call; a rejection is a MusicStoreFailed. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: () => new MusicStoreFailed(),
		});
	});

/** What is stored about an event and its playthrough, read together. */
export type PlaybackFacts = {
	/** The stored event with this id, or null. */
	readonly duplicate: StoredPlayback | null;
	/** The playthrough's last stored event, with when its first event was stored, or null when it has none. */
	readonly last: LastPlayback | null;
};

type PlaybackRow = {
	session_id: string;
	playthrough_id: string;
	sequence: number;
	accumulated_seconds: number;
	event: string;
	occurred_at: string;
	started_at: string | null;
};

/**
 * Reads the stored event with this id and the playthrough's last event in ONE batch (one transaction, one snapshot), so
 * another request cannot store this very event between the two reads: read apart, such an event would be absent from
 * the first and make the second show its place taken, and the rule would refuse a duplicate as out of sequence before
 * any insert. Both are read even when the id is already stored.
 */
export const readPlaybackFacts = (
	eventId: string,
	sessionId: string,
	playthroughId: string,
) =>
	asked(async (db): Promise<PlaybackFacts> => {
		const [duplicateRead, lastRead] = await db.batch<PlaybackRow>([
			db
				.prepare(
					`SELECT session_id,playthrough_id,sequence FROM music_playback_events WHERE id=?`,
				)
				.bind(eventId),
			db
				.prepare(`SELECT sequence,accumulated_seconds,event,occurred_at,
      (SELECT occurred_at FROM music_playback_events first_event
        WHERE first_event.session_id=? AND first_event.playthrough_id=? AND first_event.sequence=1) AS started_at
    FROM music_playback_events
    WHERE session_id=? AND playthrough_id=? ORDER BY sequence DESC LIMIT 1`)
				.bind(sessionId, playthroughId, sessionId, playthroughId),
		]);

		const duplicate = duplicateRead.results[0];
		const last = lastRead.results[0];

		return {
			duplicate: duplicate
				? {
						sessionId: duplicate.session_id,
						playthroughId: duplicate.playthrough_id,
						sequence: duplicate.sequence,
					}
				: null,
			last: last
				? {
						sequence: last.sequence,
						accumulatedSeconds: last.accumulated_seconds,
						startedAt: last.started_at,
					}
				: null,
		};
	});

/** The combination the owner defined for these three names, with its campaign's status, or null. Callers name all three. */
export const findCampaignTag = (attribution: Required<CampaignAttribution>) =>
	asked(async (db): Promise<StoredCampaignTag | null> => {
		const row = await db
			.prepare(`SELECT t.campaign_id,t.channel,t.creative,c.status
    FROM owner_campaign_tags t JOIN owner_campaigns c ON c.id=t.campaign_id
    WHERE t.campaign_id=? AND t.channel=? AND t.creative=?`)
			.bind(attribution.campaignId, attribution.channel, attribution.creative)
			.first<{
				campaign_id: string;
				channel: string;
				creative: string;
				status: string;
			}>();

		return row === null
			? null
			: {
					campaignId: row.campaign_id,
					channel: row.channel,
					creative: row.creative,
					status: row.status,
				};
	});

/**
 * Stores the event the rule decided. The table's unique constraints (the event id; the session, playthrough and
 * sequence) refuse it when another request stored an event for either first, which is ChangedSinceRead: the facts the
 * rule read have changed. Any other failure is a MusicStoreFailed.
 */
export const insertPlayback = (write: PlaybackWrite) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db
					.prepare(`INSERT INTO music_playback_events
    (id,release_id,recording_id,session_id,playthrough_id,sequence,medium,event,accumulated_seconds,
      media_duration_seconds,campaign_id,channel,creative,traffic_class,country,region,city,occurred_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
					.bind(
						write.eventId,
						write.releaseId,
						write.recordingId,
						write.sessionId,
						write.playthroughId,
						write.sequence,
						write.medium,
						write.event,
						write.accumulatedSeconds,
						write.mediaDurationSeconds,
						write.campaignId,
						write.channel,
						write.creative,
						write.trafficClass,
						write.country,
						write.region,
						write.city,
						write.occurredAt,
					)
					.run(),
			catch: (cause) =>
				isUniqueViolation(cause)
					? new ChangedSinceRead()
					: new MusicStoreFailed(),
		});
	});

/**
 * Stores a listener's interest and the owner's requests it opens, in one batch (all or none). The standing interest is
 * an upsert on the table's primary key (release and email): a second submission replaces the first, which is what the
 * listener means by sending again. `requestIds` has one id per request to open, in order.
 */
export const saveInterest = (
	write: InterestWrite,
	requestIds: readonly string[],
	now: string,
) =>
	asked(async (db) => {
		const statements = [
			db
				.prepare(`INSERT INTO music_interest (release_id,email,interest,merchandise,suggestion,consent_version,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(release_id,email) DO UPDATE SET
    interest=excluded.interest,merchandise=excluded.merchandise,suggestion=excluded.suggestion,
    consent_version=excluded.consent_version,updated_at=excluded.updated_at`)
				.bind(
					write.releaseId,
					write.email,
					write.interest,
					write.merchandiseJson,
					write.suggestion,
					write.consentVersion,
					now,
				),
		];

		write.requests.forEach((request, index) => {
			statements.push(
				db
					.prepare(`INSERT INTO owner_requests
        (id,kind,release_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
        VALUES (?,?,?,'',?,?,?,?, 'new','',?,?)`)
					.bind(
						requestIds[index],
						request.kind,
						write.releaseId,
						write.email,
						write.cityRegion,
						request.summary,
						request.detailsJson,
						now,
						now,
					),
				db
					.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
        VALUES (?,'created','system','',?)`)
					.bind(requestIds[index], now),
			);
		});
		await db.batch(statements);
	});
