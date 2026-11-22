// What the owner's software request actions (POST /api/owner/requests/[id]/software) read from and write to MUSIC_DB
// (the MusicDb service), one function per statement or batch the route runs, in the order of
// docs/plans/2026-11-offers-conversion.md, section 4. A read returns facts (rows, columns, or whether a row exists), and
// the rules in src/server/rules decide from them. Where today's route asks a question in SQL (a live link made since the
// start of the sending window, an offer left in the WITHDRAW list, an MSA the offer may reuse, an attachment's row with
// these columns, a link still live), the store keeps that text, so the golden corpus records the same statement; which
// refusal the answer leads to, and in what order, stays in the rules. The reads it adds for conditions only a guard
// checked before ask what that guard asks (G3's signed statuses, G6's audio project, G11's rows and closed archives). A
// batch stores what a rule decided, and its only SQL that can refuse is the compare-and-set guards (G1 to G11 of the
// design), which re-check at write time what the rule read; the status lists those guards and writes name come from the
// offer version machine (`OFFER_MOVES`, src/server/machines/offer-version.ts).
//
// The SQL text is the route's own wherever the golden corpus (tests/golden/owner-request-software-*.test.ts) recorded it,
// because its hooks pick statements by pattern and count matches, with three recorded texts changed: the deposit read
// (every invoice of the request, unfiltered, for the rule to decide on), the withdraw (its IN list in the machine's
// order) and mark sent (which gains `AND status='draft'` from SEND). tests/server/offers-store.test.ts lists each change
// with its reason and each read this store adds, holds every other text to the fixtures, each changed text to the
// patterns its old text matched, and each added read to matching none.
//
// Failures. Any rejection of a read, or of a batch that no guard refused, is an `OffersStoreFailed` carrying what the
// database raised in `failure`, which the route logs once (logUnexpected) before its fixed answer. A batch a guard refused
// is `GuardRefused`: another request changed what this one read, which the route answers with the reads after a refused
// batch (src/server/rules/offer-refused-batch.ts), never by trying again. The draft's batch is the one exception: its
// unique indexes, one version number per request and one open draft, back what the draft rule numbered from the offers it
// read, so their violation is `ChangedSinceRead` and `decideAndSave` (src/server/guarded-save.ts) reads and decides again,
// three tries in all; and the foreign key of the MSA a draft reuses is `GuardRefused` only on evidence of the race read
// afterwards (the MSA's row gone), as before.
//
// No statement reads the clock: the start of the 20-second sending window (G5) is a parameter, which the flows read from
// the clock (`offerSendingSince`) at the points the route always read it.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { AgreementTemplate } from "../lib/agreement-templates";
import {
	type OwnerRequest,
	type OwnerRequestRow,
	ownerRequestFromRow,
	requestColumns,
} from "../lib/owner-model";
import type { DepositInvoice } from "../lib/software-deposit-block";
import { isText } from "../lib/type-guards";
import { softwareGuard } from "../lib/software-guard";
import { depositOfferGuard } from "../lib/software-offer-deposit";
import {
	offerIsSending,
	offerSendingGuard,
	type SoftwareOffer,
} from "../lib/software-offers";
import {
	OFFER_MOVES,
	OFFER_STATUSES,
	type OfferStatus,
} from "./machines/offer-version";
import {
	REQUEST_STATUSES,
	type RequestStatus,
} from "./machines/software-request";
import {
	ChangedSinceRead,
	GuardRefused,
	isUniqueViolation,
	raisedByJsonGuard,
} from "./guarded-save";
import type { DeclineWrite, ResolveWrite } from "./rules/offer-decline";
import type { DraftWrite, RemovedAttachment } from "./rules/offer-draft";
import type { FitWrite } from "./rules/offer-fit";
import type { ContractorConfig } from "./rules/offer-pin";
import type { QuestionWrite } from "./rules/offer-question";
import type { LinkRow, RevokeWrite } from "./rules/offer-revoke";
import type { SendWrite } from "./rules/offer-send";
import type {
	AttachmentRow,
	ClosedArchives,
	NamedAttachment,
	RequestRead,
	SigningRetired,
} from "./rules/software-request";
import { MusicDb } from "./services";

/** The music database failed, and nothing says another request changed what this one read. `failure` is for the log. */
export class OffersStoreFailed extends Data.TaggedError("OffersStoreFailed")<{
	readonly failure: unknown;
}> {}

/** A compare-and-set guard refused the batch (GuardRefused, src/server/guarded-save.ts), which the store's callers name. */
export { GuardRefused };

