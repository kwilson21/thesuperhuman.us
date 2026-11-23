// Retention: which retired agreements, unattached PDFs and orphaned objects the owner may delete, and whether the manifest
// the owner reviewed may still be applied; and the clean-up of old signing access (docs/plans/2026-11-signing-conversion.md,
// section 2, `agreement-retention.ts`). Today's code is src/lib/agreement-retention.ts and `cleanupAgreementAccess` in
// src/lib/agreement-access.ts; every rule below decides what one of their SQL conditions or branches decides, in the same
// order, from plain rows the store reads, the bucket's listings and digests the flow reads, and `now`.
//
// The preview (the owner asks what may go):
//   retentionEligible   the first 20 agreements in id order that may be retired: today's `eligible` SQL condition, from every
//                       agreement and the artifacts, deliveries, notifications, projects, offers and signatures that keep one;
//   listedObject        an object the agreement's listing named is still stored (ListedObjectGone, "Archive changed.");
//   objectsToDelete     the agreement's objects: its own listed objects, and each attachment its manifest names that no
//                       agreement outside the retiring set names, no open offer pins, and no later retiring agreement names;
//   unattachedToDelete  the first 100 metadata rows in id order 30 days old that no agreement names and no open offer pins;
//   scanCursor, orphanCandidate, orphanUnreferenced, orphanFound, markerAfterPreview   the bounded orphan scan of the bucket's
//                       attachment prefix: where it starts (the saved marker), which listed objects are old, unreferenced and
//                       still stored, and when the marker is moved on;
//   retentionManifest   the manifest, field for field and in today's key order, so the response is byte for byte today's.
// The apply (the owner sends the manifest back), staged as today's code answers:
//   manifestUsable      the manifest's shape, storage binding and age (ManifestStale), before any scan;
//   manifestFresh       a fresh scan from the reviewed cursor finds the same agreements, unattached PDFs and orphans
//                       (ArchiveChanged);
//   objectUnchanged     each object of an agreement, once its archive is closed, has the digest the owner reviewed (ObjectChanged);
//   unattachedRowKept, unattachedUnchanged   an unattached PDF's metadata is still the reviewed row (ArchiveChanged), and its
//                       stored bytes have the reviewed digest (UnattachedChanged);
//   orphanStillOld, orphanUnchanged   an orphan is still 30 days old under the attachment prefix (ArchiveChanged), and is still
//                       stored with the reviewed digest (OrphanChanged);
//   markerAfterApply    the cursor marker moved on only when it still holds the reviewed cursor (a conditional put).
// The access clean-up:
//   accessCleanup       sessions expired or revoked more than 30 days before `now`, and links expired that long ago that no
//                       kept session points at (strict comparisons).
//
// Re-checked at write time by A25, the guards today's batches carry (src/lib/agreement-retention.ts): the project evidence
// unchanged (`projectEvidenceUnchanged`), the agreement still eligible with the same text (`stillEligibleWithText`), each
// object named by no other agreement and pinned by no open offer (`objectFree`), and for unattached and orphan files the
// same with their rows unchanged (`unattachedFree`, `orphanFree`). Nothing reads these before the batch today (the fresh
// scan is the read-time decision), so they are exported as the conditions the store's guard SQL keeps, and a raised guard
// stays the store's refused batch (409 "The agreement could not be saved."). The clean-up's DELETE statements keep its
// cutoff as their filter; there is no guard.
//
// Text is compared as SQLite compares it (BINARY: the UTF-8 bytes) and `=` follows SQL's NULL rule (`sqlEquals`), so every
// condition answers on the same rows as the SQL it replaces; the tests hold each to today's SQL on sqlite. Keys named in a
// stored manifest or an offer's details are read by the store with today's JSON expressions (`References`), so a key is
// what today's SQL takes it to be, odd items included. A rule reads no clock, store, bucket or random id, and hashes
// nothing: `now`, the listings, the objects' digests and each agreement's row hash are inputs.
import * as Data from "effect/Data";
import {
	type CanonicalJson,
	canonicalJson,
} from "../../lib/agreement-artifacts";
import type { JsonValue } from "../../lib/json-value";
import { isText } from "../../lib/type-guards";
import { alwaysWrites, rule, type Term, term, unless } from "../terms";

export const STALE_REVIEW = "Review is stale or belongs to different storage.";
export const ARCHIVE_CHANGED = "Archive changed. Preview again.";
export const LISTED_OBJECT_GONE = "Archive changed.";
export const OBJECT_CHANGED = "Object changed.";
export const UNATTACHED_CHANGED = "Unattached PDF changed.";
export const ORPHAN_CHANGED = "Orphan attachment changed.";

/** The bucket object that saves where the bounded orphan scan goes on from. */
export const ORPHAN_CURSOR_KEY = "agreements/retention/attachment-cursor.json";

/** The prefix every uploaded agreement attachment is stored under, which the orphan scan lists. */
export const ATTACHMENT_PREFIX = "agreements/attachments/";

/** The prefix an agreement's own objects (its signed copy, certificate, manifest and texts) are stored under. */
export const agreementPrefix = (id: string) => `agreements/${id}/`;

/** At most this many agreements in one manifest, unattached PDFs, orphans (also the orphan listing's page), and cursor characters. */
export const RETENTION_LIMIT = 20;
export const UNATTACHED_LIMIT = 100;
export const ORPHAN_LIMIT = 100;
export const CURSOR_LIMIT = 4096;

/** How long a session, link, unattached PDF or orphan is kept past its time, and how long a reviewed manifest may be applied. */
export const KEEP_MS = 30 * 86400000;
export const REVIEW_LIFETIME_MS = 86400000;

