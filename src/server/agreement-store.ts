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
import type { AgreementTemplate } from "../lib/agreement-templates";
import { softwareGuard } from "../lib/software-guard";
import type { SoftwareOffer } from "../lib/software-offers";
import {
	ChangedSinceRead,
	chainMatches,
	GuardRefused,
	isUniqueViolation,
	raisedByJsonGuard,
} from "./guarded-save";
import {
	AGREEMENT_MOVES,
	AGREEMENT_SIGNED,
	AGREEMENT_STATUSES,
	type AgreementStatus,
	agreementDocument,
} from "./machines/agreement-document";
import {
	agreementMessage,
	MESSAGE_MOVES,
	MESSAGE_STATUSES,
} from "./machines/agreement-message";
import { next } from "./machines/next";
import { OFFER_MOVES, OFFER_STATUSES } from "./machines/offer-version";
import type { AbandonWrite, OfferInvoiceRow } from "./rules/agreement-abandon";
import type {
	AttachmentFacts,
	StoredAttachment,
	StoredOffer,
} from "./rules/agreement-attachment";
import type {
	OfferAgreementRow as CountersignAgreementRow,
	CountersignWrite,
	RequestOfferRow,
} from "./rules/agreement-countersign";
import type {
	DownloadAgreement,
	StoredSignedCopy,
	StudioProject,
} from "./rules/agreement-download";
import type { StoredSignature } from "./rules/agreement-link";
import type {
	CopyRecordWrite,
	EndWrite,
	HoldWrite,
	RecordAgreementRow,
	ReusingOfferRow,
} from "./rules/agreement-record";
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
import {
	type ClientKey,
	clientChangedElsewhere,
	type OfferAgreementRow,
	type PendingMsaRow,
	type ReusedMsaRow as ReviewReusedMsaRow,
	type ReviewWrite,
} from "./rules/signing-review";
import type {
	DraftRow,
	SavedSignatureRow,
	SigningDocumentRow,
	SigningNotification,
	ReusedMsaRow as SignReusedMsaRow,
	SignWrite,
	StillSignableFacts,
} from "./rules/signing-sign";
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

// ---- what the signing groups share ----
//
// The status lists, guards and statements more than one signing group writes, each text for text as today's code
// builds it. The status lists come from the machines.

/** A status a machine names, written into SQL as a literal; anything else is a bug, never a request's value. */
function statusLiteral(status: string, known: readonly string[]) {
	if (!known.includes(status))
		throw new Error(`Not a status the signing machines name: ${status}`);

	return `'${status}'`;
}

/** `status='x'` for one status, `status IN ('x','y')` for several, in the order given (the machine's). */
function statusIs(statuses: readonly string[], known: readonly string[]) {
	const quoted = statuses.map((status) => statusLiteral(status, known));

	if (quoted.length === 0)
		throw new Error("A move with no status to move from.");

	return quoted.length === 1
		? `status=${quoted[0]}`
		: `status IN (${quoted.join(",")})`;
}

/** An agreement status as a SQL literal, from the agreement document machine. */
const signingStatusLiteral = (status: AgreementStatus) =>
	statusLiteral(status, AGREEMENT_STATUSES);

/** `status='x'` or `status IN (...)` of agreement statuses, from the agreement document machine. */
export const signingStatusIs = (statuses: readonly AgreementStatus[]) =>
	statusIs(statuses, AGREEMENT_STATUSES);

/**
 * A1, today's `liveSigningGuard` (src/lib/agreement-access.ts), text for text: the offer is sent, through the offer link
 * with this token hash, to this recipient, its brief is neither resolved nor withdrawn, no project names the offer, and
 * signing is on. `openForSigning` decides the same from `readSigningFacts`.
 */
