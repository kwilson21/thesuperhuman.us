// The store of the agreement routes: the archive link, the downloads and the sessions, and the signing area
// (docs/plans/2026-11-signing-conversion.md, section 4), one group per section below, each opening with what it reads
// and writes. Every statement is a plain read of stored columns, a write guarded by a key, or a compare-and-set whose
// condition a rule in src/server/rules has already judged from a read; none decides an outcome. Rows are read through
// Effect Schema readers. A call fails in one of three ways:
//   - `AgreementStoreFailed`: a statement or batch failed, or a row was not its table's shape. It carries the cause,
//     which the route logs once through logUnexpected before its fixed 500.
//   - `GuardRefused`: a raised JSON guard or a raise-only trigger of the signing migration (`refusedBatch`), or a
//     constraint a group names as another request's write. Never retried: the route answers it as today, mostly a 409.
//   - `ChangedSinceRead`: a lost compare-and-set backing a fact a rule reads (the archive link's and the cooldown's
//     guards, and each UNIQUE failure the plan's section 2 reads and decides again). `decideAndSave` reads and decides
//     again, three tries in all.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { agreementEvent } from "../lib/agreement-events";
import { softwareGuard } from "../lib/software-guard";
import {
	ChangedSinceRead,
	chainMatches,
	GuardRefused,
	raisedByJsonGuard,
} from "./guarded-save";
import { AGREEMENT_SIGNED } from "./machines/agreement-document";
import { OFFER_STATUSES } from "./machines/offer-version";
import type {
	AttachmentFacts,
	StoredAttachment,
	StoredOffer,
} from "./rules/agreement-attachment";
import type {
	DownloadAgreement,
	StoredSignedCopy,
	StudioProject,
} from "./rules/agreement-download";
import type { StoredSignature } from "./rules/agreement-link";
import type {
	SigningOfferRow,
	StoredAgreementSession,
	StoredStudioSession,
} from "./rules/agreement-session";
import type {
	DraftSaveFacts,
	DraftWrite,
	StoredAgreementStatus,
} from "./rules/signing-draft";
import type {
	RefundWrite,
	SigningLinkWrite,
	SigningSettingRow,
	StoredSigningLink,
} from "./rules/signing-link";
import type { LinkedOfferRow, SigningStateRow } from "./rules/signing-offer";
import type {
	RedeemSession,
	StoredAgreementLink,
} from "./rules/signing-redeem";
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

/**
 * The raise-only triggers of migrations/music/0023_software_signing.sql: templates, the contractor's details, signatures,
 * signed agreement texts, clients and notices are immutable, and a closed archive's end, retention, hold and
 * termination cannot change. They write nothing; a batch one raises in is refused like a guard's.
 */
const TRIGGER_RAISED =
	/Immutable (template|config|signature|signed agreement|identity|notice)|Archive cleanup is reserved/;

/**
 * What a rejected batch of this area is: a raised JSON guard or a raise-only trigger is `GuardRefused` (another request
 * changed what was read, or the archive closed), looked for down the cause chain; anything else is
 * `AgreementStoreFailed` with its cause. A batch that re-decides on a UNIQUE failure (plan section 2) checks that first.
 */
export const refusedBatch = (cause: unknown) =>
	cause instanceof Error &&
	(raisedByJsonGuard(cause) || chainMatches(cause, TRIGGER_RAISED))
		? new GuardRefused()
		: new AgreementStoreFailed({ failure: cause });

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