/** Runs one database call; a rejection is an OffersStoreFailed. */
const asked = <A>(run: (db: D1Database) => Promise<A>) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => run(db),
			catch: (failure) => new OffersStoreFailed({ failure }),
		});
	});

/** Whether a failed batch was refused by one of its guards (the guard form raises "malformed JSON"). */
const refusedByGuard = <Failure>(failure: Failure) =>
	failure instanceof Error && raisedByJsonGuard(failure);

/**
 * Runs one batch. A guard that refused it is GuardRefused; any other rejection, a unique violation included (no batch but
 * the draft's has a unique index that backs a rule's fact), is an OffersStoreFailed.
 */
const saved = (statements: (db: D1Database) => D1PreparedStatement[]) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;

		return yield* Effect.tryPromise({
			try: () => db.batch(statements(db)),
			catch: (failure) =>
				refusedByGuard(failure)
					? new GuardRefused()
					: new OffersStoreFailed({ failure }),
		});
	});

// ---- the statements batches share ----

/** The offers area's guard: the batch rolls back unless `query` finds a row. */
const guard = (db: D1Database, query: string, values: (string | number)[]) =>
	db
		.prepare(
			`SELECT CASE WHEN EXISTS(${query}) THEN 1 ELSE json_extract('Offer changed. Reload and try again.','$') END`,
		)
		.bind(...values);

/** A status the machine names, written into SQL as a literal; anything else is a bug, never a value from a request. */
function literal<S extends string>(status: S, known: readonly S[]): string {
	if (!known.includes(status))
		throw new Error(`Not a status the machines name: ${status}`);

	return `'${status}'`;
}

/** `status='x'` for one status, `status IN ('x','y')` for several, in the order given. */
export function statusIs(statuses: readonly OfferStatus[]): string {
	const quoted = statuses.map((status) => literal(status, OFFER_STATUSES));

	if (quoted.length === 0)
		throw new Error("A move with no status to move from.");

	return quoted.length === 1
		? `status=${quoted[0]}`
		: `status IN (${quoted.join(",")})`;
}

/** G1: the request row still has the updated_at, status and email that were read. */
const requestUnchanged = (db: D1Database, request: RequestRead) =>
	guard(
		db,
		"SELECT 1 FROM owner_requests WHERE id=? AND updated_at=? AND status=? AND email=?",
		[request.id, request.updatedAt, request.status, request.email],
	);

/** G2: no project has started for the request. */
const noProject = (db: D1Database, requestId: string) =>
	guard(
		db,
		"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_projects WHERE request_id=?)",
		[requestId],
	);

/** G3: no agreement of the request is client_signed or executed (the project area's guard form). */
const noSignedAgreement = (db: D1Database, requestId: string) =>
	softwareGuard(
		db,
		"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements WHERE request_id=? AND status IN ('client_signed','executed'))",
		[requestId],
	);

/** G6: no audio project for the request. */
const noAudioProject = (db: D1Database, requestId: string) =>
	guard(
		db,
		"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM audio_projects WHERE request_id=?)",
		[requestId],
	);

/**
 * G11: the attachment has its metadata row of the request, unchanged, and is named in no closed archive, or a closed
 * archive whose manifest cannot be read (its `json_each` or `json_extract` raises "malformed JSON", which refuses the
 * batch as the guard does).
 */
const attachmentUnchanged = (
	db: D1Database,
	requestId: string,
	attachment: NamedAttachment,
) =>
	guard(
		db,
		`SELECT 1 FROM software_agreement_attachments f WHERE f.request_id=? AND f.object_key=? AND f.sha256=? AND f.bytes=? AND f.filename=? AND f.version=? AND f.document_date=?
      AND NOT EXISTS(SELECT 1 FROM software_agreements a,json_each(a.attachment_manifest_json) m WHERE a.archive_closed_at IS NOT NULL AND json_extract(m.value,'$.key')=f.object_key)`,
		[
			requestId,
			attachment.key,
			attachment.sha256,
			attachment.bytes,
			attachment.filename,
			attachment.version,
			attachment.date,
		],
	);

/** The request's updated_at set to `at`. */
const touchRequest = (db: D1Database, requestId: string, at: string) =>
	db
		.prepare("UPDATE owner_requests SET updated_at=? WHERE id=?")
		.bind(at, requestId);