const signingLiveGuard = (
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
 * A2, today's `sessionGuard` (src/lib/software-agreements.ts), text for text: the signing session is unexpired at `now`
 * and unrevoked. Today's guard read its own clock as the batch was built; the flow reads it there and passes it in.
 */
const signingSessionGuard = (db: D1Database, tokenHash: string, now: string) =>
	softwareGuard(
		db,
		"SELECT 1 FROM software_agreement_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL",
		[tokenHash, now],
	);

/** An event row as a rule wrote it, with the id the flow drew. */
type EventRow = {
	readonly id: string;
	readonly agreement_id: string | null;
	readonly offer_id: string | null;
	readonly action: string;
	readonly actor: string;
	readonly occurred_at: string;
	readonly reason: string | null;
};

/** One event: the statement `agreementEvent` (src/lib/agreement-events.ts) builds, binding the id it is given. */
const signingEvent = (db: D1Database, event: EventRow) =>
	db
		.prepare(
			"INSERT INTO software_agreement_events(id,agreement_id,offer_id,action,actor,occurred_at,reason) VALUES(?,?,?,?,?,?,?)",
		)
		.bind(
			event.id,
			event.agreement_id,
			event.offer_id,
			event.action,
			event.actor,
			event.occurred_at,
			event.reason,
		);

/** Whether a rejection is a FOREIGN KEY failure, found down the cause chain. */
const foreignKeyFailed = (cause: unknown) =>
	cause instanceof Error && chainMatches(cause, /FOREIGN KEY/);

/** A8, today's reused-MSA guard of the signature and the countersignature: the MSA is executed and not terminated. */
const reusedMsaGuard = (db: D1Database, msaId: string) =>
	softwareGuard(
		db,
		"SELECT 1 FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL",
		[msaId],
	);

/** A signature row as a rule wrote it, with the id the flow drew. */
type SignatureRow = {
	readonly id: string;
	readonly agreement_id: string;
	readonly party: string;
	readonly typed_name: string;
	readonly title: string;
	readonly consent_text: string;
	readonly consent_at: string;
	readonly signed_at: string;
	readonly document_sha256: string;
	readonly session_token_hash: string | null;
	readonly owner_subject: string | null;
	readonly verified_email: string;
	readonly verified_at: string;
	readonly verification_method: string;
	readonly intent_text: string;
	readonly document_list_json: string;
	readonly receipt_id: string;
	readonly ip_address: string;
	readonly user_agent: string;
};

/** One signature: the statement `signatureInsert` (src/lib/software-agreements.ts) builds, its consent version fixed. */
const signatureStatement = (db: D1Database, signature: SignatureRow) =>
	db
		.prepare(
			"INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,session_token_hash,owner_subject,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES(?,?,?,?,?,?,'website-signing-v3',?,?,?,?,?,?,?,?,?,?,?,?,?)",
		)
		.bind(
			signature.id,
			signature.agreement_id,
			signature.party,
			signature.typed_name,
			signature.title,
			signature.consent_text,
			signature.consent_at,
			signature.signed_at,
			signature.document_sha256,
			signature.session_token_hash,
			signature.owner_subject,
			signature.verified_email,
			signature.verified_at,
			signature.verification_method,
			signature.intent_text,
			signature.document_list_json,
			signature.receipt_id,
			signature.ip_address,
			signature.user_agent,
		);

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

/** A3: no agreement of the offer is client-signed or executed. Today's draft guard (src/lib/agreement-draft.ts). */
const unsignedStatement = (db: D1Database, offerId: string) =>
	db
		.prepare(
			`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND ${signingStatusIs(AGREEMENT_SIGNED)}) THEN 1 ELSE json_extract('Already signed','$') END`,
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
					signingLiveGuard(db, link.offerId, link.linkHash, link.recipient),
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
								signingLiveGuard(
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
					signingLiveGuard(db, write.offerId, write.linkHash, write.recipient),
					signingSessionGuard(db, write.sessionHash, sessionNow),
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

// ---- the review and the signature ----
//
// The client's review and signature (docs/plans/2026-11-signing-conversion.md, section 4, the review half of "The draft
// and review" and "Signing"): the reads the rules of src/server/rules/signing-review.ts and signing-sign.ts decide from,
// and the two batches that store what those rules wrote, statement for statement as today's `reviewOnce` and
// `signAgreements` build them (src/lib/software-agreements.ts). Where today's read decided in SQL (`offerAgreements`'
// `status<>'abandoned'`, the reused MSA's six conditions, the pending MSA's kind, statuses and offer, and the client
// evidence's `id<>?`), the read here gives the plain rows and the rule decides. The pending MSA's read keeps the start its
// golden hook picks; the offer's agreements and the reused MSA cannot, so PR 4 re-points their hooks (offer-review and
// offer-sign; tests/server/agreement-store-review.test.ts lists each). Every other text is today's, so the golden hooks
// pick the same statements. Two reads are new, made just before the signing batch for `stillSignable`: the offer's
// signing state (`readSigningFacts` above, the SQL of today's `signingRefusal`) and the MSA the offer reuses. Every id,
// time and token is an input bound as given, the events' ids included, so no statement here draws one (`agreementEvent`
// is not called). The status lists come from the agreement document machine.
//
// Failures. A rejected read is `AgreementStoreFailed`. The review batch: the pending-MSA index's UNIQUE, and a FOREIGN KEY
// failure for which `clientChangedElsewhere` holds on the evidence read after it, are `ChangedSinceRead`, which the flow
// reads and decides again (B7); any other UNIQUE, a raised guard and a raise-only trigger are `GuardRefused`; anything
// else, a FOREIGN KEY failure without that evidence or whose evidence cannot be read included, is `AgreementStoreFailed`
// with the batch's own failure, as today's code rethrew it. The signing batch: a raised guard or trigger, a UNIQUE (the
// signature's and the notice's) and a FOREIGN KEY failure (a document or its client deleted since the read; every row the
// batch names was read just before it) are `GuardRefused`, each today's 409; anything else is `AgreementStoreFailed`.

/** Where a review leads: the documents it inserts start in review, as REVIEW leads (a test holds it to the machine). */
export const REVIEWED: AgreementStatus = "review";

const NOTIFICATION_KINDS: readonly SigningNotification["kind"][] = [
	"signature-receipt",
	"countersign-notice",
];

/** A signing notification's kind, written into SQL as a literal as today's two statements carry it. */
function notificationKindLiteral(kind: SigningNotification["kind"]) {
	if (!NOTIFICATION_KINDS.includes(kind))
		throw new Error(`Not a signing notification kind: ${kind}`);

	return `'${kind}'`;
}

/** The index of one pending MSA per client and template (`software_agreements_pending_msa`), as SQLite names it. */
const PENDING_MSA_TAKEN =
	/UNIQUE constraint failed: software_agreements\.client_id, software_agreements\.template_id/;

const OfferAgreementColumns = Schema.Struct({
	id: text,
	kind: Schema.Literals(["msa", "sow"]),
	status: Schema.Literals(AGREEMENT_STATUSES),
	client_id: text,
	canonical_text: text,
	text_sha256: text,
	values_json: text,
	review_session_hash: text,
});

const ClientIdRow = Schema.Struct({ id: text });

const ReviewReusedMsaColumns = Schema.Struct({
	id: text,
	kind: text,
	status: text,
	client_id: text,
	template_id: text,
	terminated_at: maybeText,
	archive_closed_at: maybeText,
	effective_on: text,
	canonical_text: text,
	text_sha256: text,
	artifact_status: maybeText,
});

const TemplateColumns = Schema.Struct({
	id: text,
	kind: Schema.Literals(["msa", "sow"]),
	version: Schema.Number,
	text,
	sha256: text,
	version_label: maybeText,
	source_revision: maybeText,
	published_at: text,
});

const PendingMsaColumns = Schema.Struct({
	id: text,
	kind: text,
	status: text,
	offer_id: maybeText,
	client_id: text,
	template_id: text,
});

const SavedSignatureColumns = Schema.Struct({
	receipt_id: text,
	session_token_hash: maybeText,
});

const DraftColumns = Schema.Struct({ values_json: text });

const SignReusedMsaColumns = Schema.Struct({
	id: text,
	kind: Schema.Literals(["msa", "sow"]),
	status: Schema.Literals(AGREEMENT_STATUSES),
	terminated_at: maybeText,
});

/** One agreement of the offer, as each rule that reads the offer's agreements takes it. */
type OfferAgreement = OfferAgreementRow &
	SigningDocumentRow &
	CountersignAgreementRow;

/**
 * Plain read: every agreement of the offer, abandoned ones included, ordered by kind as today, with the columns the
 * review's rules (`OfferAgreementRow`, the GET's and the POST's), the signature's (`SigningDocumentRow`) and the owner's
 * countersign and abandon (`CountersignAgreementRow`) read. The rules leave out the abandoned ones, as
 * `offerAgreements`' `status<>'abandoned'` did.
 */
export const readOfferAgreements = (offerId: string) =>
	readAll(OfferAgreementColumns, (db) =>
		db
			.prepare(
				"SELECT id,kind,status,client_id,canonical_text,text_sha256,values_json,review_session_hash FROM software_agreements WHERE offer_id=? ORDER BY kind",
			)
			.bind(offerId),
	).pipe(Effect.map((rows): readonly OfferAgreement[] => rows));

/** The clients with the natural key (the table's UNIQUE key, so at most one), as today's review reads it. */
const clientsByKeyStatement = (db: D1Database, key: ClientKey) =>
	db
		.prepare(
			"SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=?",
		)
		.bind(
			key.recipient_email,
			key.legal_name_key,
			key.entity_type,
			key.jurisdiction,
		);

/** Plain read: the client the natural key names, or null (today's text). */
export const readClientByKey = (key: ClientKey) =>
	readAll(ClientIdRow, (db) => clientsByKeyStatement(db, key)).pipe(
		Effect.map((rows): { readonly id: string } | null => rows[0] ?? null),
	);

/**
 * Plain read: the MSA an offer reuses, by its id, with the status of its signed copy (null when it has none); null when no
 * row has the id. Read only when the offer names one (a truthy id), as today; otherwise null with no statement. The rule
 * (`reviewParty`) decides what today's six conditions decided.
 */
export const readReusedMsa = (id: string | null | undefined) =>
	id
		? readAll(ReviewReusedMsaColumns, (db) =>
				db
					.prepare(
						"SELECT a.id,a.kind,a.status,a.client_id,a.template_id,a.terminated_at,a.archive_closed_at,a.effective_on,a.canonical_text,a.text_sha256,f.status AS artifact_status FROM software_agreements a LEFT JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.id=?",
					)
					.bind(id),
			).pipe(Effect.map((rows): ReviewReusedMsaRow | null => rows[0] ?? null))
		: Effect.succeed<ReviewReusedMsaRow | null>(null);

/** Plain read: the template with this id, or null; a null id is bound as it is and finds none, as today (today's text). */
export const readTemplate = (id: string | null | undefined) =>
	readAll(TemplateColumns, (db) =>
		db
			.prepare("SELECT * FROM software_agreement_templates WHERE id=?")
			.bind(id ?? null),
	).pipe(Effect.map((rows): AgreementTemplate | null => rows[0] ?? null));

/**
 * Plain read: every agreement of the client for the template, whatever its kind, status and offer; the rule
 * (`reviewPendingMsa`) decides which is another offer's pending MSA. The text keeps today's start, which the golden hook
 * of the pending MSA lookup picks.
 */
export const readPendingMsa = (clientId: string, templateId: string) =>
	readAll(PendingMsaColumns, (db) =>
		db
			.prepare(
				"SELECT * FROM software_agreements WHERE client_id=? AND template_id=?",
			)
			.bind(clientId, templateId),
	).pipe(Effect.map((rows): readonly PendingMsaRow[] => rows));

/**
 * Plain read, after the review batch failed its FOREIGN KEY: for a client the key named before the batch, that client by
 * its id; for a new client, the clients with its natural key. `clientChangedElsewhere` decides from the rows.
 */
export const readClientEvidence = (
	write: Pick<ReviewWrite, "client" | "earlierClientId">,
) =>
	readAll(ClientIdRow, (db) =>
		write.earlierClientId
			? db
					.prepare("SELECT id FROM software_agreement_clients WHERE id=?")
					.bind(write.earlierClientId)
			: clientsByKeyStatement(db, write.client),
	).pipe(Effect.map((rows): readonly { readonly id: string }[] => rows));

/** The review batch, in today's order: A1, A2, A3, the client, the documents in review replaced, the stale clients, the event. */
const reviewStatements = (db: D1Database, write: ReviewWrite) => {
	const client = write.client;

	return [
		signingLiveGuard(db, write.offerId, write.linkHash, write.recipientEmail),
		signingSessionGuard(db, write.sessionTokenHash, write.sessionNow),
		softwareGuard(
			db,
			`SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND ${signingStatusIs(AGREEMENT_SIGNED)})`,
			[write.offerId],
		),
		db
			.prepare(
				"INSERT OR IGNORE INTO software_agreement_clients VALUES(?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				client.id,
				client.recipient_email,
				client.legal_name,
				client.legal_name_key,
				client.entity_type,
				client.jurisdiction,
				client.business_address,
				client.notice_email,
				client.created_at,
			),
		db
			.prepare(
				`DELETE FROM software_agreements WHERE offer_id=? AND ${signingStatusIs(AGREEMENT_MOVES.REVIEW)}`,
			)
			.bind(write.offerId),
		...write.documents.map((document) =>
			db
				.prepare(
					`INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,msa_id,sow_number,status,canonical_text,text_sha256,values_json,attachment_manifest_json,created_at,effective_on,review_session_hash) VALUES(?,?,?,?,?,?,?,?,${signingStatusLiteral(REVIEWED)},?,?,?,?,?,?,?)`,
				)
				.bind(
					document.id,
					document.kind,
					document.offer_id,
					document.request_id,
					document.client_id,
					document.template_id,
					document.msa_id,
					document.sow_number,
					document.canonical_text,
					document.text_sha256,
					document.values_json,
					document.attachment_manifest_json,
					document.created_at,
					document.effective_on,
					document.review_session_hash,
				),
		),
		// A write-time filter that refuses nothing: a replaced client goes only once no agreement or notice names it.
		...(write.staleClientIds.length === 0
			? []
			: [
					db
						.prepare(
							`DELETE FROM software_agreement_clients WHERE id IN (${write.staleClientIds.map(() => "?").join(",")})` +
								"\n        AND NOT EXISTS(SELECT 1 FROM software_agreements WHERE client_id=software_agreement_clients.id)" +
								"\n        AND NOT EXISTS(SELECT 1 FROM software_agreement_notices WHERE client_id=software_agreement_clients.id)",
						)
						.bind(...write.staleClientIds),
				]),
		signingEvent(db, write.event),
	];
};

/** The review batch failed its FOREIGN KEY: whether another request changed the client is read next. */
class ReviewClientMissing extends Data.TaggedError("ReviewClientMissing")<{
	readonly failure: unknown;
}> {}

/** What a rejected review batch is, before any evidence is read (see the head of this group). */
function reviewRefused(cause: unknown) {
	if (cause instanceof Error && chainMatches(cause, PENDING_MSA_TAKEN))
		return new ChangedSinceRead();

	if (foreignKeyFailed(cause))
		return new ReviewClientMissing({ failure: cause });

	return isUniqueViolation(cause) ? new GuardRefused() : refusedBatch(cause);
}

/**
 * Stores the review the rule wrote (`reviewDocuments`), binding its ids, times and event id. Fails with
 * `ChangedSinceRead` when another request took the one pending MSA per client and template, or changed the client this
 * review chose (`clientChangedElsewhere` on the evidence read after the FOREIGN KEY failure); `GuardRefused` for A1, A2,
 * A3 or another UNIQUE; `AgreementStoreFailed` with the batch's failure otherwise.
 */
export const reviewBatch = (write: ReviewWrite) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () => db.batch(reviewStatements(db, write)),
			catch: reviewRefused,
		});
	}).pipe(
		Effect.catchTag("ReviewClientMissing", (missing) =>
			readClientEvidence(write).pipe(
				// Evidence that cannot be read is no evidence: the batch's own failure stands, as today.
				Effect.catchTag("AgreementStoreFailed", () =>
					Effect.succeed<readonly { readonly id: string }[] | null>(null),
				),
				Effect.flatMap((found) =>
					Effect.fail(
						found !== null && clientChangedElsewhere(write, found)
							? new ChangedSinceRead()
							: new AgreementStoreFailed({ failure: missing.failure }),
					),
				),
			),
		),
	);