// ---- the signing link, the redeem and the draft ----
//
// What the signing link (POST /api/offer/[token]/link), the verify pages' redeem and the draft (POST
// /api/offer/[token]/draft, and the review's first step) read and write (docs/plans/2026-11-signing-conversion.md,
// section 4: "The offer and the session", "The signing link", "The redeem", the draft half of "The draft and review").
// The rules in src/server/rules/signing-offer.ts, signing-link.ts, signing-redeem.ts and signing-draft.ts decide from
// these rows. Where today's code filtered in SQL (`getLinkedOffer`'s conditions, the redeem read's `used_at IS NULL AND
// expires_at>?` and its purpose), the read here returns the plain rows and the rule decides; each batch keeps today's
// guards as the write-time re-check. A guard statement, a write and a statement a golden hook picks keep today's SQL text,
// and each batch today's statement order. No statement reads the clock or draws an id: the times, the new ids and the
// hashes are inputs. The one id drawn here is the event's, by `agreementEvent`, at the point of today's batch (after
// the flow's own draws, as today).
//
// Failures: a rejection is `AgreementStoreFailed` with its cause. The link batch's raised guard (A4 or A1) is
// `ChangedSinceRead`, so `decideAndSave` reads and decides again (plan section 2); the redeem's and the draft's raised
// guards are `GuardRefused` (`refusedBatch`), never retried.

/** The signing setting's row. */
const SettingColumns = Schema.Struct({
	software_signing_enabled: Schema.Number,
});

/** Every column of `software_offers` (`o.*`). */
const OfferColumns = Schema.Struct({
	id: text,
	request_id: text,
	version: Schema.Number,
	status: Schema.Literals(OFFER_STATUSES),
	terms_json: text,
	created_at: text,
	updated_at: text,
	sent_at: maybeText,
	sent_by: maybeText,
	agreement_details_json: maybeText,
	msa_template_id: maybeText,
	sow_template_id: maybeText,
	contractor_snapshot_json: maybeText,
	recipient_email_snapshot: maybeText,
	reused_msa_id: maybeText,
});

/** The offer link with a token's hash and its brief: what `linkedOffer` reads beside each offer. */
const LinkedThroughColumns = Schema.Struct({
	link_revoked_at: maybeText,
	request_kind: text,
	request_status: text,
	request_email: text,
});

const SigningStateColumns = Schema.Struct({
	status: text,
	recipient_email_snapshot: maybeText,
	request_status: text,
	link_hash: maybeText,
	link_revoked_at: maybeText,
	software_signing_enabled: Schema.NullOr(Schema.Number),
	project_offer_id: maybeText,
});

const SigningLinkColumns = Schema.Struct({
	id: text,
	issued_at: text,
	used_at: maybeText,
});

const BriefNameColumns = Schema.Struct({ name: text });

/** Every column of `software_agreement_links` (`SELECT *`). */
const StoredLinkColumns = Schema.Struct({
	id: text,
	purpose: text,
	offer_id: maybeText,
	link_hash: maybeText,
	recipient_email: text,
	token_hash: text,
	issued_at: text,
	expires_at: text,
	used_at: maybeText,
});

const AgreementStatusColumns = Schema.Struct({
	offer_id: maybeText,
	status: text,
});

const ProjectOfferColumns = Schema.Struct({ offer_id: text });

/**
 * A1, the live signing guard: the offer is sent, through the offer link with this token hash, to this recipient, its
 * brief is neither resolved nor withdrawn, no project names the offer, and signing is on. Today's `liveSigningGuard`
 * (src/lib/agreement-access.ts), text for text; `openForSigning` decides the same from `readSigningFacts`.
 */
const liveSigningStatement = (
	db: D1Database,
	offerId: string | null,
	linkHash: string | null,
	recipient: string,
) =>
	db
		.prepare(
			`SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END`,
		)
		.bind(offerId, linkHash, recipient);

/**
 * A2: the signing session is unexpired at `now` and unrevoked. Today's `sessionGuard` (src/lib/software-agreements.ts),
 * text for text, with its clock reading passed in.
 */
const openSessionStatement = (db: D1Database, tokenHash: string, now: string) =>
	softwareGuard(
		db,
		"SELECT 1 FROM software_agreement_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL",
		[tokenHash, now],
	);

/** The statuses A3 refuses, from the machine (`AGREEMENT_SIGNED`), in today's order: 'client_signed','executed'. */
const SIGNED_STATUSES = AGREEMENT_SIGNED.map((status) => `'${status}'`).join(
	",",
);

/** A3: no agreement of the offer is client-signed or executed. Today's draft guard (src/lib/agreement-draft.ts). */
const unsignedStatement = (db: D1Database, offerId: string) =>
	db
		.prepare(
			`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN (${SIGNED_STATUSES})) THEN 1 ELSE json_extract('Already signed','$') END`,
		)
		.bind(offerId);