/** The manifest is not an object of today's shape, is for other storage, is over 24 hours old or from the future, or is too long. */
export class ManifestStale extends Data.TaggedError("ManifestStale") {
	readonly say = STALE_REVIEW;
}

/**
 * A fresh scan does not find what the owner reviewed, an unattached PDF's metadata is gone, or an orphan is no longer old
 * under the attachment prefix.
 */
export class ArchiveChanged extends Data.TaggedError("ArchiveChanged") {
	readonly say = ARCHIVE_CHANGED;
}

/** While the preview reads an agreement's objects, one its listing named is no longer stored. */
export class ListedObjectGone extends Data.TaggedError("ListedObjectGone") {
	readonly say = LISTED_OBJECT_GONE;
}

/** An object of the closing agreement is stored with another digest than the one reviewed. */
export class ObjectChanged extends Data.TaggedError("ObjectChanged") {
	readonly say = OBJECT_CHANGED;
}

/** An unattached PDF is stored with another digest than its metadata's. */
export class UnattachedChanged extends Data.TaggedError("UnattachedChanged") {
	readonly say = UNATTACHED_CHANGED;
}

/** An orphan is gone, or stored with another digest than the one reviewed. */
export class OrphanChanged extends Data.TaggedError("OrphanChanged") {
	readonly say = ORPHAN_CHANGED;
}

/** SQLite's BINARY order of two texts: the order of their UTF-8 bytes. Negative, zero or positive. */
const utf8 = new TextEncoder();

export function textOrder(left: string, right: string): number {
	const a = utf8.encode(left);
	const b = utf8.encode(right);

	for (let index = 0; index < a.length && index < b.length; index += 1)
		if (a[index] !== b[index]) return a[index] - b[index];

	return a.length - b.length;
}

/** SQL's `=`: false when either side is NULL. */
export const sqlEquals = <T>(left: T | null, right: T | null) =>
	left !== null && right !== null && left === right;

/** A JSON object's fields (an array or any other value is not one). */
export type JsonRecord = { readonly [field: string]: CanonicalJson };

/** True for a JSON object: not null, not an array, not text, a number or a boolean. */
export function isJsonRecord(value: CanonicalJson): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const byId = <R extends { readonly id: string }>(left: R, right: R) =>
	textOrder(left.id, right.id);

// ---------------------------------------------------------------------------------------------------------------------
// The manifest, as today's preview answers it and the owner sends it back.

export type StoredObject = { key: string; sha256: string };

export type ProjectEvidence = {
	request_id: string;
	external_signature_details_json: string | null;
};

export type ManifestAgreement = {
	id: string;
	sha256: string;
	row_hash: string;
	project_evidence: ProjectEvidence[];
	objects: StoredObject[];
};

export type UnattachedAttachment = {
	id: string;
	key: string;
	sha256: string;
	created_at: string;
};

export type OrphanAttachment = {
	key: string;
	sha256: string;
	uploaded_at: string;
};

export type RetentionManifest = {
	version: 1;
	created_at: string;
	binding: string;
	agreements: ManifestAgreement[];
	unattached_attachments: UnattachedAttachment[];
	orphan_scan_cursor?: string | null;
	orphan_next_cursor?: string | null;
	orphan_attachments: OrphanAttachment[];
};

// ---------------------------------------------------------------------------------------------------------------------
// The facts, as the store reads them.

/**
 * An agreement as stored: every column of `software_agreements` (`SELECT * ...`), of which the conditions read these. The
 * flow hashes the whole row it read (`hashOfferToken(canonicalJson(row))`) for the manifest's `row_hash`, as today.
 */
export type RetentionAgreementRow = {
	readonly id: string;
	readonly kind: string;
	readonly offer_id: string | null;
	readonly msa_id: string | null;
	readonly status: string;
	readonly text_sha256: string;
	readonly attachment_manifest_json: string;
	readonly ended_at: string | null;
	readonly retain_until: string | null;
	readonly legal_hold: number;
	readonly terminated_at: string | null;
};

export type RetentionProject = {
	readonly request_id: string;
	readonly offer_id: string;
	readonly agreement_id: string | null;
	readonly content_deleted_at: string | null;
	readonly external_signature_details_json: string | null;
};

/**
 * Every row the `eligible` condition looks at: every agreement; the agreement and status of every artifact, delivery and
 * notification; every project; the id, status and reused MSA of every offer; the agreement of every signature.
 */
export type RetentionFacts = {
	readonly agreements: readonly RetentionAgreementRow[];
	readonly artifacts: readonly {
		readonly agreement_id: string;
		readonly status: string;
	}[];
	readonly deliveries: readonly {
		readonly agreement_id: string;
		readonly status: string;
	}[];
	readonly notifications: readonly {
		readonly agreement_id: string;
		readonly status: string;
	}[];
	readonly projects: readonly RetentionProject[];
	readonly offers: readonly {
		readonly id: string;
		readonly status: string;
		readonly reused_msa_id: string | null;
	}[];
	readonly signatures: readonly { readonly agreement_id: string }[];
};

/**
 * Who names a stored key, read with today's JSON expressions (filtered to the keys asked about, or not: a rule matches
 * the key itself):
 * - `agreements`: one row per item of each agreement's attachment manifest, `json_extract(item.value,'$.key')` over
 *   `json_each(attachment_manifest_json)`;
 * - `offers`: one row per item of each offer's `json_each(json_extract(agreement_details_json,'$.attachments'))`, its key
 *   `CASE WHEN json_valid(item.value) THEN json_extract(item.value,'$.key') END`, with the offer's status and the count of
 *   its projects (any project, content deleted or not).
 * A key SQLite reads as a number never names a stored object, whose keys are text.
 */
export type References = {
	readonly agreements: readonly {
		readonly agreement_id: string;
		readonly key: string | number | null;
	}[];
	readonly offers: readonly {
		readonly offer_id: string;
		readonly status: string;
		readonly key: string | number | null;
		readonly projects: number;
	}[];
};