/** Plain read: the client signature saved on the document (its receipt and the session that saved it), or null. */
export const readSavedReceipt = (agreementId: string) =>
	readAll(SavedSignatureColumns, (db) =>
		db
			.prepare(
				"SELECT receipt_id,session_token_hash FROM software_agreement_signatures WHERE agreement_id=? AND party='client'",
			)
			.bind(agreementId),
	).pipe(Effect.map((rows): SavedSignatureRow | null => rows[0] ?? null));

/** Plain read: the client's saved draft for the offer and the session's address, or null (today's text). */
export const readSavedDraft = (offerId: string, email: string) =>
	readAll(DraftColumns, (db) =>
		db
			.prepare(
				"SELECT values_json FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
			)
			.bind(offerId, email),
	).pipe(Effect.map((rows): DraftRow | null => rows[0] ?? null));

/**
 * Plain reads, just before the signing batch (`stillSignable`): the offer's signing state (`readSigningFacts`, the SQL of
 * today's `signingRefusal`), then the MSA the offer reuses by its id (only when it names one; the plain row, which the
 * rule judges as A8 does). Both are new reads here; neither text matches a hook of the golden sign corpus.
 */
export const readStillSignable = (
	offer: Pick<SoftwareOffer, "id" | "reused_msa_id">,
	session: Pick<StoredAgreementSession, "link_hash">,
) =>
	Effect.all({
		signing: readSigningFacts({
			offerId: offer.id,
			linkHash: session.link_hash,
		}),
		reusedMsa: offer.reused_msa_id
			? readAll(SignReusedMsaColumns, (db) =>
					db
						.prepare(
							"SELECT id,kind,status,terminated_at FROM software_agreements WHERE id=?",
						)
						.bind(offer.reused_msa_id),
				).pipe(Effect.map((rows): SignReusedMsaRow | null => rows[0] ?? null))
			: Effect.succeed<SignReusedMsaRow | null>(null),
	}).pipe(Effect.map((facts): StillSignableFacts => facts));