/**
 * Plain read: the signing setting's row, or null when it is missing (`signingOn` and `draftFront` read a missing row as
 * off, as today's `signingEnabled` does). Today's statement, text for text.
 */
export const readSigningEnabled = () =>
	readAll(SettingColumns, (db) =>
		db.prepare(
			"SELECT software_signing_enabled FROM software_signing_settings WHERE id=1",
		),
	).pipe(Effect.map((rows): SigningSettingRow | null => rows[0] ?? null));

/**
 * Plain reads, in ONE batch: every offer of the brief whose offer link has this token hash, whatever its status, and that
 * link with its brief, as `linkedOffer` reads them. Today's `getLinkedOffer` filters these in SQL; the rule decides now.
 * The first statement keeps the start of today's text (`SELECT o.* FROM software_offers o JOIN software_offer_links l ON
 * l.request_id=o.request_id` and the `JOIN owner_requests`), so the golden hooks that pick today's offer read pick it,
 * and the second matches none. The offer link's token hash is unique and its brief is its key, so the second answers one
 * row at most and every offer shares it. The caller checks the token's shape (43 URL-safe characters) before hashing it,
 * as `getLinkedOffer` does before it reads.
 */
export const readLinkedOffer = (tokenHash: string) =>
	asked((db) =>
		db.batch([
			db
				.prepare(`SELECT o.* FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id
    JOIN owner_requests r ON r.id=o.request_id WHERE l.token_hash=?`)
				.bind(tokenHash),
			db
				.prepare(
					"SELECT l.revoked_at AS link_revoked_at,r.kind AS request_kind,r.status AS request_status,r.email AS request_email FROM software_offer_links l JOIN owner_requests r ON r.id=l.request_id WHERE l.token_hash=?",
				)
				.bind(tokenHash),
		]),
	).pipe(
		Effect.flatMap(([offers, through]) =>
			Effect.all({
				offers: rowsOf(OfferColumns, offers?.results ?? []),
				through: rowsOf(LinkedThroughColumns, through?.results ?? []),
			}),
		),
		Effect.map(({ offers, through }): readonly LinkedOfferRow[] =>
			through.flatMap((link) => offers.map((offer) => ({ ...offer, ...link }))),
		),
	);

/**
 * Plain read: the offer's signing state (`openForSigning`'s facts): the offer by its id with its brief, the offer link
 * only when it has this token hash, the signing setting and a project of the offer; null when the offer is gone. What A1
 * re-checks, as rows. Today's read after the link batch's guard raised (`signingRefusal`, src/lib/agreement-access.ts),
 * text for text; the converted flows read it before the batch as well, and for the redeem's GET in place of A1 run as a
 * read.
 */
export const readSigningFacts = (input: {
	readonly offerId: string | null;
	readonly linkHash: string | null;
}) =>
	readAll(SigningStateColumns, (db) =>
		db
			.prepare(
				"SELECT o.status,o.recipient_email_snapshot,r.status AS request_status,l.token_hash AS link_hash,l.revoked_at AS link_revoked_at,s.software_signing_enabled,p.offer_id AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id LEFT JOIN software_offer_links l ON l.request_id=o.request_id AND l.token_hash=? LEFT JOIN software_signing_settings s ON s.id=1 LEFT JOIN software_projects p ON p.offer_id=o.id WHERE o.id=?",
			)
			.bind(input.linkHash, input.offerId),
	).pipe(Effect.map((rows): SigningStateRow | null => rows[0] ?? null));

/**
 * Plain read: the recipient's signing links of the offer, used or not (A4 counts every one; `consumeOlderLinks` picks the
 * unused older ones). The archive link's read of its links, text for text, bound to the signing purpose and the offer.
 */
export const readSigningLinks = (recipient: string, offerId: string) =>
	readAll(SigningLinkColumns, (db) =>
		db
			.prepare(
				"SELECT id,issued_at,used_at FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ?",
			)
			.bind("agreement", recipient, offerId),
	).pipe(Effect.map((rows): readonly StoredSigningLink[] => rows));

