// The store of the agreement routes (the archive link, the signed-copy download and the attachment download). Every
// statement is a plain read of stored columns, a write guarded by a key, or a compare-and-set whose condition the rule
// has already judged from a read (the cooldown row, the link batch's 30-second guard, `used_at IS NULL`). None decides an
// outcome: whether a session counts, an agreement is executed, a link is recent, or an attachment is pinned is decided in
// src/server/rules from the columns read here. Rows are read through Effect Schema readers. A failed statement is an
// `AgreementStoreFailed`, which carries its cause so the route can log it through logUnexpected and answer its fixed 500;
// the one guard that can fail a save is the link batch's (and the cooldown's), which is `ChangedSinceRead`.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { agreementEvent } from "../lib/agreement-events";
import { ChangedSinceRead, raisedByJsonGuard } from "./guarded-save";
import type {
	DownloadAgreement,
	StoredSignedCopy,
	StudioProject,
} from "./rules/agreement-download";
import type {
	AttachmentFacts,
	StoredAttachment,
	StoredOffer,
} from "./rules/agreement-attachment";
import type { StoredSignature } from "./rules/agreement-link";
import type {
	SigningOfferRow,
	StoredAgreementSession,
	StoredStudioSession,
} from "./rules/agreement-session";
import { MusicDb } from "./services";

/** A D1 call failed, or a row was not the shape its table has. The cause is for the route's log. */
export class AgreementStoreFailed extends Data.TaggedError(
	"AgreementStoreFailed",
)<{ readonly failure: unknown }> {}

/** Runs a D1 call with the request's database; a rejection is an `AgreementStoreFailed`. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: (cause) => new AgreementStoreFailed({ failure: cause }),
		});
	});

const text = Schema.String;
const maybeText = Schema.NullOr(Schema.String);

/** Reads rows of one shape; a row that is not that shape is a failure, never a half-read value. */
const rowsOf = <S extends Schema.ConstraintDecoder<unknown>>(
	row: S,
	results: readonly unknown[],
) => {
	const read = Schema.decodeUnknownResult(Schema.Array(row))(results);

	return Result.isSuccess(read)
		? Effect.succeed(read.success)
		: Effect.fail(new AgreementStoreFailed({ failure: read.failure }));
};

/** One statement's rows. */
const readAll = <S extends Schema.ConstraintDecoder<unknown>>(
	row: S,
	statement: (db: D1Database) => D1PreparedStatement,
) =>
	asked(async (db) => (await statement(db).all()).results).pipe(
		Effect.flatMap((results) => rowsOf(row, results)),
	);

const CooldownRow = Schema.Struct({ window_start: text });

const ArchiveLinkRow = Schema.Struct({
	id: text,
	issued_at: text,
	used_at: maybeText,
});

const AgreementStatusRow = Schema.Struct({ status: text });

const SignatureRow = Schema.Struct({
	typed_name: text,
	party: text,
	signed_at: text,
	status: text,
});

const SessionRow = Schema.Struct({
	token_hash: text,
	purpose: Schema.Literals(["agreement", "archive"]),
	offer_id: maybeText,
	link_hash: maybeText,
	recipient_email: text,
	verified_at: text,
	expires_at: text,
	revoked_at: maybeText,
	csrf_nonce: text,
});

const SigningOfferColumns = Schema.Struct({
	offer_status: text,
	link_revoked_at: maybeText,
	request_status: text,
	recipient_email_snapshot: maybeText,
});

const StudioSessionRow = Schema.Struct({
	email: text,
	expires_at: text,
	revoked_at: maybeText,
});

const AgreementRow = Schema.Struct({
	id: text,
	offer_id: maybeText,
	request_id: text,
	recipient_email: text,
	status: text,
	archive_closed_at: maybeText,
});

const ReusedRow = Schema.Struct({ reused_msa_id: maybeText });

const StudioProjectRow = Schema.Struct({
	request_id: text,
	agreement_id: maybeText,
	linked_msa_id: maybeText,
	request_status: text,
	request_email: text,
	revoked_at: maybeText,
	content_deleted_at: maybeText,
});

const CopyRow = Schema.Struct({
	status: text,
	pdf_key: maybeText,
	pdf_sha256: maybeText,
});

const AttachmentColumns = Schema.Struct({
	request_id: text,
	object_key: text,
	sha256: text,
});

const AttachedOfferColumns = Schema.Struct({
	request_id: text,
	agreement_details_json: maybeText,
});

// ---- the archive link ----

const cooldownStatement = (db: D1Database, key: string) =>
	db
		.prepare("SELECT window_start FROM audio_client_allowances WHERE key=?")
		.bind(key);

/** Plain read: when the address's cooldown row was last set, or null when it has none. */
export const readCooldown = (key: string) =>
	readAll(CooldownRow, (db) => cooldownStatement(db, key)).pipe(
		Effect.map((rows) => ({ windowStart: rows[0]?.window_start ?? null })),
	);