/**
 * The signing batch, in today's order: A1, A2 at `sessionNow`, A7 when a draft was read, A8 when the offer reuses an MSA,
 * the notice (inserted only where the client row has another address or notice email: a write-time filter that refuses
 * nothing), then per document A9, the signature, the event and the move to client_signed; the draft removed; the two
 * notifications.
 */
const signStatements = (
	db: D1Database,
	write: SignWrite,
	sessionNow: string,
) => {
	const { guards, notice } = write;

	return [
		signingLiveGuard(db, guards.offerId, guards.linkHash, guards.recipient),
		signingSessionGuard(db, guards.sessionTokenHash, sessionNow),
		...(guards.draftValues === null
			? []
			: [
					softwareGuard(
						db,
						"SELECT 1 FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=? AND values_json=?",
						[guards.offerId, guards.recipient, guards.draftValues],
					),
				]),
		...(guards.reusedMsaId === null
			? []
			: [reusedMsaGuard(db, guards.reusedMsaId)]),
		db
			.prepare(
				"INSERT INTO software_agreement_notices(id,agreement_id,client_id,business_address,notice_email,recorded_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_clients WHERE id=? AND (business_address<>? OR notice_email<>?))",
			)
			.bind(
				notice.id,
				notice.agreement_id,
				notice.client_id,
				notice.business_address,
				notice.notice_email,
				notice.recorded_at,
				notice.client_id,
				notice.business_address,
				notice.notice_email,
			),
		...write.documents.flatMap((document) => {
			const signature = document.signature;

			return [
				softwareGuard(
					db,
					`SELECT 1 FROM software_agreements WHERE id=? AND ${signingStatusIs(guards.signFrom)} AND text_sha256=? AND review_session_hash=?`,
					[document.id, document.text_sha256, guards.sessionTokenHash],
				),
				signatureStatement(db, document.signature),
				signingEvent(db, document.event),
				db
					.prepare(
						`UPDATE software_agreements SET status=${signingStatusLiteral(document.status)},client_signed_at=? WHERE id=?`,
					)
					.bind(document.client_signed_at, document.id),
			];
		}),
		db
			.prepare(
				"DELETE FROM software_agreement_drafts WHERE offer_id=? AND recipient_email=?",
			)
			.bind(write.draft.offer_id, write.draft.recipient_email),
		...write.notifications.map((notification) =>
			db
				.prepare(
					`INSERT INTO software_agreement_notifications(agreement_id,kind,email) VALUES(?,${notificationKindLiteral(notification.kind)},?)`,
				)
				.bind(notification.agreement_id, notification.email),
		),
	];
};