/** The signing link the flow drew for one try of the link batch, with the rule's times. */
export type SigningLinkRow = Pick<
	SigningLinkWrite,
	"at" | "since" | "expiresAt"
> & {
	readonly id: string;
	/** The emailed key's hash. */
	readonly hash: string;
	/** The event's actor: the link id's hash. */
	readonly actorHash: string;
	readonly offerId: string;
	/** The offer link's token hash, which A1 binds and the link keeps. */
	readonly linkHash: string;
	/** The recipient, as `linkRecipient` normalised it. */
	readonly recipient: string;
};

/**
 * Stores the signing link: one batch, today's (`storeSigningLink`, src/lib/agreement-access.ts) statement for statement:
 * A4 (no signing link of the recipient and offer issued after `since`), A1, the `link-issued` event and the link. A
 * raised guard (either) is `ChangedSinceRead`, so `decideAndSave` reads the offer's signing state and the links again and
 * the rule decides (Q1); any other failure is `AgreementStoreFailed`.
 */
export const storeSigningLink = (link: SigningLinkRow) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					db
						.prepare(
							`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another link','$') END`,
						)
						.bind("agreement", link.recipient, link.offerId, link.since),
					liveSigningStatement(db, link.offerId, link.linkHash, link.recipient),
					agreementEvent(
						db,
						"link-issued",
						link.actorHash,
						link.at,
						null,
						link.offerId,
					),
					db
						.prepare(
							"INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
						)
						.bind(
							link.id,
							"agreement",
							link.offerId,
							link.linkHash,
							link.recipient,
							link.hash,
							link.at,
							link.expiresAt,
						),
				]),
			catch: (cause) =>
				cause instanceof Error && raisedByJsonGuard(cause)
					? new ChangedSinceRead()
					: new AgreementStoreFailed({ failure: cause }),
		});
	});

/** Plain read: the brief's name, for the mail's greeting, or null when the brief is gone. Today's statement. */
export const readBriefName = (requestId: string) =>
	readAll(BriefNameColumns, (db) =>
		db.prepare("SELECT name FROM owner_requests WHERE id=?").bind(requestId),
	).pipe(Effect.map((rows) => rows[0]?.name ?? null));

/**
 * Takes back a signing link whose mail was refused, in ONE batch, today's statement for statement: the link's sessions
 * and the link deleted, then for each use the request counted (the address's, then the recipient's) its two refund
 * statements, whose own filter decides whether the window's row goes (its only use) or loses one use. One batch, so a
 * failure leaves the link, its sessions and every use as they were (plan section 4, "The allowance").
 */
export const removeRefusedLink = (write: RefundWrite) =>
	asked((db) =>
		db.batch([
			db
				.prepare("DELETE FROM software_agreement_sessions WHERE link_id=?")
				.bind(write.linkId),
			db
				.prepare("DELETE FROM software_agreement_links WHERE id=?")
				.bind(write.linkId),
			...write.uses.flatMap((use) => [
				db
					.prepare(
						"DELETE FROM audio_client_allowances WHERE key=? AND window_start=? AND uses=1",
					)
					.bind(use.key, use.window_start),
				db
					.prepare(
						"UPDATE audio_client_allowances SET uses=uses-1 WHERE key=? AND window_start=? AND uses>1",
					)
					.bind(use.key, use.window_start),
			]),
		]),
	).pipe(Effect.asVoid);

/**
 * Plain read: the link with this key hash, whatever its purpose, use and expiry, or null. Today's read filtered the
 * purpose, `used_at IS NULL` and `expires_at>?` in SQL; `redeemLink` decides them now, and A5 re-checks the last two.
 */
export const readLinkByKey = (keyHash: string) =>
	readAll(StoredLinkColumns, (db) =>
		db
			.prepare("SELECT * FROM software_agreement_links WHERE token_hash=?")
			.bind(keyHash),
	).pipe(Effect.map((rows): StoredAgreementLink | null => rows[0] ?? null));