/** An uploaded attachment's metadata row, every column (an unattached PDF's row is put back from it after a refused delete). */
export type StoredAttachment = {
	readonly id: string;
	readonly request_id: string;
	readonly filename: string;
	readonly version: string;
	readonly document_date: string;
	readonly object_key: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly created_at: string;
	readonly created_by: string;
};

/** An object as the bucket's listing gives it. */
export type ListedObject = { readonly key: string; readonly uploaded: Date };

/**
 * The cursor marker as read: absent; present but unreadable (its body could not be read, or is not JSON); or read, with
 * its body as `JSON.parse` gives it.
 */
export type MarkerRead =
	| { readonly kind: "absent" }
	| { readonly kind: "unreadable"; readonly etag: string }
	| { readonly kind: "read"; readonly etag: string; readonly saved: JsonValue };

/** An attachment item of a retiring agreement's manifest (`JSON.parse(attachment_manifest_json)`, as the site writes it). */
export type AttachmentEntry = { readonly key: string; readonly sha256: string };

/** A retiring agreement, with the items of its attachment manifest. */
export type RetiringAgreement = {
	readonly id: string;
	readonly attachments: readonly AttachmentEntry[];
};

// ---------------------------------------------------------------------------------------------------------------------
// Conditions shared by the rules and by A25.

/** Some agreement, other than those `except` accepts, names the key in its attachment manifest. */
export const namedByAgreement = (
	key: string,
	references: References,
	except: (agreementId: string) => boolean = () => false,
) =>
	references.agreements.some(
		(reference) => reference.key === key && !except(reference.agreement_id),
	);

/**
 * An offer that can still be reviewed pins the key: a draft or sent offer whose details name it and that has no project
 * (today's `activeOfferAttachment`).
 */
export const pinnedByOpenOffer = (key: string, references: References) =>
	references.offers.some(
		(offer) =>
			offer.key === key &&
			(offer.status === "draft" || offer.status === "sent") &&
			offer.projects === 0,
	);

/** One agreement among every row the `eligible` condition reads, at `now` (ISO). */
export type RetentionCandidate = {
	readonly agreement: RetentionAgreementRow;
	readonly facts: RetentionFacts;
	readonly now: string;
};

const contentKept = (project: RetentionProject) =>
	project.content_deleted_at === null;

/** An offer that reuses an MSA and still needs it: a project with content, any agreement of its own, or open without a deleted project. */
const offerNeedsMsa = (
	offer: RetentionFacts["offers"][number],
	facts: RetentionFacts,
) =>
	facts.projects.some(
		(project) => sqlEquals(project.offer_id, offer.id) && contentKept(project),
	) ||
	facts.agreements.some((other) => sqlEquals(other.offer_id, offer.id)) ||
	((offer.status === "sent" || offer.status === "draft") &&
		!facts.projects.some(
			(project) =>
				sqlEquals(project.offer_id, offer.id) && !contentKept(project),
		));

/** Today's `eligible` SQL condition, one term per clause, in its order. */
export const RETENTION_TERMS: readonly Term<RetentionCandidate>[] = [
	term(
		"the agreement is executed or abandoned",
		({ agreement }: RetentionCandidate) =>
			agreement.status === "executed" || agreement.status === "abandoned",
	),
	term(
		"it has ended",
		({ agreement }: RetentionCandidate) => agreement.ended_at !== null,
	),
	term(
		"its retention period is over: retain_until is set and not after now",
		({ agreement, now }: RetentionCandidate) =>
			agreement.retain_until !== null &&
			textOrder(agreement.retain_until, now) <= 0,
	),
	term(
		"it has no legal hold",
		({ agreement }: RetentionCandidate) => agreement.legal_hold === 0,
	),
	term(
		"no signed copy of it is being rendered",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.artifacts.some(
				(artifact) =>
					sqlEquals(artifact.agreement_id, agreement.id) &&
					artifact.status === "rendering",
			),
	),
	term(
		"no copy of it is being sent",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.deliveries.some(
				(delivery) =>
					sqlEquals(delivery.agreement_id, agreement.id) &&
					delivery.status === "sending",
			),
	),
	term(
		"no signing notice of it is being sent",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.notifications.some(
				(notification) =>
					sqlEquals(notification.agreement_id, agreement.id) &&
					notification.status === "sending",
			),
	),
	term(
		"no project whose content is kept names it",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.projects.some(
				(project) =>
					sqlEquals(project.agreement_id, agreement.id) && contentKept(project),
			),
	),
	term(
		"no project whose content is kept belongs to its offer",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.projects.some(
				(project) =>
					sqlEquals(project.offer_id, agreement.offer_id) &&
					contentKept(project),
			),
	),
	term(
		"no offer that reuses it as its MSA still needs it: none with a project whose content is kept, none with an agreement, and none sent or draft without a project whose content was deleted",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.offers.some(
				(offer) =>
					sqlEquals(offer.reused_msa_id, agreement.id) &&
					offerNeedsMsa(offer, facts),
			),
	),
	term(
		"no agreement names it as its MSA",
		({ agreement, facts }: RetentionCandidate) =>
			!facts.agreements.some((other) => sqlEquals(other.msa_id, agreement.id)),
	),
	term(
		"it is a SOW, a terminated MSA, or an MSA that was never signed",
		({ agreement, facts }: RetentionCandidate) =>
			agreement.kind === "sow" ||
			agreement.terminated_at !== null ||
			!facts.signatures.some((signature) =>
				sqlEquals(signature.agreement_id, agreement.id),
			),
	),
];

/** Today's `eligible` condition for one agreement. */
export const eligibleForRetention = (candidate: RetentionCandidate) =>
	RETENTION_TERMS.every((condition) => condition.holds(candidate));