/** What a rejected signing batch is (see the head of this group). */
const signRefused = (cause: unknown) =>
	isUniqueViolation(cause) || foreignKeyFailed(cause)
		? new GuardRefused()
		: refusedBatch(cause);

/**
 * Stores the signature the rule wrote (`signDocuments`), binding its receipt, notice, signature and event ids; `sessionNow`
 * is the time A2 compares the session's expiry with, read by the flow as the batch is built (today's `sessionGuard` read
 * its own clock). Fails with `GuardRefused` for a guard, a UNIQUE or a FOREIGN KEY failure, `AgreementStoreFailed`
 * otherwise.
 */
export const signBatch = (write: SignWrite, sessionNow: string) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () => db.batch(signStatements(db, write, sessionNow)),
			catch: signRefused,
		});
	});

// ---- the owner's actions ----
//
// What the owner's actions on a request's signing read and write (POST /api/owner/requests/[id]/agreement: countersign,
// abandon, end, hold and record-alternate-copy), for the rules in src/server/rules/agreement-countersign.ts,
// agreement-abandon.ts and agreement-record.ts. Each statement is the route's own (src/pages/api/owner/requests/[id]/
// agreement.ts), or `countersignAgreements` and `closeObsoleteAgreementNotifications`' (src/lib/software-agreements.ts),
// in the same order statement for statement, with five reads changed so the rules decide what their SQL filtered:
//   - the request's sent offer becomes `readRequestOffers`, every version of the request with its status, in the offers
//     store's text (src/server/offers-store.ts, `readOffers`); the rules choose the sent one (`sentOfferOf`). Every
//     action reads it first, as the route does, and the golden hooks that picked today's `status='sent'` read are
//     re-pointed in PR 4 (the plan's section 9 lists them);
//   - the offer's agreements are `readOfferAgreements` above, with the abandoned ones (`offerAgreements` left them out;
//     the rules keep only the client-signed);
//   - the agreement an end, a hold or a copy record names also reads `archive_closed_at`, which the rules decide
//     ArchiveClosed on;
//   - the deposit check (A12's `depositUse`) and the open-offer check of an MSA (A13's `msaUse`) become plain reads of
//     every invoice of the offer and every offer that reuses the agreement, which the rules decide on. Their texts no
//     longer start as today's checks do, so the golden hooks that picked those checks are re-pointed in PR 4 (the plan's
//     section 9 lists them). Both conditions stay in their batches' guards as today's text.
// Each changed read names its table first, as today's did, so the operation and table a golden `trigger-hit` marker
// records for it (scripts/sql-effects.mjs, `statementOf`) stay today's.
// The signing setting is `readSigningEnabled` above, today's statement. tests/server/agreement-store-owner.test.ts holds
// every other text, and each batch's statements and values, to what the golden corpora recorded, and each changed text
// to the hook patterns that picked the old one, less the ones PR 4 re-points.
//
// Ids. Every id is an input: the flow draws them where today's code draws them, in the same order. Today countersign
// draws the receipt id, then, as it builds the batch, for each pending document in the order read, the signature's id,
// the `countersigned` event's and the obsolete-notice event's, in that order (`signatureInsert`, `agreementEvent`,
// `closeObsoleteAgreementNotifications`); abandon draws, for each document named in the order named, the `abandoned`
// event's id then the obsolete-notice event's; a hold and a copy record one event id each. The statuses the guards and
// moves name come from the machines (`AGREEMENT_MOVES`, `MESSAGE_MOVES`, `OFFER_MOVES.SUPERSEDE`). The events, the
// signatures, A8 and the FOREIGN KEY check are the shared ones near the top of the file.
//
// Failures. A rejected read is `AgreementStoreFailed`. A batch a guard (A8, A10 to A13) or a raise-only trigger (the
// cleanup lock on a closed archive) refused is `GuardRefused` (`refusedBatch`), and so are the rows another request wrote
// first: countersign's signature (one per agreement and party), packet and copy rows (their keys), and, for a hold or a
// copy record, the event's foreign key when the agreement was deleted since it was read (no other foreign key can fail
// there, so the failure is itself the evidence). Any other rejection is `AgreementStoreFailed`, an event id another row
// holds included (the ids are drawn at random). The client email snapshot a copy row needs is the rule's
// (RecipientMissing), so no batch here meets its NOT NULL.

