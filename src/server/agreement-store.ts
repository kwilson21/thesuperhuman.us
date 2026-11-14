// The store of the archive link and the signed-copy download. Every statement is a plain read, a write guarded by a key
// or a constraint, or a compare-and-set (the cooldown's conditional upsert). None decides an outcome: the decisions are in
// src/server/rules. A failed statement is a defect (`orDie`): the route answers its fixed 500 and logs it through
// logUnexpected. The one guard that can fail a save is the link batch's, and `guardedSave` turns only that into
// `ChangedSinceRead`.
import * as Effect from "effect/Effect";
import { agreementEvent } from "../lib/agreement-events";
import { agreementSession } from "../lib/agreement-access";
import type { AgreementSession } from "../lib/agreement-access";
import type { AgreementArtifact } from "../lib/agreement-artifacts";
import {
	clientSoftwareProjectsForSession,
	hashValue,
} from "../lib/audio-client-access";
import type { DownloadAgreement } from "./rules/agreement-download";
import { guardedSave, raisedByJsonGuard } from "./guarded-save";
import type { ChangedSinceRead } from "./guarded-save";

/** Runs one D1 call; a rejection is a defect, which the route logs and answers 500. */
const dbCall = <A>(call: () => Promise<A>): Effect.Effect<A> =>
	Effect.tryPromise({ try: call, catch: (cause) => cause }).pipe(Effect.orDie);

/**
 * Compare-and-set: the cooldown row for `key` is written when it is absent or older than `since`. Answers whether it was
 * written (the instant is the caller's).
 */
export const takeCooldown = (
	db: D1Database,
	key: string,
	at: string,
	since: string,
): Effect.Effect<boolean> =>
	dbCall(() =>
		db
			.prepare(`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,uses=1
      WHERE window_start<=? RETURNING key`)
			.bind(key, at, since)
			.first(),
	).pipe(Effect.map((row) => row !== null));

/** Plain read: whether the address has a client with an executed agreement. */
export const hasExecutedAgreement = (
	db: D1Database,
	email: string,
): Effect.Effect<boolean> =>
	dbCall(() =>
		db
			.prepare(
				"SELECT 1 FROM software_agreement_clients c JOIN software_agreements a ON a.client_id=c.id WHERE c.recipient_email=? AND a.status='executed'",
			)
			.bind(email)
			.first(),
	).pipe(Effect.map((row) => row !== null));

/**
 * Stores the archive link: one batch, whose first statement is a guard that the address had no link issued in the last
 * 30 seconds. A lost guard fails with `ChangedSinceRead`; any other batch failure is a defect.
 */
export const storeArchiveLink = (input: {
	readonly db: D1Database;
	readonly id: string;
	readonly hash: string;
	readonly email: string;
	readonly at: string;
	readonly actorHash: string;
	readonly expiresAt: string;
	readonly since: string;
}): Effect.Effect<void, ChangedSinceRead> => {
	const { db } = input;

	return guardedSave(
		() =>
			db.batch([
				db
					.prepare(
						`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another link','$') END`,
					)
					.bind("archive", input.email, null, input.since),
				agreementEvent(
					db,
					"link-issued",
					input.actorHash,
					input.at,
					null,
					null,
				),
				db
					.prepare(
						"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
					)
					.bind(
						input.id,
						"archive",
						null,
						null,
						input.email,
						input.hash,
						input.at,
						input.expiresAt,
					),
			]),
		raisedByJsonGuard,
	).pipe(Effect.asVoid);
};

/** Plain read: the typed name of the address's most recent executed signature, for the greeting. */
export const signerName = (
	db: D1Database,
	email: string,
): Effect.Effect<string | null> =>
	dbCall(() =>
		db
			.prepare(
				"SELECT sig.typed_name AS name FROM software_agreement_signatures sig JOIN software_agreements a ON a.id=sig.agreement_id JOIN software_agreement_clients c ON c.id=a.client_id WHERE c.recipient_email=? AND sig.party='client' AND a.status='executed' ORDER BY sig.signed_at DESC LIMIT 1",
			)
			.bind(email)
			.first<{ name: string }>(),
	).pipe(Effect.map((row) => row?.name ?? null));

/** Marks one link used. */
export const markLinkUsed = (
	db: D1Database,
	id: string,
	at: string,
): Effect.Effect<void> =>
	dbCall(() =>
		db
			.prepare("UPDATE software_agreement_links SET used_at=? WHERE id=?")
			.bind(at, id)
			.run(),
	).pipe(Effect.asVoid);