/** A25: the agreement is still stored with the reviewed text and still eligible (the guard `a.id=? AND a.text_sha256=? AND eligible`). */
export const stillEligibleWithText = (
	item: { readonly id: string; readonly sha256: string },
	facts: RetentionFacts,
	now: string,
) =>
	facts.agreements.some(
		(agreement) =>
			sqlEquals(agreement.id, item.id) &&
			sqlEquals(agreement.text_sha256, item.sha256) &&
			eligibleForRetention({ agreement, facts, now }),
	);

/**
 * A25: the project evidence is unchanged. The agreement's offer has as many projects as were reviewed, and each reviewed
 * project is still stored with the same external signature details (SQL `IS`); an agreement that is gone, or has no offer,
 * has none.
 */
export const projectEvidenceUnchanged = (
	item: {
		readonly id: string;
		readonly project_evidence: readonly ProjectEvidence[];
	},
	agreements: readonly Pick<RetentionAgreementRow, "id" | "offer_id">[],
	projects: readonly RetentionProject[],
) => {
	const offerId =
		agreements.find((agreement) => sqlEquals(agreement.id, item.id))
			?.offer_id ?? null;

	return (
		projects.filter((project) => sqlEquals(project.offer_id, offerId))
			.length === item.project_evidence.length &&
		item.project_evidence.every((evidence) =>
			projects.some(
				(project) =>
					sqlEquals(project.request_id, evidence.request_id) &&
					project.external_signature_details_json ===
						evidence.external_signature_details_json,
			),
		)
	);
};

/** A25: no agreement other than the closing one names the object, and no open offer pins it. */
export const objectFree = (
	key: string,
	agreementId: string,
	references: References,
) =>
	!namedByAgreement(key, references, (id) => id === agreementId) &&
	!pinnedByOpenOffer(key, references);

/**
 * A25: the unattached PDF's metadata row is still the reviewed one (id, key, digest and creation time), at or before the
 * cutoff, named by no agreement and pinned by no open offer.
 */
export const unattachedFree = (
	entry: UnattachedAttachment,
	cutoff: string,
	rows: readonly Pick<
		StoredAttachment,
		"id" | "object_key" | "sha256" | "created_at"
	>[],
	references: References,
) =>
	rows.some(
		(row) =>
			sqlEquals(row.id, entry.id) &&
			sqlEquals(row.object_key, entry.key) &&
			sqlEquals(row.sha256, entry.sha256) &&
			sqlEquals(row.created_at, entry.created_at) &&
			textOrder(row.created_at, cutoff) <= 0 &&
			!namedByAgreement(row.object_key, references) &&
			!pinnedByOpenOffer(entry.key, references),
	);

/** A25, and the preview's reference check: no metadata row, agreement or open offer names the object. */
export const orphanFree = (
	key: string,
	rows: readonly Pick<StoredAttachment, "object_key">[],
	references: References,
) =>
	!rows.some((row) => sqlEquals(row.object_key, key)) &&
	!namedByAgreement(key, references) &&
	!pinnedByOpenOffer(key, references);

const isoBefore = (now: Date, ms: number) =>
	new Date(now.getTime() - ms).toISOString();

// ---------------------------------------------------------------------------------------------------------------------
// The access clean-up.

/** A signing or archive session as stored, with the columns the clean-up reads. */
export type StoredAccessSession = {
	readonly token_hash: string;
	readonly link_id: string;
	readonly expires_at: string;
	readonly revoked_at: string | null;
};

/** A signing or archive link as stored, with the columns the clean-up reads. */
export type StoredAccessLink = {
	readonly id: string;
	readonly expires_at: string;
};

/** Every session and every link. */
export type AccessRows = {
	readonly sessions: readonly StoredAccessSession[];
	readonly links: readonly StoredAccessLink[];
};

/**
 * Which sessions and links the owner's clean-up deletes: a session that expired, or was revoked, strictly before the cutoff
 * 30 days before `now`; and a link that expired strictly before it that no kept session points at (the links are deleted
 * after the sessions, in one batch, so a session deleted with it does not keep it). The verification evidence lives in
 * the signatures, which are not touched.
 */
export const accessCleanup = alwaysWrites({
	name: "clean up signing sessions and links 30 days past their end",
	given: (request: { readonly now: Date }, facts: AccessRows) => {
		const before = isoBefore(request.now, KEEP_MS);

		const old = (time: string | null) =>
			time !== null && textOrder(time, before) < 0;

		const kept = facts.sessions.filter(
			(session) => !old(session.expires_at) && !old(session.revoked_at),
		);

		return {
			before,
			sessions: facts.sessions
				.filter((session) => old(session.expires_at) || old(session.revoked_at))
				.map((session) => session.token_hash),
			links: facts.links
				.filter(
					(link) =>
						old(link.expires_at) &&
						!kept.some((session) => sqlEquals(session.link_id, link.id)),
				)
				.map((link) => link.id),
		};
	},
	refusals: [],
	writes: (given) => given,
	writesText:
		"the sessions deleted, then the links deleted, in one batch, each with the cutoff (none when there are none)",
});

// ---------------------------------------------------------------------------------------------------------------------
// The preview.

/** The agreements a preview retires: those `eligible` at `now`, the first 20 in id order. */
export const retentionEligible = alwaysWrites({
	name: "choose the agreements that may be retired",
	given: (request: { readonly now: Date }, facts: RetentionFacts) => {
		const now = request.now.toISOString();

		return facts.agreements
			.filter((agreement) => eligibleForRetention({ agreement, facts, now }))
			.sort(byId)
			.slice(0, RETENTION_LIMIT);
	},
	refusals: [],
	writes: (chosen) => chosen,
	writesText:
		"the agreement rows, up to 20 in id order (none when none is eligible)",
});