/** One row of the request's audit. */
const audit = (
	db: D1Database,
	requestId: string,
	entry: {
		readonly action: string;
		readonly actor: string;
		readonly at: string;
		readonly note?: string;
	},
) =>
	db
		.prepare(
			"INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at) VALUES (?,?,?,?,?)",
		)
		.bind(requestId, entry.action, entry.actor, entry.note ?? "", entry.at);

/**
 * Signing retired: the request's reviews abandoned (kept until the time the rule gave), its saved agreement drafts
 * deleted, its signing sessions revoked and its sign-in links used. The statements of `retireRequestSigning`
 * (src/lib/software-agreements.ts), with the retention the rule decided; a test holds the two to the same SQL and values.
 */
export const retireSigning = (
	db: D1Database,
	requestId: string,
	signing: SigningRetired,
) => [
	db
		.prepare(
			"UPDATE software_agreements SET status='abandoned',abandoned_at=?,abandoned_reason='Offer link changed',ended_at=?,retain_until=? WHERE request_id=? AND status='review'",
		)
		.bind(signing.at, signing.at, signing.retainUntil, requestId),
	db
		.prepare(
			"DELETE FROM software_agreement_drafts WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?)",
		)
		.bind(requestId),
	db
		.prepare(
			"UPDATE software_agreement_sessions SET revoked_at=? WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?) AND revoked_at IS NULL",
		)
		.bind(signing.at, requestId),
	db
		.prepare(
			"UPDATE software_agreement_links SET used_at=? WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id=?) AND used_at IS NULL",
		)
		.bind(signing.at, requestId),
];

// ---- reads every action shares ----

/**
 * The request with this id, or null. Its details are parsed as they are read, so a request whose stored details are not
 * JSON fails the read (an OffersStoreFailed carrying the SyntaxError), as `getOwnerRequest` always has.
 */
export const readRequest = (id: string) =>
	asked(async (db): Promise<OwnerRequest | null> => {
		const row = await db
			.prepare(`SELECT ${requestColumns} FROM owner_requests WHERE id=?`)
			.bind(id)
			.first<OwnerRequestRow>();

		return row ? ownerRequestFromRow(row) : null;
	});

/** Whether a project has started for the request. */
export const readProjectStarted = (requestId: string) =>
	asked(
		async (db) =>
			(await db
				.prepare("SELECT 1 FROM software_projects WHERE request_id=?")
				.bind(requestId)
				.first()) !== null,
	);

/** Every offer version of the request, newest first. */
export const readOffers = (requestId: string) =>
	asked(
		async (db): Promise<readonly SoftwareOffer[]> =>
			(
				await db
					.prepare(
						"SELECT * FROM software_offers WHERE request_id=? ORDER BY version DESC",
					)
					.bind(requestId)
					.all<SoftwareOffer>()
			).results,
	);

/** Whether a live link of the request was made after `since` (the start of the sending window the flow read). */
export const readFreshLiveLink = (requestId: string, since: string) =>
	asked((db) => offerIsSending(db, requestId, since));

/** The columns of an invoice the two deposit statements read between them. */
type DepositColumns = {
	readonly status?: string;
	readonly offer_status?: string;
	readonly milestone_index?: number;
	readonly kind?: string;
	readonly refunded_at?: string | null;
};

/**
 * Every invoice of the request with its offer's status, unfiltered, so the whole deposit decision is the rule's
 * (`depositBlock`, src/lib/software-deposit-block.ts, whose contract LemmaScript proves): an invoice joins its offer (the
 * INNER JOIN of the guard G4), and `refunded` is a refund recorded. Read as two statements in one batch (one snapshot),
 * each ordered by the invoice's id: the first keeps the text the golden hooks name
 * (`SELECT i.status,o.status AS offer_status FROM software_invoices`), which leaves no room for a third column in its
 * list, and the second reads the milestone, kind and refund of the same rows in the same order.
 * tests/server/offers-store.test.ts feeds what this reads to the rule and holds the answer to `depositOfferBlock` for
 * every invoice the columns allow and every pair of first deposits.
 */