/**
 * Compare-and-set: sets the cooldown row to `at` when it is absent or not after `since`. This is the write-time re-check
 * of what the cooldown rule judged from a read; a lost write is `ChangedSinceRead` and the rule judges again.
 */
export const saveCooldown = (key: string, at: string, since: string) =>
	asked((db) =>
		db
			.prepare(`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,uses=1
      WHERE window_start<=? RETURNING key`)
			.bind(key, at, since)
			.all(),
	).pipe(
		Effect.flatMap((answer) =>
			answer.results.length === 0
				? Effect.fail(new ChangedSinceRead())
				: Effect.void,
		),
	);

const agreementStatusStatement = (db: D1Database, email: string) =>
	db
		.prepare(
			"SELECT a.status FROM software_agreement_clients c JOIN software_agreements a ON a.client_id=c.id WHERE c.recipient_email=?",
		)
		.bind(email);

const archiveLinksStatement = (db: D1Database, email: string) =>
	db
		.prepare(
			"SELECT id,issued_at,used_at FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ?",
		)
		.bind("archive", email, null);

/** Plain reads, in one batch (one snapshot): the status of each agreement of the address, and its archive links. */
export const readLinkFacts = (email: string) =>
	asked((db) =>
		db.batch([
			agreementStatusStatement(db, email),
			archiveLinksStatement(db, email),
		]),
	).pipe(
		Effect.flatMap(([statuses, links]) =>
			Effect.all({
				statuses: rowsOf(AgreementStatusRow, statuses?.results ?? []),
				links: rowsOf(ArchiveLinkRow, links?.results ?? []),
			}),
		),
		Effect.map(({ statuses, links }) => ({
			agreementStatuses: statuses.map((row) => row.status),
			links,
		})),
	);

/** Plain read: the address's archive links (read again after the mail, to consume the older ones). */
export const readArchiveLinks = (email: string) =>
	readAll(ArchiveLinkRow, (db) => archiveLinksStatement(db, email));

/**
 * Stores the archive link: one batch, whose first statement is the write-time guard that the address had no link issued in
 * the last 30 seconds (what the rule judged from a read). A lost guard fails with `ChangedSinceRead`; any other batch
 * failure is an `AgreementStoreFailed`.
 */
export const storeArchiveLink = (input: {
	readonly id: string;
	readonly hash: string;
	readonly email: string;
	readonly at: string;
	readonly actorHash: string;
	readonly expiresAt: string;
	readonly since: string;
}) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
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
			catch: (cause) =>
				cause instanceof Error && raisedByJsonGuard(cause)
					? new ChangedSinceRead()
					: new AgreementStoreFailed({ failure: cause }),
		});
	});

/** Plain read: every signature of the address's clients, with the status of its agreement. */
export const readSignatures = (email: string) =>
	readAll(SignatureRow, (db) =>
		db
			.prepare(
				"SELECT sig.typed_name,sig.party,sig.signed_at,a.status FROM software_agreement_signatures sig JOIN software_agreements a ON a.id=sig.agreement_id JOIN software_agreement_clients c ON c.id=a.client_id WHERE c.recipient_email=?",
			)
			.bind(email),
	).pipe(Effect.map((rows): readonly StoredSignature[] => rows));

/** Marks one link used. */
export const markLinkUsed = (id: string, at: string) =>
	asked((db) =>
		db
			.prepare("UPDATE software_agreement_links SET used_at=? WHERE id=?")
			.bind(at, id)
			.run(),
	).pipe(Effect.asVoid);

/**
 * Compare-and-set: consumes the older links the rule chose (`ids`, possibly none), unless something used one since it was
 * read. The ids travel as one JSON list, so any number of them is one statement with one bound value.
 */
export const consumeLinks = (ids: readonly string[], at: string) =>
	asked((db) =>
		db
			.prepare(
				"UPDATE software_agreement_links SET used_at=? WHERE id IN (SELECT value FROM json_each(?)) AND used_at IS NULL",
			)
			.bind(at, JSON.stringify(ids))
			.run(),
	).pipe(Effect.asVoid);

// ---- sessions ----

/** Plain read: the session with this token hash and purpose, whatever its expiry, or null. */
export const readSession = (
	tokenHash: string,
	purpose: "agreement" | "archive",
) =>
	readAll(SessionRow, (db) =>
		db
			.prepare(
				"SELECT token_hash,purpose,offer_id,link_hash,recipient_email,verified_at,expires_at,revoked_at,csrf_nonce FROM software_agreement_sessions WHERE token_hash=? AND purpose=?",
			)
			.bind(tokenHash, purpose),
	).pipe(Effect.map((rows): StoredAgreementSession | null => rows[0] ?? null));