const RequestOfferColumns = Schema.Struct({
	id: text,
	request_id: text,
	status: Schema.Literals(OFFER_STATUSES),
	contractor_snapshot_json: maybeText,
	recipient_email_snapshot: maybeText,
	reused_msa_id: maybeText,
});

const InvoiceColumns = Schema.Struct({
	milestone_index: Schema.Number,
	kind: text,
	status: text,
	refunded_at: maybeText,
});

const RecordAgreementColumns = Schema.Struct({
	status: text,
	kind: text,
	effective_on: text,
	client_signed_at: maybeText,
	executed_at: maybeText,
	archive_closed_at: maybeText,
});

const ReusingOfferColumns = Schema.Struct({
	status: text,
	request_status: text,
	project_offer_id: maybeText,
});

/** The one status an event sets from every status it is allowed from, as the machine answers it. */
function ownerMovedTo(
	machine: Parameters<typeof next>[0],
	from: readonly string[],
	event: string,
	known: readonly string[],
): string {
	const targets = [
		...new Set(from.map((status) => next(machine, status, event))),
	];

	const [target] = targets;

	if (targets.length !== 1 || target === undefined || target === null)
		throw new Error(`The move ${event} does not set one status.`);

	if (!known.includes(target))
		throw new Error(`Not a stored status: ${target}`);

	return target;
}

const COUNTERSIGN_FROM = statusIs(
	AGREEMENT_MOVES.COUNTERSIGN,
	AGREEMENT_STATUSES,
);

const COUNTERSIGN_TO = ownerMovedTo(
	agreementDocument,
	AGREEMENT_MOVES.COUNTERSIGN,
	"COUNTERSIGN",
	AGREEMENT_STATUSES,
);

const ABANDON_FROM = statusIs(AGREEMENT_MOVES.ABANDON, AGREEMENT_STATUSES);

const ABANDON_TO = ownerMovedTo(
	agreementDocument,
	AGREEMENT_MOVES.ABANDON,
	"ABANDON",
	AGREEMENT_STATUSES,
);

const END_FROM = statusIs(AGREEMENT_MOVES.END, AGREEMENT_STATUSES);

const OBSOLETE_FROM = statusIs(MESSAGE_MOVES.OBSOLETE, MESSAGE_STATUSES);

const OBSOLETE_TO = ownerMovedTo(
	agreementMessage,
	MESSAGE_MOVES.OBSOLETE,
	"OBSOLETE",
	MESSAGE_STATUSES,
);

const SUPERSEDE_FROM = statusIs(OFFER_MOVES.SUPERSEDE.from, OFFER_STATUSES);

/**
 * A12's condition, today's `depositUse`: a first-milestone deposit of the offer that may still be charged, or is paid and
 * not refunded. `abandonBlocked` (src/lib/software-deposit-block.ts) decides the same from the rows `readOfferDeposits`
 * reads, and the test holds the two to each other.
 */
const DEPOSIT_COUNTS =
	"SELECT 1 FROM software_invoices WHERE offer_id=? AND milestone_index=0 AND kind='deposit' AND (status IN ('creating','open','payment_failed','uncollectible') OR (status='paid' AND refunded_at IS NULL))";

/** A13's condition, today's `msaUse`: a draft or sent offer of an open request, with no project, reuses the MSA. */
const MSA_REUSED_OPEN =
	"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.reused_msa_id=? AND o.status IN ('draft','sent') AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)";

/** The rows another request wrote first that refuse a countersignature: its signature, packet or copy rows. */
const COUNTERSIGN_ROW_TAKEN =
	/UNIQUE constraint failed: software_agreement_(signatures|artifacts|deliveries)\./;

/** Runs one batch of the owner's actions; `refused` says whether a rejection was a refusal or the store's failure. */
const ownerBatch = (
	statements: (db: D1Database) => D1PreparedStatement[],
	refused: (cause: unknown) => GuardRefused | AgreementStoreFailed,
) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		yield* Effect.tryPromise({
			try: () => db.batch(statements(db)),
			catch: refused,
		});
	});

/** Countersign's refusals: a guard or a trigger (`refusedBatch`), or a signature, packet or copy row written first. */
const countersignRefused = (cause: unknown) =>
	cause instanceof Error && chainMatches(cause, COUNTERSIGN_ROW_TAKEN)
		? new GuardRefused()
		: refusedBatch(cause);

/** A hold's or a copy record's refusals: the cleanup lock (`refusedBatch`), or the agreement deleted since the read. */
const recordRefused = (cause: unknown) =>
	foreignKeyFailed(cause) ? new GuardRefused() : refusedBatch(cause);

/**
 * A21, as `closeObsoleteAgreementNotifications` writes it: the agreement's signing notices still sending are failed as
 * obsolete, with one `delivery-failed` event when there is one. A write-time filter that refuses nothing.
 */