/** Consumes the older unused archive links of the address, once a link has been sent for it. */
export const consumeOlderArchiveLinks = (
	db: D1Database,
	email: string,
	id: string,
	at: string,
): Effect.Effect<void> =>
	dbCall(() =>
		db
			.prepare(
				"UPDATE software_agreement_links SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL AND id<>? AND issued_at<=?",
			)
			.bind(at, "archive", email, null, id, at)
			.run(),
	).pipe(Effect.asVoid);

/** A signing or archive session of a visitor, read from the cookie of `purpose`, or null. */
export const sessionOf = (
	db: D1Database,
	request: Request,
	purpose: "agreement" | "archive",
): Effect.Effect<AgreementSession | null> =>
	dbCall(() => agreementSession(db, request, purpose));

/** Plain read: the email of a studio session that has not expired or been revoked, or null. */
export const studioEmail = (
	db: D1Database,
	token: string,
	now: Date,
): Effect.Effect<string | null> =>
	dbCall(async () =>
		db
			.prepare(
				"SELECT email FROM audio_client_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL",
			)
			.bind(await hashValue(token), now.toISOString())
			.first<{ email: string }>(),
	).pipe(Effect.map((row) => row?.email ?? null));

/** The studio session's projects, as the studio area lists them (empty or null when the session is not valid). */
export const studioProjects = (
	db: D1Database,
	token: string,
): Effect.Effect<readonly { readonly request_id: string }[] | null> =>
	dbCall(() => clientSoftwareProjectsForSession(db, token));

/** Plain read: the executed, not closed agreement with this id, or null (an unknown id, an agreement not executed, or closed). */
export const executedAgreement = (
	db: D1Database,
	id: string,
): Effect.Effect<DownloadAgreement | null> =>
	dbCall(() =>
		db
			.prepare(
				"SELECT a.id,a.offer_id,a.request_id,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=? AND a.status='executed' AND a.archive_closed_at IS NULL",
			)
			.bind(id)
			.first<DownloadAgreement>(),
	).pipe(Effect.map((row) => row ?? null));

/** Plain read: whether the offer reuses this agreement as its master agreement. A null offer reuses nothing. */
export const offerReusesAgreement = (
	db: D1Database,
	offerId: string | null,
	id: string,
): Effect.Effect<boolean> =>
	dbCall(() =>
		db
			.prepare("SELECT 1 FROM software_offers WHERE id=? AND reused_msa_id=?")
			.bind(offerId, id)
			.first(),
	).pipe(Effect.map((row) => row !== null));

/** Plain read: the agreement a studio project names, or null. A null request matches nothing. */
export const projectAgreementId = (
	db: D1Database,
	requestId: string | null,
): Effect.Effect<string | null> =>
	dbCall(() =>
		db
			.prepare("SELECT agreement_id FROM software_projects WHERE request_id=?")
			.bind(requestId)
			.first<{ agreement_id: string }>(),
	).pipe(Effect.map((row) => row?.agreement_id ?? null));

/** Plain read: the master agreement an agreement names, or null. */
export const linkedMsaId = (
	db: D1Database,
	agreementId: string | null,
): Effect.Effect<string | null> =>
	dbCall(() =>
		db
			.prepare("SELECT msa_id FROM software_agreements WHERE id=?")
			.bind(agreementId)
			.first<{ msa_id: string }>(),
	).pipe(Effect.map((row) => row?.msa_id ?? null));

/** Plain read: the ready signed copy of an agreement, or null. */
export const readySignedCopy = (
	db: D1Database,
	id: string,
): Effect.Effect<AgreementArtifact | null> =>
	dbCall(() =>
		db
			.prepare(
				"SELECT * FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'",
			)
			.bind(id)
			.first<AgreementArtifact>(),
	).pipe(Effect.map((row) => row ?? null));

/** Plain read: the attachment of a signing session's offer, when the offer's details pin it (see the attachment rule). */
export const pinnedAttachment = (
	db: D1Database,
	attachmentId: string,
	offerId: string | null,
): Effect.Effect<{
	readonly object_key: string;
	readonly sha256: string;
} | null> =>
	dbCall(() =>
		db
			.prepare(
				`SELECT a.object_key,a.sha256 FROM software_agreement_attachments a JOIN software_offers o ON o.request_id=a.request_id WHERE a.id=? AND o.id=? AND EXISTS(SELECT 1 FROM json_each(o.agreement_details_json,'$.attachments') WHERE json_extract(value,'$.key')=a.object_key AND json_extract(value,'$.sha256')=a.sha256)`,
			)
			.bind(attachmentId, offerId)
			.first<{ object_key: string; sha256: string }>(),
	).pipe(Effect.map((row) => row ?? null));