export const readDepositInvoices = (requestId: string) =>
	asked(async (db): Promise<readonly DepositInvoice[]> => {
		const [statuses, terms] = await db.batch<DepositColumns>([
			db
				.prepare(
					"SELECT i.status,o.status AS offer_status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id WHERE i.request_id=? ORDER BY i.id",
				)
				.bind(requestId),
			db
				.prepare(
					"SELECT i.milestone_index,i.kind,i.refunded_at FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id WHERE i.request_id=? ORDER BY i.id",
				)
				.bind(requestId),
		]);

		const rows = statuses?.results ?? [];
		const more = terms?.results ?? [];

		if (rows.length !== more.length)
			throw new Error("The two deposit reads disagree on the invoices.");

		return rows.map((row, index) => {
			const rest = more[index];

			if (
				rest === undefined ||
				row.status === undefined ||
				row.offer_status === undefined ||
				rest.milestone_index === undefined ||
				rest.kind === undefined ||
				rest.refunded_at === undefined
			)
				throw new Error("A deposit read is missing a column.");

			return {
				milestoneIndex: rest.milestone_index,
				kind: rest.kind,
				status: row.status,
				refunded: rest.refunded_at !== null,
				offerStatus: row.offer_status,
			};
		});
	});

/** Whether the request has an agreement that is client_signed or executed (what G3 re-checks). */
export const readSignedAgreement = (requestId: string) =>
	asked(
		async (db) =>
			(await db
				.prepare(
					"SELECT 1 FROM software_agreements WHERE request_id=? AND status IN ('client_signed','executed')",
				)
				.bind(requestId)
				.first()) !== null,
	);

/** Whether the request has an audio project (what G6 re-checks). */
export const readAudioProject = (requestId: string) =>
	asked(
		async (db) =>
			(await db
				.prepare("SELECT 1 FROM audio_projects WHERE request_id=?")
				.bind(requestId)
				.first()) !== null,
	);

/** The request's link row (one per request), or null: revoke's check, and a reissue's (G9). */
export const readLinkRow = (requestId: string) =>
	asked((db) =>
		db
			.prepare(
				"SELECT created_at,revoked_at FROM software_offer_links WHERE request_id=?",
			)
			.bind(requestId)
			.first<LinkRow>(),
	);

// ---- fit ----