const obsoleteNotices = (
	db: D1Database,
	agreementId: string,
	movedTo: string,
	actor: string,
	at: string,
	eventId: string,
) => [
	db
		.prepare(
			`INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at,reason) SELECT ?,?,'delivery-failed',?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_notifications WHERE agreement_id=? AND ${OBSOLETE_FROM})`,
		)
		.bind(
			eventId,
			agreementId,
			actor,
			at,
			`obsolete-signing-notice:${movedTo}`,
			agreementId,
		),
	db
		.prepare(
			`UPDATE software_agreement_notifications SET status='${OBSOLETE_TO}' WHERE agreement_id=? AND ${OBSOLETE_FROM}`,
		)
		.bind(agreementId),
];

/**
 * Plain read: every offer version of the request with its status, newest first, in the offers store's text
 * (src/server/offers-store.ts, `readOffers`). Every action reads it first, as the route reads the sent offer; which
 * version is sent is the rule's (`sentOfferOf`), and countersign's A10 keeps `status='sent'` as the re-check.
 */
export const readRequestOffers = (requestId: string) =>
	readAll(RequestOfferColumns, (db) =>
		db
			.prepare(
				"SELECT * FROM software_offers WHERE request_id=? ORDER BY version DESC",
			)
			.bind(requestId),
	).pipe(Effect.map((rows): readonly RequestOfferRow[] => rows));

/**
 * Plain read: every invoice of the offer, in id order, unfiltered, so the abandon's deposit decision is `abandonBlocked`'s.
 * Today's `depositUse` filtered them in SQL; A12 keeps that condition as the re-check.
 */
export const readOfferDeposits = (offerId: string) =>
	readAll(InvoiceColumns, (db) =>
		db
			.prepare(
				"SELECT milestone_index,kind,status,refunded_at FROM software_invoices WHERE offer_id=? ORDER BY id",
			)
			.bind(offerId),
	).pipe(Effect.map((rows): readonly OfferInvoiceRow[] => rows));

/** Plain read: the agreement with this id of this request (an end's, a hold's or a copy record's), or null. */
export const readAgreement = (agreementId: string, requestId: string) =>
	readAll(RecordAgreementColumns, (db) =>
		db
			.prepare(
				"SELECT status,kind,effective_on,client_signed_at,executed_at,archive_closed_at FROM software_agreements WHERE id=? AND request_id=?",
			)
			.bind(agreementId, requestId),
	).pipe(Effect.map((rows): RecordAgreementRow | null => rows[0] ?? null));

/**
 * Plain read: every offer that reuses the agreement as its MSA, in id order, with its request's status and its project's
 * offer id (null without one), unfiltered, so whether one is open is the rule's. Today's `msaUse` filtered them in SQL;
 * A13 keeps that condition as the re-check. `software_offers` is the first table the text names, as in `msaUse`, so a
 * golden hook's marker reads the same table; the projects are joined as their distinct offer ids, since several project
 * rows may name one offer and a plain join would repeat it.
 */
export const readMsaUse = (agreementId: string) =>
	readAll(ReusingOfferColumns, (db) =>
		db
			.prepare(
				"SELECT o.status,r.status AS request_status,p.offer_id AS project_offer_id FROM software_offers o JOIN owner_requests r ON r.id=o.request_id LEFT JOIN (SELECT DISTINCT offer_id FROM software_projects) p ON p.offer_id=o.id WHERE o.reused_msa_id=? ORDER BY o.id",
			)
			.bind(agreementId),
	).pipe(Effect.map((rows): readonly ReusingOfferRow[] => rows));

/** The ids today's countersign draws for one pending document, in the order it draws them. */
export type CountersignIds = {
	readonly signatureId: string;
	readonly eventId: string;
	readonly obsoleteEventId: string;
};

/**
 * The countersignature, one batch: A10 (the offer still sent, its request open, signing on), A8 when the offer reuses
 * an MSA; per pending document A11, its signature, the `countersigned` event, its obsolete notices (A21) and its move to
 * executed; a packet row per document; the SOW's two copies. `ids` holds each document's ids, in the order of
 * `write.documents`; a list of another length is a bug, so it dies.
 */
export const countersignBatch = (
	write: CountersignWrite,
	ids: readonly CountersignIds[],
) =>
	Effect.gen(function* () {
		if (ids.length !== write.documents.length)
			return yield* Effect.die(
				new Error("Countersign needs three ids per pending document."),
			);

		yield* ownerBatch(
			(db) => [
				softwareGuard(
					db,
					"SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND r.status NOT IN ('withdrawn','resolved') AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)",
					[write.offerId],
				),
				...(write.reusedMsaId === null
					? []
					: [reusedMsaGuard(db, write.reusedMsaId)]),
				...write.documents.flatMap((document, index) => {
					// SAFETY: the lengths were compared above, so every document has its ids.
					const drawn = ids[index] as CountersignIds;

					return [
						softwareGuard(
							db,
							`SELECT 1 FROM software_agreements WHERE id=? AND ${COUNTERSIGN_FROM} AND text_sha256=?`,
							[document.id, document.hash],
						),
						signatureStatement(db, {
							id: drawn.signatureId,
							...document.signature,
						}),
						signingEvent(db, {
							id: drawn.eventId,
							agreement_id: document.id,
							offer_id: write.offerId,
							action: "countersigned",
							actor: write.actor,
							occurred_at: write.at,
							reason: null,
						}),
						...obsoleteNotices(
							db,
							document.id,
							COUNTERSIGN_TO,
							write.actor,
							write.at,
							drawn.obsoleteEventId,
						),
						db
							.prepare(
								`UPDATE software_agreements SET status='${COUNTERSIGN_TO}',executed_at=? WHERE id=?`,
							)
							.bind(write.at, document.id),
					];
				}),
				...write.packets.map((agreementId) =>
					db
						.prepare(
							"INSERT INTO software_agreement_artifacts(agreement_id) VALUES(?)",
						)
						.bind(agreementId),
				),
				...write.copies.map((copy) =>
					db
						.prepare(
							"INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email) VALUES(?,?,?)",
						)
						.bind(copy.agreement_id, copy.recipient_role, copy.email),
				),
			],
			countersignRefused,
		);
	});