type ListedGiven = { readonly key: string; readonly digest: string | null };

/** An object the agreement's listing named is still stored when it is read: its digest goes into the manifest. */
export const listedObject = alwaysWrites({
	name: "read an object the agreement's listing named",
	given: (
		request: { readonly key: string },
		facts: { readonly digest: string | null },
	): ListedGiven => ({ key: request.key, digest: facts.digest }),
	refusals: [
		unless(
			term(
				"the object is still stored",
				(given: ListedGiven) => given.digest !== null,
			),
			() => new ListedObjectGone(),
		),
	],
	writes: (given): StoredObject => ({
		key: given.key,
		// SAFETY: `writes` runs only once the refusal above passed, which ruled out a missing digest.
		sha256: given.digest as string,
	}),
	writesText: "the object's key and digest",
});

/**
 * The objects of one retiring agreement: its listed objects, then each attachment of its manifest, in order, that no
 * agreement outside the retiring set names, no open offer pins, and no later retiring agreement names (a shared attachment
 * goes with the last retiring agreement that names it, once the earlier ones are gone). Sorted by key with
 * `localeCompare`, as today.
 */
export const objectsToDelete = alwaysWrites({
	name: "choose the objects a retiring agreement takes with it",
	given: (
		request: { readonly id: string },
		facts: {
			readonly retiring: readonly RetiringAgreement[];
			readonly listed: readonly StoredObject[];
			readonly references: References;
		},
	) => {
		const owners = new Map<string, string>();

		for (const agreement of facts.retiring)
			for (const attachment of agreement.attachments)
				owners.set(attachment.key, agreement.id);

		const retiring = facts.retiring.map((agreement) => agreement.id);

		const own =
			facts.retiring.find((agreement) => agreement.id === request.id)
				?.attachments ?? [];

		return [
			...facts.listed,
			...own
				.filter(
					(attachment) =>
						!namedByAgreement(attachment.key, facts.references, (id) =>
							retiring.includes(id),
						) &&
						!pinnedByOpenOffer(attachment.key, facts.references) &&
						owners.get(attachment.key) === request.id,
				)
				.map(
					(attachment): StoredObject => ({
						key: attachment.key,
						sha256: attachment.sha256,
					}),
				),
		].sort((a, b) => a.key.localeCompare(b.key));
	},
	refusals: [],
	writes: (objects) => objects,
	writesText: "the agreement's objects, each with its digest, sorted by key",
});

/** Unattached PDFs: metadata rows 30 days old (at or before the cutoff) that no agreement names and no open offer pins. */
export const unattachedToDelete = alwaysWrites({
	name: "choose the unattached PDFs that may be deleted",
	given: (
		request: { readonly now: Date },
		facts: {
			readonly attachments: readonly Pick<
				StoredAttachment,
				"id" | "object_key" | "sha256" | "created_at"
			>[];
			readonly references: References;
		},
	) => {
		const cutoff = isoBefore(request.now, KEEP_MS);

		return facts.attachments
			.filter(
				(row) =>
					textOrder(row.created_at, cutoff) <= 0 &&
					!namedByAgreement(row.object_key, facts.references) &&
					!pinnedByOpenOffer(row.object_key, facts.references),
			)
			.sort(byId)
			.slice(0, UNATTACHED_LIMIT)
			.map(
				(row): UnattachedAttachment => ({
					id: row.id,
					key: row.object_key,
					sha256: row.sha256,
					created_at: row.created_at,
				}),
			);
	},
	refusals: [],
	writes: (unattached) => unattached,
	writesText:
		"up to 100 unattached PDFs in id order, as the manifest lists them",
});

/**
 * The marker's cursor when it is version 1 with a text cursor (and, for the preview, of 1 to 4096 characters). A body that
 * is not an object has neither field, as reading a field of null fails today and of anything else gives undefined.
 */
const markerCursor = (marker: MarkerRead, bounded: boolean) => {
	if (marker.kind !== "read" || !isJsonRecord(marker.saved)) return null;
	const { version, cursor } = marker.saved;

	return version === 1 &&
		isText(cursor) &&
		(!bounded || (cursor.length > 0 && cursor.length <= CURSOR_LIMIT))
		? cursor
		: null;
};

/**
 * Where the owner's preview starts the orphan scan: the saved marker's cursor, or the first page when there is no marker,
 * it cannot be read, or it is not version 1 with a cursor of 1 to 4096 characters. (A preview the apply runs scans from
 * the reviewed cursor and reads no marker.)
 */
export const scanCursor = alwaysWrites({
	name: "start the orphan scan where the marker says",
	given: (_request: null, facts: { readonly marker: MarkerRead }) =>
		markerCursor(facts.marker, true),
	refusals: [],
	writes: (cursor) => cursor,
	writesText: "the cursor to list from, or none for the first page",
});

/** What the orphan scan does with the next listed object: stop, skip it, or check what references it. */
export type OrphanStep = "stop" | "skip" | "check";

/**
 * The next listed object of the orphan scan: the scan stops once it has found 100 orphans; an object whose upload time is
 * not a date, or is after the cutoff 30 days before `now`, is skipped; otherwise its references are read.
 */
export const orphanCandidate = alwaysWrites({
	name: "consider the next listed object for the orphan scan",
	given: (
		request: { readonly now: Date },
		facts: { readonly object: ListedObject; readonly found: number },
	): OrphanStep => {
		if (facts.found >= ORPHAN_LIMIT) return "stop";
		const uploaded: unknown = facts.object.uploaded;

		return !(uploaded instanceof Date) ||
			uploaded > new Date(request.now.getTime() - KEEP_MS)
			? "skip"
			: "check";
	},
	refusals: [],
	writes: (step) => step,
	writesText: "stop, skip the object, or read its references",
});