/** Plain read: the offer, its link and its brief that a signing session names. */
export const readSigningOffer = (session: StoredAgreementSession) =>
	readAll(SigningOfferColumns, (db) =>
		db
			.prepare(
				`SELECT o.status AS offer_status,l.revoked_at AS link_revoked_at,r.status AS request_status,o.recipient_email_snapshot FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND l.token_hash=?`,
			)
			.bind(session.offer_id, session.link_hash),
	).pipe(Effect.map((rows): readonly SigningOfferRow[] => rows));

/** Plain read: the studio session with this token hash, whatever its expiry, or null. */
export const readStudioSession = (tokenHash: string) =>
	readAll(StudioSessionRow, (db) =>
		db
			.prepare(
				"SELECT email,expires_at,revoked_at FROM audio_client_sessions WHERE token_hash=?",
			)
			.bind(tokenHash),
	).pipe(Effect.map((rows): StoredStudioSession | null => rows[0] ?? null));

// ---- the signed copy ----

/** What the visitor's sessions let the download read besides the agreement itself. */
export type DownloadReads = {
	readonly id: string;
	/** The offer the signing session names, or null without a signing session. */
	readonly signingOfferId: string | null;
	/** The studio session's email, or null without a studio session. */
	readonly studioEmail: string | null;
};

/**
 * Plain reads for a download decision, in ONE batch (one snapshot): the agreement with this id, whatever its status; the
 * master agreement the signing session's offer reuses; and, for a studio session, the studio visitor's projects with
 * the master agreement each names. Which statements run depends on the visitor's sessions and never on the id, and
 * every bind but the id and the visitor's own offer and email is fixed, so the sequence is the same for every id.
 */
export const readDownloadFacts = (reads: DownloadReads) =>
	asked((db) =>
		db.batch([
			db
				.prepare(
					"SELECT a.id,a.offer_id,a.request_id,a.status,a.archive_closed_at,c.recipient_email FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=?",
				)
				.bind(reads.id),
			db
				.prepare("SELECT reused_msa_id FROM software_offers WHERE id=?")
				.bind(reads.signingOfferId),
			...(reads.studioEmail === null
				? []
				: [
						db
							.prepare(
								`SELECT p.request_id,p.agreement_id,pa.msa_id AS linked_msa_id,r.status AS request_status,r.email AS request_email,p.revoked_at,p.content_deleted_at FROM software_projects p JOIN owner_requests r ON r.id=p.request_id LEFT JOIN software_agreements pa ON pa.id=p.agreement_id WHERE r.email=?`,
							)
							.bind(reads.studioEmail),
					]),
		]),
	).pipe(
		Effect.flatMap(([agreement, reused, projects]) =>
			Effect.all({
				agreement: rowsOf(AgreementRow, agreement?.results ?? []),
				reused: rowsOf(ReusedRow, reused?.results ?? []),
				projects: rowsOf(StudioProjectRow, projects?.results ?? []),
			}),
		),
		Effect.map(({ agreement, reused, projects }) => ({
			agreement: (agreement[0] ?? null) satisfies DownloadAgreement | null,
			signingReusedMsaId: reused[0]?.reused_msa_id ?? null,
			studioProjects: projects satisfies readonly StudioProject[],
		})),
	);

/** Plain read: the signed copy row of an agreement, or null. */
export const readSignedCopy = (id: string) =>
	readAll(CopyRow, (db) =>
		db
			.prepare(
				"SELECT status,pdf_key,pdf_sha256 FROM software_agreement_artifacts WHERE agreement_id=?",
			)
			.bind(id),
	).pipe(Effect.map((rows): StoredSignedCopy | null => rows[0] ?? null));

// ---- the attachment ----

/**
 * Plain reads, in ONE batch: the attachment with this id, and the offer the signing session names. Both statements run
 * for every id, so an unknown id and another request's attachment read the same rows in the same order.
 */
export const readAttachmentFacts = (id: string, offerId: string | null) =>
	asked((db) =>
		db.batch([
			db
				.prepare(
					"SELECT request_id,object_key,sha256 FROM software_agreement_attachments WHERE id=?",
				)
				.bind(id),
			db
				.prepare(
					"SELECT request_id,agreement_details_json FROM software_offers WHERE id=?",
				)
				.bind(offerId),
		]),
	).pipe(
		Effect.flatMap(([attachment, offer]) =>
			Effect.all({
				attachment: rowsOf(AttachmentColumns, attachment?.results ?? []),
				offer: rowsOf(AttachedOfferColumns, offer?.results ?? []),
			}),
		),
		Effect.map(
			({ attachment, offer }): AttachmentFacts => ({
				attachment: (attachment[0] ?? null) satisfies StoredAttachment | null,
				offer: (offer[0] ?? null) satisfies StoredOffer | null,
			}),
		),
	);