/** The fit batch: G1, the review upserted, the request's updated_at, the audit, all at the write time. */
export const saveFit = (write: FitWrite) =>
	saved((db) => [
		requestUnchanged(db, write.request),
		db
			.prepare(`INSERT INTO software_fit_reviews(request_id,label,note,updated_at,updated_by) VALUES (?,?,?,?,?)
        ON CONFLICT(request_id) DO UPDATE SET label=excluded.label,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
			.bind(write.request.id, write.label, write.note, write.at, write.actor),
		touchRequest(db, write.request.id, write.at),
		audit(db, write.request.id, {
			action: write.audit,
			actor: write.actor,
			at: write.at,
		}),
	]);

// ---- question ----

/** The question's reservation, before the email: G1, G2 and the request's updated_at set to the write time. */
export const reserveQuestion = (write: QuestionWrite) =>
	saved((db) => [
		requestUnchanged(db, write.request),
		noProject(db, write.request.id),
		touchRequest(db, write.request.id, write.at),
	]);

/** The question's record, after the client email: G1 with the updated_at the reservation wrote, G2 and the audit. */
export const recordQuestion = (write: QuestionWrite) =>
	saved((db) => [
		requestUnchanged(db, { ...write.request, updatedAt: write.at }),
		noProject(db, write.request.id),
		audit(db, write.request.id, {
			action: write.audit,
			actor: write.actor,
			at: write.at,
		}),
	]);

// ---- decline ----

/**
 * The decline's first batch, before the email: G3, G1, G5 (no live link made after `since`), G4 (a deposit that may still
 * be charged), G6, G2; the draft and sent offers withdrawn (the WITHDRAW move); signing retired; the live links revoked;
 * the request's updated_at; the audit.
 */
export const withdrawForDecline = (write: DeclineWrite, since: string) =>
	saved((db) => [
		noSignedAgreement(db, write.request.id),
		requestUnchanged(db, write.request),
		offerSendingGuard(db, write.request.id, since),
		depositOfferGuard(db, write.request.id, true),
		noAudioProject(db, write.request.id),
		noProject(db, write.request.id),
		db
			.prepare(
				`UPDATE software_offers SET status=${literal(write.withdraw.to, OFFER_STATUSES)},updated_at=? WHERE request_id=? AND ${statusIs(write.withdraw.from)}`,
			)
			.bind(write.at, write.request.id),
		...retireSigning(db, write.request.id, write.signing),
		db
			.prepare(
				"UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL",
			)
			.bind(write.at, write.request.id),
		touchRequest(db, write.request.id, write.at),
		audit(db, write.request.id, {
			action: write.audit.action,
			actor: write.actor,
			at: write.at,
			note: write.audit.note,
		}),
	]);

/** The statement F10's read and guard share: an offer of the request in one of `statuses` (the decline's WITHDRAW list). */
const offerIn = (statuses: readonly OfferStatus[]) =>
	`SELECT 1 FROM software_offers WHERE request_id=? AND ${statusIs(statuses)}`;

/** After the decline's email: whether an offer of the request is still in one of `statuses` (F10, #331). */
export const readOfferLeft = (
	requestId: string,
	statuses: readonly OfferStatus[] = OFFER_MOVES.WITHDRAW.from,
) =>
	asked(
		async (db) =>
			(await db.prepare(offerIn(statuses)).bind(requestId).first()) !== null,
	);

/**
 * The decline's second batch, after the client email: G1 with the updated_at the first batch wrote, G2, G5, G6, no offer
 * left in the WITHDRAW list (F10), the request moved to the status the machine landed on, and the audit.
 */
export const resolveDeclined = (write: ResolveWrite, since: string) =>
	saved((db) => [
		requestUnchanged(db, write.request),
		noProject(db, write.request.id),
		offerSendingGuard(db, write.request.id, since),
		noAudioProject(db, write.request.id),
		guard(db, `SELECT 1 WHERE NOT EXISTS(${offerIn(write.noOfferIn)})`, [
			write.request.id,
		]),
		db
			.prepare(
				`UPDATE owner_requests SET status=${literal<RequestStatus>(write.status, REQUEST_STATUSES)},resolved_at=?,updated_at=? WHERE id=?`,
			)
			.bind(write.at, write.at, write.request.id),
		audit(db, write.request.id, {
			action: write.audit,
			actor: write.actor,
			at: write.at,
		}),
	]);

// ---- revoke ----

/**
 * The revoke batch: G1, signing retired, G5 (no live link made after `since`), G10 (the page's link is still live), the
 * page's link revoked, and the audit.
 */
export const revokeOfferLink = (write: RevokeWrite, since: string) =>
	saved((db) => [
		requestUnchanged(db, write.request),
		...retireSigning(db, write.request.id, write.signing),
		offerSendingGuard(db, write.request.id, since),
		guard(
			db,
			"SELECT 1 FROM software_offer_links WHERE request_id=? AND created_at=? AND revoked_at IS NULL",
			[write.request.id, write.linkCreatedAt],
		),
		db
			.prepare(
				"UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND created_at=? AND revoked_at IS NULL",
			)
			.bind(write.at, write.request.id, write.linkCreatedAt),
		audit(db, write.request.id, {
			action: write.audit.action,
			actor: write.actor,
			at: write.at,
			note: write.audit.note,
		}),
	]);

/** After a refused revoke: whether the link with the page's created_at is still live. */
export const readLinkLive = (requestId: string, createdAt: string) =>
	asked(
		async (db) =>
			(await db
				.prepare(
					"SELECT 1 FROM software_offer_links WHERE request_id=? AND created_at=? AND revoked_at IS NULL",
				)
				.bind(requestId, createdAt)
				.first()) !== null,
	);

// ---- draft ----

/** The metadata rows of the attachments the draft removes, every column (kept to put a row back), of this request. */
export const readRemovedAttachments = (
	requestId: string,
	keys: readonly string[],
) =>
	asked(
		async (db): Promise<readonly RemovedAttachment[]> =>
			(
				await db
					.prepare(
						"SELECT * FROM software_agreement_attachments WHERE request_id=? AND object_key IN (SELECT value FROM json_each(?))",
					)
					.bind(requestId, JSON.stringify(keys))
					.all<RemovedAttachment>()
			).results,
	);

/** The request's metadata rows for these keys, with the columns G11 compares (what `attachmentsUsable` reads). */
export const readAttachmentRows = (
	requestId: string,
	keys: readonly string[],
) =>
	asked(
		async (db): Promise<readonly AttachmentRow[]> =>
			(
				await db
					.prepare(
						"SELECT object_key,sha256,bytes,filename,version,document_date FROM software_agreement_attachments WHERE request_id=? AND object_key IN (SELECT value FROM json_each(?))",
					)
					.bind(requestId, JSON.stringify(keys))
					.all<AttachmentRow>()
			).results,
	);

/** No closed archive read: what the draft and send decide from when no attachment is named. */
const NO_CLOSED_ARCHIVES: ClosedArchives = { keys: [], unreadable: false };

/**
 * The closed archives G11 covers, for these keys: which of them a manifest names, and whether a manifest, or an entry of
 * one, is not JSON, where G11's `json_each` or `json_extract` raises "malformed JSON" and so refuses its batch. Only the
 * agreements whose archive is closed count, as in G11's predicate, and `json_valid` passes over every value that is not
 * JSON before anything parses it, so stored data never fails the read. With no key there is no G11 in the batch, so
 * nothing is read.
 *
 * Where the two can differ: plain `json_valid` accepts only strict JSON text, while G11's `json_each` and `json_extract`
 * also accept JSON5, JSONB blobs and infinite numbers (such as `[1e400]`), so for such a stored value this read says
 * unreadable, and the rule refuses, where G11 would pass. The site cannot write one: a manifest is `JSON.stringify` of
 * validated attachments. `json_valid(x,6)` would match G11, but it needs SQLite 3.45 or later and production D1's
 * version is not verified, so the strict form is kept.
 */
export const readClosedArchives = (
	keys: readonly string[],
): Effect.Effect<ClosedArchives, OffersStoreFailed, MusicDb> =>
	keys.length === 0
		? Effect.succeed(NO_CLOSED_ARCHIVES)
		: asked(async (db) => {
				const { results } = await db
					.prepare(
						"SELECT DISTINCT object_key,unreadable FROM (SELECT CASE WHEN json_valid(m.value) THEN json_extract(m.value,'$.key') END AS object_key,NOT json_valid(a.attachment_manifest_json) OR (m.value IS NOT NULL AND NOT json_valid(m.value)) AS unreadable FROM software_agreements a LEFT JOIN json_each(CASE WHEN json_valid(a.attachment_manifest_json) THEN a.attachment_manifest_json END) m WHERE a.archive_closed_at IS NOT NULL) WHERE unreadable OR object_key IN (SELECT value FROM json_each(?))",
					)
					.bind(JSON.stringify(keys))
					.all<{ object_key: string | null; unreadable: number }>();

				return {
					keys: results.flatMap((row) =>
						row.object_key === null ? [] : [row.object_key],
					),
					unreadable: results.some((row) => row.unreadable === 1),
				};
			});

/** Whether an agreement with this id exists: the MSA a draft reuses, read before the batch and, after a foreign key failure, as evidence of a race. */
export const readMsaExists = (id: string) =>
	asked(
		async (db) =>
			(await db
				.prepare("SELECT 1 FROM software_agreements WHERE id=?")
				.bind(id)
				.first()) !== null,
	);

/** The draft batch's foreign key failed, and the draft reuses an MSA: whether that MSA is gone is read next. */
class ReusedMsaRefused extends Data.TaggedError("ReusedMsaRefused")<{
	readonly failure: unknown;
	readonly msaId: string;
}> {}

/** What the draft batch answers: the removed attachments' keys its deletes returned (a row nothing names any more). */
export type DraftSaved = { readonly deletedKeys: readonly string[] };

const draftStatements = (db: D1Database, write: DraftWrite) => {
	const requestId = write.request.id;

	return [
		requestUnchanged(db, write.request),
		noProject(db, requestId),
		...(write.save.kind === "update"
			? [
					guard(
						db,
						`SELECT 1 FROM software_offers WHERE id=? AND ${statusIs(write.save.move.from)} AND updated_at=?`,
						[write.id, write.save.expectedUpdatedAt],
					),
					db
						.prepare(
							`UPDATE software_offers SET terms_json=?,updated_at=? WHERE id=? AND ${statusIs(write.save.move.from)}`,
						)
						.bind(write.termsJson, write.at, write.id),
				]
			: [
					db
						.prepare(
							"INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES (?,?,?,'draft',?,?,?)",
						)
						.bind(
							write.id,
							requestId,
							write.save.version,
							write.termsJson,
							write.at,
							write.at,
						),
				]),
		...write.attachments.map((attachment) =>
			attachmentUnchanged(db, requestId, attachment),
		),
		...(write.details === null
			? []
			: [
					db
						.prepare(
							"UPDATE software_offers SET agreement_details_json=? WHERE id=?",
						)
						.bind(write.details.json, write.id),
				]),
		...(write.reusedMsa === null
			? []
			: [
					db
						.prepare("UPDATE software_offers SET reused_msa_id=? WHERE id=?")
						.bind(write.reusedMsa.id, write.id),
				]),
		audit(db, requestId, {
			action: write.audit,
			actor: write.actor,
			at: write.at,
		}),
		...write.removed.map((attachment) =>
			db
				.prepare(`DELETE FROM software_agreement_attachments WHERE id=? AND request_id=?
          AND NOT EXISTS(SELECT 1 FROM software_offers o,json_each(o.agreement_details_json,'$.attachments') item WHERE json_extract(item.value,'$.key')=software_agreement_attachments.object_key)
          AND NOT EXISTS(SELECT 1 FROM software_agreements a,json_each(a.attachment_manifest_json) item WHERE json_extract(item.value,'$.key')=software_agreement_attachments.object_key) RETURNING object_key`)
				.bind(attachment.id, requestId),
		),
	];
};

/**
 * The draft batch: G1, G2, G7 and the open draft's terms (or the new version inserted), G11 per named attachment, the
 * details and the reused MSA as the rule wrote them, the audit, and each removed attachment's row deleted when no offer's
 * details and no agreement's manifest name it (the delete's own `NOT EXISTS`, which refuses nothing). A unique index is
 * ChangedSinceRead (see the head of this file); a refused guard, or stored JSON a `json_each` cannot read, GuardRefused; a
 * foreign key failure while the draft reuses an MSA is GuardRefused when that MSA's row is gone, read afterwards, and an
 * OffersStoreFailed when it is not (or when that read fails).
 */
export const saveDraftBatch = (write: DraftWrite) =>
	Effect.gen(function* () {
		const db = yield* MusicDb;
		const msaId = write.reusedMsa?.id ?? null;

		const results = yield* Effect.tryPromise({
			try: () => db.batch<{ object_key?: unknown }>(draftStatements(db, write)),
			catch: (failure) => {
				if (isUniqueViolation(failure)) return new ChangedSinceRead();

				if (refusedByGuard(failure)) return new GuardRefused();

				return msaId !== null &&
					failure instanceof Error &&
					/FOREIGN KEY/.test(failure.message)
					? new ReusedMsaRefused({ failure, msaId })
					: new OffersStoreFailed({ failure });
			},
		});

		const deletes = results.slice(results.length - write.removed.length);

		return {
			deletedKeys: deletes.flatMap((result) =>
				result.results.flatMap((row) =>
					isText(row.object_key) ? [row.object_key] : [],
				),
			),
		} satisfies DraftSaved;
	}).pipe(
		Effect.catchTag("ReusedMsaRefused", (refused) =>
			readMsaExists(refused.msaId).pipe(
				Effect.flatMap((exists) =>
					Effect.fail(
						exists
							? new OffersStoreFailed({ failure: refused.failure })
							: new GuardRefused(),
					),
				),
			),
		),
	);

/** Puts back the metadata row of a removed attachment whose R2 object could not be deleted (a row already there stays). */
export const restoreAttachment = (row: RemovedAttachment) =>
	asked((db) =>
		db
			.prepare(
				"INSERT OR IGNORE INTO software_agreement_attachments VALUES(?,?,?,?,?,?,?,?,?,?)",
			)
			.bind(
				row.id,
				row.request_id,
				row.filename,
				row.version,
				row.document_date,
				row.object_key,
				row.sha256,
				row.bytes,
				row.created_at,
				row.created_by,
			)
			.run(),
	).pipe(Effect.asVoid);

// ---- send ----

/** Whether software signing is switched on. */
export const readSigningEnabled = () =>
	asked(async (db) =>
		Boolean(
			(
				await db
					.prepare(
						"SELECT software_signing_enabled FROM software_signing_settings WHERE id=1",
					)
					.first<{ software_signing_enabled: number }>()
			)?.software_signing_enabled,
		),
	);

/** The newest published template of a kind, or null. */
export const readCurrentTemplate = (kind: AgreementTemplate["kind"]) =>
	asked((db) =>
		db
			.prepare(
				"SELECT * FROM software_agreement_templates WHERE kind=? ORDER BY version DESC LIMIT 1",
			)
			.bind(kind)
			.first<AgreementTemplate>(),
	);

/** The newest contractor config, or null. */
export const readContractorConfig = () =>
	asked((db) =>
		db
			.prepare(
				"SELECT version,values_json FROM software_contractor_config ORDER BY version DESC LIMIT 1",
			)
			.first<ContractorConfig>(),
	);

/**
 * Whether the MSA an offer reuses is executed, not terminated, its archive open, its signed copy ready, and for the
 * client at `recipientEmail` (the request's address as the pin stores it: trimmed and lower-cased by the flow).
 */
export const readReusableMsa = (msaId: string, recipientEmail: string) =>
	asked(
		async (db) =>
			(await db
				.prepare(
					"SELECT 1 FROM software_agreements a JOIN software_agreement_clients c ON c.id=a.client_id WHERE a.id=? AND a.kind='msa' AND a.status='executed' AND a.terminated_at IS NULL AND a.archive_closed_at IS NULL AND EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=a.id AND f.status='ready') AND c.recipient_email=?",
				)
				.bind(msaId, recipientEmail)
				.first()) !== null,
	);

/** Whether an attachment the details name has its metadata row of the request with its digest, size, name, version and date. */
export const readAttachmentRow = (
	requestId: string,
	attachment: NamedAttachment,
) =>
	asked(
		async (db) =>
			(await db
				.prepare(
					"SELECT 1 FROM software_agreement_attachments WHERE request_id=? AND object_key=? AND sha256=? AND bytes=? AND filename=? AND version=? AND document_date=?",
				)
				.bind(
					requestId,
					attachment.key,
					attachment.sha256,
					attachment.bytes,
					attachment.filename,
					attachment.version,
					attachment.date,
				)
				.first()) !== null,
	);

/**
 * The send batch: G1, G5 (no live link made after `since`), G3, G11 per pinned attachment, G4 (a deposit open or paid)
 * for the open draft, G2, G8 (the offer still has the status and updated_at read) and, for a reissue, G9 (the request's
 * link is revoked); for the open draft, the sent version superseded and the draft marked sent (SUPERSEDE and SEND); the
 * link written in place of any old one; the pin; signing retired; and the audit.
 */
export const saveSend = (write: SendWrite, since: string) =>
	saved((db) => {
		const requestId = write.request.id;
		const { move, offer, pin } = write;

		return [
			requestUnchanged(db, write.request),
			offerSendingGuard(db, requestId, since),
			noSignedAgreement(db, requestId),
			...(pin === null
				? []
				: pin.attachments.map((attachment) =>
						attachmentUnchanged(db, requestId, attachment),
					)),
			...(move.kind === "send" ? [depositOfferGuard(db, requestId)] : []),
			noProject(db, requestId),
			guard(
				db,
				"SELECT 1 FROM software_offers WHERE id=? AND status=? AND updated_at=?",
				[offer.id, offer.status, offer.updatedAt],
			),
			...(move.kind === "reissue"
				? [
						guard(
							db,
							"SELECT 1 FROM software_offer_links WHERE request_id=? AND revoked_at IS NOT NULL",
							[requestId],
						),
					]
				: [
						db
							.prepare(
								`UPDATE software_offers SET status=${literal(move.supersede.to, OFFER_STATUSES)} WHERE request_id=? AND ${statusIs(move.supersede.from)}`,
							)
							.bind(requestId),
						db
							.prepare(
								`UPDATE software_offers SET status=${literal(move.markSent.to, OFFER_STATUSES)},sent_at=?,sent_by=?,updated_at=? WHERE id=? AND ${statusIs(move.markSent.from)}`,
							)
							.bind(write.at, write.actor, write.at, offer.id),
					]),
			db
				.prepare(`INSERT INTO software_offer_links(request_id,token_hash,created_at,revoked_at) VALUES (?,?,?,NULL)
        ON CONFLICT(request_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,revoked_at=NULL`)
				.bind(requestId, write.link.tokenHash, write.at),
			...(pin === null
				? []
				: [
						db
							.prepare(
								"UPDATE software_offers SET agreement_details_json=?,msa_template_id=?,sow_template_id=?,contractor_snapshot_json=?,recipient_email_snapshot=? WHERE id=?",
							)
							.bind(
								pin.details,
								pin.msa,
								pin.sow,
								pin.contractor,
								pin.email,
								offer.id,
							),
					]),
			...retireSigning(db, requestId, write.signing),
			audit(db, requestId, {
				action: write.audit.action,
				actor: write.actor,
				at: write.at,
				note: write.audit.note,
			}),
		];
	});

/**
 * After the send's email: whether the link this send wrote (its token hash) is still live, its offer still sent, and the
 * request neither withdrawn nor without an email.
 */
export const readLinkStillLive = (
	requestId: string,
	tokenHash: string,
	offerId: string,
) =>
	asked(
		async (db) =>
			(await db
				.prepare(`SELECT 1 FROM software_offer_links WHERE request_id=? AND token_hash=? AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM software_offers WHERE id=? AND ${statusIs([OFFER_MOVES.SEND.to])})
      AND EXISTS(SELECT 1 FROM owner_requests WHERE id=? AND status<>'withdrawn' AND email<>'')`)
				.bind(requestId, tokenHash, offerId, requestId)
				.first()) !== null,
	);