type UnreferencedGiven = {
	readonly key: string;
	readonly rows: readonly Pick<StoredAttachment, "object_key">[];
	readonly references: References;
};

/** An old listed object is fetched only when no metadata row, agreement or open offer names it. */
export const orphanUnreferenced = rule({
	name: "fetch an old object nothing references",
	given: (
		request: { readonly key: string },
		facts: {
			readonly rows: readonly Pick<StoredAttachment, "object_key">[];
			readonly references: References;
		},
	): UnreferencedGiven => ({ key: request.key, ...facts }),
	nothingToDoIf: term(
		"a metadata row, an agreement or an open offer names the object",
		(given: UnreferencedGiven) =>
			!orphanFree(given.key, given.rows, given.references),
	),
	refusals: [],
	writes: (given) => ({ key: given.key }),
	writesText: "the object fetched and hashed",
});

type FoundGiven = {
	readonly object: ListedObject;
	readonly digest: string | null;
};

/** An unreferenced old object that is still stored when fetched is an orphan; one that is gone is skipped. */
export const orphanFound = rule({
	name: "list an orphan that is still stored",
	given: (
		request: { readonly object: ListedObject },
		facts: { readonly digest: string | null },
	): FoundGiven => ({ object: request.object, digest: facts.digest }),
	nothingToDoIf: term(
		"the object is no longer stored",
		(given: FoundGiven) => given.digest === null,
	),
	refusals: [],
	writes: (given): OrphanAttachment => ({
		key: given.object.key,
		// SAFETY: `writes` runs only when `nothingToDoIf` did not hold, which ruled out a missing digest.
		sha256: given.digest as string,
		uploaded_at: given.object.uploaded.toISOString(),
	}),
	writesText: "the orphan's key, digest and upload time",
});

type MarkerGiven = {
	readonly reviewed: boolean;
	readonly found: number;
	readonly nextCursor: string | null;
};

/**
 * The owner's preview moves the marker on to the listing's next cursor (none after the last page) when it found no
 * orphans, so the next preview scans the next page; a scan the apply runs, or one that found orphans, leaves it.
 */
export const markerAfterPreview = rule({
	name: "move the orphan scan's marker on after a preview",
	given: (
		request: { readonly reviewed: boolean; readonly nextCursor: string | null },
		facts: { readonly found: number },
	): MarkerGiven => ({ ...request, found: facts.found }),
	nothingToDoIf: term(
		"the scan is the apply's, or it found orphans",
		(given: MarkerGiven) => given.reviewed || given.found > 0,
	),
	refusals: [],
	writes: (given) => ({
		key: ORPHAN_CURSOR_KEY,
		body: JSON.stringify({ version: 1, cursor: given.nextCursor }),
	}),
	writesText: "the marker put with the next cursor",
});

/** One retiring agreement as the preview read it: its row, the row's hash, its offer's projects and its objects. */
export type AgreementScan = {
	readonly row: Pick<RetentionAgreementRow, "id" | "text_sha256">;
	readonly rowHash: string;
	readonly projectEvidence: readonly ProjectEvidence[];
	readonly objects: readonly StoredObject[];
};

/**
 * The manifest a preview answers, field for field in today's order: the agreements in the order chosen, each with its
 * offer's projects in request id order; the unattached PDFs; the orphans sorted by key with `localeCompare`; the cursor the
 * scan started from and the next one.
 */
export const retentionManifest = alwaysWrites({
	name: "write the retention manifest",
	given: (
		request: {
			readonly now: Date;
			readonly binding: string;
			readonly scanCursor: string | null;
			readonly nextCursor: string | null;
		},
		facts: {
			readonly agreements: readonly AgreementScan[];
			readonly unattached: readonly UnattachedAttachment[];
			readonly orphans: readonly OrphanAttachment[];
		},
	): RetentionManifest => ({
		version: 1,
		created_at: request.now.toISOString(),
		binding: request.binding,
		agreements: facts.agreements.map((scan) => ({
			id: scan.row.id,
			sha256: scan.row.text_sha256,
			row_hash: scan.rowHash,
			project_evidence: [...scan.projectEvidence]
				.sort((a, b) => textOrder(a.request_id, b.request_id))
				.map((project) => ({
					request_id: project.request_id,
					external_signature_details_json:
						project.external_signature_details_json,
				})),
			objects: scan.objects.map((object) => ({
				key: object.key,
				sha256: object.sha256,
			})),
		})),
		unattached_attachments: facts.unattached.map((entry) => ({
			id: entry.id,
			key: entry.key,
			sha256: entry.sha256,
			created_at: entry.created_at,
		})),
		orphan_attachments: facts.orphans
			.map((orphan) => ({
				key: orphan.key,
				sha256: orphan.sha256,
				uploaded_at: orphan.uploaded_at,
			}))
			.sort((a, b) => a.key.localeCompare(b.key)),
		orphan_scan_cursor: request.scanCursor,
		orphan_next_cursor: request.nextCursor,
	}),
	refusals: [],
	writes: (manifest) => manifest,
	writesText: "nothing stored: the manifest is the answer",
});

// ---------------------------------------------------------------------------------------------------------------------
// The apply.

const fieldsOf = (value: CanonicalJson): JsonRecord =>
	isJsonRecord(value) ? value : {};

type UsableGiven = {
	readonly agreements: CanonicalJson;
	readonly cursor: CanonicalJson;
	readonly version: CanonicalJson;
	readonly binding: CanonicalJson;
	readonly expected: string;
	readonly age: number;
	readonly unattached: CanonicalJson;
	readonly orphans: CanonicalJson;
};

const stale = () => new ManifestStale();