/** The ids today's abandon draws for one document named, in the order it draws them. */
export type AbandonIds = {
	readonly eventId: string;
	readonly obsoleteEventId: string;
};

/**
 * The abandon, one batch: A12 (no first deposit of the offer counts); per document named A11 (still client_signed with
 * its hash, of this request and offer), its move to abandoned with the reason, the `abandoned` event and its obsolete
 * notices (A21); then the offer superseded, the request's offer link revoked, the offer's signing sessions revoked, its
 * signing links used and its drafts deleted, write-time filters that refuse nothing, as today. `ids` holds each
 * document's ids, in the order of `write.documents`; a list of another length is a bug, so it dies.
 */
export const abandonBatch = (write: AbandonWrite, ids: readonly AbandonIds[]) =>
	Effect.gen(function* () {
		if (ids.length !== write.documents.length)
			return yield* Effect.die(
				new Error("Abandon needs two ids per document named."),
			);

		yield* ownerBatch(
			(db) => [
				softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${DEPOSIT_COUNTS})`, [
					write.offerId,
				]),
				...write.documents.flatMap((document, index) => {
					// SAFETY: the lengths were compared above, so every document has its ids.
					const drawn = ids[index] as AbandonIds;

					return [
						softwareGuard(
							db,
							`SELECT 1 FROM software_agreements WHERE id=? AND request_id=? AND offer_id=? AND text_sha256=? AND ${ABANDON_FROM}`,
							[document.id, write.requestId, write.offerId, document.hash],
						),
						db
							.prepare(
								`UPDATE software_agreements SET status='${ABANDON_TO}',abandoned_at=?,abandoned_reason=? WHERE id=?`,
							)
							.bind(write.at, write.reason, document.id),
						signingEvent(db, {
							id: drawn.eventId,
							agreement_id: document.id,
							offer_id: write.offerId,
							action: "abandoned",
							actor: write.actor,
							occurred_at: write.at,
							reason: "owner-abandoned",
						}),
						...obsoleteNotices(
							db,
							document.id,
							ABANDON_TO,
							write.actor,
							write.at,
							drawn.obsoleteEventId,
						),
					];
				}),
				db
					.prepare(
						`UPDATE software_offers SET status='${OFFER_MOVES.SUPERSEDE.to}',updated_at=? WHERE id=? AND ${SUPERSEDE_FROM}`,
					)
					.bind(write.at, write.offerId),
				db
					.prepare(
						"UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL",
					)
					.bind(write.at, write.requestId),
				db
					.prepare(
						"UPDATE software_agreement_sessions SET revoked_at=? WHERE offer_id=? AND revoked_at IS NULL",
					)
					.bind(write.at, write.offerId),
				db
					.prepare(
						"UPDATE software_agreement_links SET used_at=? WHERE offer_id=? AND used_at IS NULL",
					)
					.bind(write.at, write.offerId),
				db
					.prepare("DELETE FROM software_agreement_drafts WHERE offer_id=?")
					.bind(write.offerId),
			],
			refusedBatch,
		);
	});

/**
 * The end, one batch: A13 first for an MSA (no open offer reuses it), then the update, which A14 filters (it changes the
 * row only while it is executed or abandoned; otherwise nothing, and no failure). The CASE is today's: it writes
 * `terminated_at` for an MSA only, the day `terminatedOn` names, so the store binds the end date there as today does for
 * every kind (a SOW's `terminatedOn` is null, which the CASE never reads). No event.
 */
export const endBatch = (write: EndWrite) =>
	ownerBatch(
		(db) => [
			...(write.guardsMsaUse
				? [
						softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${MSA_REUSED_OPEN})`, [
							write.agreementId,
						]),
					]
				: []),
			db
				.prepare(
					`UPDATE software_agreements SET ended_at=?,retain_until=?,terminated_at=CASE WHEN kind='msa' THEN ? ELSE terminated_at END WHERE id=? AND ${END_FROM}`,
				)
				.bind(
					write.endedOn,
					write.retainUntil,
					write.endedOn,
					write.agreementId,
				),
		],
		refusedBatch,
	);

/** The hold, one batch: `legal_hold` and the `hold-changed` event, with the id the flow drew. */
export const holdBatch = (write: HoldWrite, eventId: string) =>
	ownerBatch(
		(db) => [
			db
				.prepare("UPDATE software_agreements SET legal_hold=? WHERE id=?")
				.bind(write.legalHold, write.agreementId),
			signingEvent(db, {
				id: eventId,
				agreement_id: write.agreementId,
				offer_id: null,
				action: write.event,
				actor: write.actor,
				occurred_at: write.at,
				reason: null,
			}),
		],
		recordRefused,
	);

/**
 * The copy record, one batch: the copy row's alternate delivery and method (a row that does not exist changes nothing)
 * and the `copy-delivered` event, with the id the flow drew.
 */
export const recordCopyBatch = (write: CopyRecordWrite, eventId: string) =>
	ownerBatch(
		(db) => [
			db
				.prepare(
					"UPDATE software_agreement_deliveries SET alternate_delivered_at=?,alternate_method=? WHERE agreement_id=? AND recipient_role=?",
				)
				.bind(write.at, write.method, write.agreementId, write.role),
			signingEvent(db, {
				id: eventId,
				agreement_id: write.agreementId,
				offer_id: null,
				action: write.event,
				actor: write.actor,
				occurred_at: write.at,
				reason: null,
			}),
		],
		recordRefused,
	);