/**
 * Redeems a link: one batch, today's (`completeAgreementLink`, src/lib/agreement-access.ts) statement for statement: A1
 * for a signing link (`session.live`), A5 (the link still unused and unexpired at `at`), the link used, the `verified`
 * event (its actor the session's hash) and the session. The flow draws the session token, its hash and the nonce before
 * it, as today. A raised guard is `GuardRefused` (the expired page, not retried); any other failure is
 * `AgreementStoreFailed`.
 */
export const redeemLinkBatch = (input: {
	readonly session: RedeemSession;
	readonly sessionHash: string;
	readonly csrfNonce: string;
}) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const { session } = input;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					...(session.live === null
						? []
						: [
								liveSigningStatement(
									db,
									session.live.offerId,
									session.live.linkHash,
									session.live.recipient,
								),
							]),
					db
						.prepare(
							`SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreement_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN 1 ELSE json_extract('Link already consumed','$') END`,
						)
						.bind(session.keyHash, session.at),
					db
						.prepare(
							"UPDATE software_agreement_links SET used_at=? WHERE token_hash=?",
						)
						.bind(session.at, session.keyHash),
					agreementEvent(
						db,
						"verified",
						input.sessionHash,
						session.at,
						null,
						session.offerId,
					),
					db
						.prepare(
							"INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,csrf_nonce) VALUES(?,?,?,?,?,?,?,?,?)",
						)
						.bind(
							input.sessionHash,
							session.purpose,
							session.offerId,
							session.linkHash,
							session.recipient,
							session.linkId,
							session.at,
							session.expiresAt,
							input.csrfNonce,
						),
				]),
			catch: refusedBatch,
		});
	});

/**
 * Plain reads, in ONE batch, of what only the draft batch's guards checked before (`saveSigningDraft`'s facts): every
 * agreement of the offer with its status (A3), and a project of the offer (A1's project), or null. New reads: no golden
 * hook of the corpora that save a draft (offer-draft, offer-review) picks either.
 */
export const readDraftFacts = (offerId: string) =>
	asked((db) =>
		db.batch([
			db
				.prepare(
					"SELECT offer_id,status FROM software_agreements WHERE offer_id=?",
				)
				.bind(offerId),
			db
				.prepare("SELECT offer_id FROM software_projects WHERE offer_id=?")
				.bind(offerId),
		]),
	).pipe(
		Effect.flatMap(([agreements, project]) =>
			Effect.all({
				agreements: rowsOf(AgreementStatusColumns, agreements?.results ?? []),
				project: rowsOf(ProjectOfferColumns, project?.results ?? []),
			}),
		),
		Effect.map(
			({
				agreements,
				project,
			}): Pick<DraftSaveFacts, "agreements" | "project"> => ({
				agreements: agreements satisfies readonly StoredAgreementStatus[],
				project: project[0] ?? null,
			}),
		),
	);

/**
 * Saves the draft: one batch, today's (`saveAgreementDraft`, src/lib/agreement-draft.ts) statement for statement: A1
 * (the session's link and address), A2 (the session open at `sessionNow`), A3 and the upsert. `sessionNow` is A2's own
 * clock reading, which today's `sessionGuard` takes as the batch is built, before the draft's `updated_at`; the flow
 * reads both. A raised guard is `GuardRefused` (not retried); any other failure is `AgreementStoreFailed`.
 */
export const saveDraftBatch = (write: DraftWrite, sessionNow: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () =>
				db.batch([
					liveSigningStatement(
						db,
						write.offerId,
						write.linkHash,
						write.recipient,
					),
					openSessionStatement(db, write.sessionHash, sessionNow),
					unsignedStatement(db, write.offerId),
					db
						.prepare(
							"INSERT INTO software_agreement_drafts(offer_id,recipient_email,values_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(offer_id,recipient_email) DO UPDATE SET values_json=excluded.values_json,updated_at=excluded.updated_at",
						)
						.bind(
							write.offerId,
							write.recipient,
							write.values_json,
							write.updated_at,
						),
				]),
			catch: refusedBatch,
		});
	});