/** The lists the owner reviewed, once the manifest is usable (orphans left out read as none). */
export type SentLists = {
	readonly agreements: CanonicalJson[];
	readonly unattached: CanonicalJson[];
	readonly orphans: CanonicalJson[];
};

/**
 * Stage 1 of the apply, before any scan: the manifest the owner sent back (any JSON value of the request) is an object with
 * a list of agreements, its orphan scan cursor is absent or text of 1 to 4096 characters, it is version 1, it is for this
 * storage binding, it was made at most 24 hours before `now` and not after it, and its lists are within their limits. Each
 * is today's refusal, ManifestStale.
 */
export const manifestUsable = alwaysWrites({
	name: "accept a manifest the owner reviewed",
	given: (
		request: { readonly now: Date; readonly binding: string },
		facts: { readonly manifest: CanonicalJson },
	): UsableGiven => {
		const sent = fieldsOf(facts.manifest);

		return {
			agreements: sent.agreements,
			cursor: sent.orphan_scan_cursor,
			version: sent.version,
			binding: sent.binding,
			expected: request.binding,
			// String() is the conversion Date.parse makes of a value that is not text.
			age: request.now.getTime() - Date.parse(String(sent.created_at)),
			unattached: sent.unattached_attachments,
			orphans: sent.orphan_attachments,
		};
	},
	refusals: [
		unless(
			term(
				"the manifest is an object with a list of agreements",
				(given: UsableGiven) => Array.isArray(given.agreements),
			),
			stale,
		),
		unless(
			term(
				"its orphan scan cursor is absent, or text of 1 to 4096 characters",
				(given: UsableGiven) =>
					given.cursor === null ||
					given.cursor === undefined ||
					(isText(given.cursor) &&
						given.cursor.length > 0 &&
						given.cursor.length <= CURSOR_LIMIT),
			),
			stale,
		),
		unless(
			term("it is version 1", (given: UsableGiven) => given.version === 1),
			stale,
		),
		unless(
			term(
				"it is for this storage binding",
				(given: UsableGiven) => given.binding === given.expected,
			),
			stale,
		),
		unless(
			term(
				"it was made at most 24 hours before now, and not after now",
				(given: UsableGiven) =>
					Number.isFinite(given.age) &&
					given.age >= 0 &&
					given.age <= REVIEW_LIFETIME_MS,
			),
			stale,
		),
		unless(
			term(
				"it names at most 20 agreements",
				(given: UsableGiven) =>
					Array.isArray(given.agreements) &&
					given.agreements.length <= RETENTION_LIMIT,
			),
			stale,
		),
		unless(
			term(
				"its unattached PDFs are a list of at most 100",
				(given: UsableGiven) =>
					Array.isArray(given.unattached) &&
					given.unattached.length <= UNATTACHED_LIMIT,
			),
			stale,
		),
		unless(
			term(
				"its orphans are left out, or a list of at most 100",
				(given: UsableGiven) =>
					given.orphans === undefined ||
					(Array.isArray(given.orphans) &&
						given.orphans.length <= ORPHAN_LIMIT),
			),
			stale,
		),
	],
	writes: (given) => ({
		cursor: isText(given.cursor) ? given.cursor : null,
		sent: {
			agreements: Array.isArray(given.agreements) ? given.agreements : [],
			unattached: Array.isArray(given.unattached) ? given.unattached : [],
			orphans: Array.isArray(given.orphans) ? given.orphans : [],
		} satisfies SentLists,
	}),
	writesText:
		"the cursor the fresh scan starts from (none when absent), and the lists the owner reviewed",
});

type FreshGiven = {
	readonly sent: SentLists;
	readonly fresh: RetentionManifest;
};

/**
 * Stage 2 of the apply: the fresh scan, from the reviewed cursor at `now`, finds exactly the agreements, unattached PDFs and
 * orphans the owner reviewed (compared as canonical JSON). The lists it writes are the fresh scan's, equal to the reviewed
 * ones.
 */
export const manifestFresh = alwaysWrites({
	name: "apply only what a fresh scan still finds",
	given: (_request: null, facts: FreshGiven) => facts,
	refusals: [
		unless(
			term(
				"a fresh scan finds the same agreements, unattached PDFs and orphans",
				(given: FreshGiven) =>
					canonicalJson(given.fresh.agreements) ===
						canonicalJson(given.sent.agreements) &&
					canonicalJson(given.fresh.unattached_attachments) ===
						canonicalJson(given.sent.unattached) &&
					canonicalJson(given.fresh.orphan_attachments) ===
						canonicalJson(given.sent.orphans),
			),
			() => new ArchiveChanged(),
		),
	],
	writes: (given) => ({
		agreements: given.fresh.agreements,
		unattached: given.fresh.unattached_attachments,
		orphans: given.fresh.orphan_attachments,
		nextCursor: given.fresh.orphan_next_cursor ?? null,
	}),
	writesText:
		"the agreements to close and delete, the unattached PDFs and orphans to delete, and the scan's next cursor",
});

type DigestGiven = {
	readonly key: string;
	readonly sha256: string;
	readonly digest: string | null;
};

/**
 * Each object of an agreement whose archive is now closed, read again before it is deleted: an object still stored must
 * have the reviewed digest. One already gone is deleted all the same (the delete is idempotent), as today.
 */
export const objectUnchanged = alwaysWrites({
	name: "delete an object of a closed archive",
	given: (
		request: { readonly object: StoredObject },
		facts: { readonly digest: string | null },
	): DigestGiven => ({ ...request.object, digest: facts.digest }),
	refusals: [
		unless(
			term(
				"the object is gone, or stored with the reviewed digest",
				(given: DigestGiven) =>
					given.digest === null || given.digest === given.sha256,
			),
			() => new ObjectChanged(),
		),
	],
	writes: (given) => ({ key: given.key }),
	writesText: "the object deleted",
});

type RowGiven = {
	readonly entry: UnattachedAttachment;
	readonly row: StoredAttachment | null;
};

/** Stage 1 of an unattached PDF: its metadata row, read by id, is still the reviewed one. Its row is kept to put back. */
export const unattachedRowKept = alwaysWrites({
	name: "find an unattached PDF's metadata as reviewed",
	given: (
		request: { readonly entry: UnattachedAttachment },
		facts: { readonly row: StoredAttachment | null },
	): RowGiven => ({ entry: request.entry, row: facts.row }),
	refusals: [
		unless(
			term(
				"the metadata row is stored with the reviewed key, digest and creation time",
				(given: RowGiven) =>
					given.row !== null &&
					sqlEquals(given.row.id, given.entry.id) &&
					sqlEquals(given.row.object_key, given.entry.key) &&
					sqlEquals(given.row.sha256, given.entry.sha256) &&
					sqlEquals(given.row.created_at, given.entry.created_at),
			),
			() => new ArchiveChanged(),
		),
	],
	// SAFETY: `writes` runs only once the refusal above passed, which ruled out a missing row.
	writes: (given) => given.row as StoredAttachment,
	writesText: "the metadata row, put back if the bucket refuses the delete",
});

type UnattachedGiven = {
	readonly entry: UnattachedAttachment;
	readonly digest: string | null;
	readonly cutoff: string;
};

/**
 * Stage 2 of an unattached PDF: its object, when still stored, has the metadata's digest. The row is then deleted under A25
 * (`unattachedFree` at the cutoff 30 days before `now`), and the object deleted when it was stored.
 */
export const unattachedUnchanged = alwaysWrites({
	name: "delete an unattached PDF",
	given: (
		request: { readonly entry: UnattachedAttachment; readonly now: Date },
		facts: { readonly digest: string | null },
	): UnattachedGiven => ({
		entry: request.entry,
		digest: facts.digest,
		cutoff: isoBefore(request.now, KEEP_MS),
	}),
	refusals: [
		unless(
			term(
				"the object is gone, or stored with the metadata's digest",
				(given: UnattachedGiven) =>
					given.digest === null || given.digest === given.entry.sha256,
			),
			() => new UnattachedChanged(),
		),
	],
	writes: (given) => ({
		cutoff: given.cutoff,
		deleteObject: given.digest !== null,
	}),
	writesText:
		"the metadata row deleted under its guard, then the object deleted when it was stored",
});

type OldGiven = { readonly orphan: OrphanAttachment; readonly now: Date };

/** Stage 1 of an orphan: it was uploaded at or before the cutoff 30 days before `now`, under the attachment prefix. */
export const orphanStillOld = alwaysWrites({
	name: "check an orphan is old and an attachment",
	given: (
		request: { readonly now: Date },
		facts: { readonly orphan: OrphanAttachment },
	): OldGiven => ({ orphan: facts.orphan, now: request.now }),
	refusals: [
		unless(
			term(
				"the orphan was uploaded 30 days ago or earlier, under the attachment prefix",
				(given: OldGiven) => {
					const uploaded = Date.parse(given.orphan.uploaded_at);

					return (
						Number.isFinite(uploaded) &&
						uploaded <= given.now.getTime() - KEEP_MS &&
						given.orphan.key.startsWith(ATTACHMENT_PREFIX)
					);
				},
			),
			() => new ArchiveChanged(),
		),
	],
	writes: (given) => ({ key: given.orphan.key }),
	writesText: "the orphan read again",
});

/** Stage 2 of an orphan: it is still stored with the reviewed digest. It is then deleted under A25 (`orphanFree`). */
export const orphanUnchanged = alwaysWrites({
	name: "delete an orphan",
	given: (
		request: { readonly orphan: OrphanAttachment },
		facts: { readonly digest: string | null },
	): DigestGiven => ({
		key: request.orphan.key,
		sha256: request.orphan.sha256,
		digest: facts.digest,
	}),
	refusals: [
		unless(
			term(
				"the orphan is still stored with the reviewed digest",
				(given: DigestGiven) =>
					given.digest !== null && given.digest === given.sha256,
			),
			() => new OrphanChanged(),
		),
	],
	writes: (given) => ({ key: given.key }),
	writesText: "the orphan deleted once its guard passes",
});

type AfterApplyGiven = {
	readonly saved: string | null;
	readonly reviewedCursor: string | null;
	readonly nextCursor: string | null;
	readonly marker: MarkerRead;
};

/**
 * After the apply, the marker moves on to the fresh scan's next cursor only when it still holds the cursor the owner
 * reviewed (an unreadable marker, or one that is not version 1 with a text cursor, holds none), with a put conditional on
 * the marker read: its etag, or no marker at all.
 */
export const markerAfterApply = rule({
	name: "move the orphan scan's marker on after an apply",
	given: (
		request: {
			readonly reviewedCursor: string | null;
			readonly nextCursor: string | null;
		},
		facts: { readonly marker: MarkerRead },
	): AfterApplyGiven => ({
		...request,
		marker: facts.marker,
		saved: markerCursor(facts.marker, false),
	}),
	nothingToDoIf: term(
		"the marker does not hold the reviewed cursor",
		(given: AfterApplyGiven) => given.saved !== given.reviewedCursor,
	),
	refusals: [],
	writes: (given) => ({
		key: ORPHAN_CURSOR_KEY,
		body: JSON.stringify({ version: 1, cursor: given.nextCursor }),
		onlyIf:
			given.marker.kind === "absent"
				? { etagDoesNotMatch: "*" }
				: { etagMatches: given.marker.etag },
	}),
	writesText: "the marker put with the next cursor, if it is unchanged",
});
