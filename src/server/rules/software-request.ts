// The front of every action on a software request (POST /api/owner/requests/[id]/software: fit, question, decline,
// revoke, draft, send), and the terms the six actions share. Decided from the request as read (its kind, status, email
// and updated_at) and, for draft, send, question and decline, whether a project has started; in the order the route has
// always given them (docs/plans/2026-11-offers-conversion.md, "The area today" and section 2): RequestNotFound, then
// ProjectStarted, RequestClosed, RequestResolved. Whether the stored status allows an action is the machine's answer
// (`next` over `softwareRequest`, src/server/machines/software-request.ts). Re-checked at write time in each action's
// batch by G1, the request guard (the row still has the updated_at, status and email that were read), and, for the four
// actions that read it, G2 (no software_projects row). Nothing here reads a clock, a store or a random id: the time and
// the ids are inputs, and the write time is worked out from the time the flow read.
import * as Data from "effect/Data";
import type { OwnerRequest } from "../../lib/owner-model";
import { offerSendingMessage } from "../../lib/software-offers";
import { next } from "../machines/next";
import {
	type OfferEmails,
	type RequestEvent,
	softwareRequest,
} from "../machines/software-request";
import { alwaysWrites, type Refusal, term, unless } from "../terms";

/** No request has the id, or the one that has it is not a software request: 404 with no message. */
export class RequestNotFound extends Data.TaggedError("RequestNotFound") {
	readonly say = "Not found";
}

export class ProjectStarted extends Data.TaggedError("ProjectStarted") {
	readonly say = "This project has started. Use the project messages.";
}

/** The request is withdrawn (an action other than revoke) or has no email. */
export class RequestClosed extends Data.TaggedError("RequestClosed") {
	readonly say = "This request is closed.";
}

export class RequestResolved extends Data.TaggedError("RequestResolved") {
	readonly say = "This request is resolved. Reopen it to make a new offer.";
}

/** The page's view of the request is stale, or a batch was refused and nothing else explains it. */
export class RequestChanged extends Data.TaggedError("RequestChanged") {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/** A live link of the request was made in the last 20 seconds: an offer is still being sent. */
export class OfferStillSending extends Data.TaggedError("OfferStillSending") {
	readonly say = offerSendingMessage;
}

/**
 * A `client_signed` or `executed` agreement of the request (G3 re-checks it). The route answers it as a refused batch is
 * answered (src/server/rules/offer-refused-batch.ts): by its own words, the request changed.
 */
export class AgreementSigned extends Data.TaggedError("AgreementSigned") {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/**
 * An attachment the details name has no metadata row of this request with its digest, size, name, version and date, or
 * is named in a closed archive (G11 re-checks it). Answered as a refused batch is: a changed draft, or a changed request.
 */
export class AttachmentNotUsable extends Data.TaggedError(
	"AttachmentNotUsable",
) {
	readonly say =
		"The request changed or could not be saved. Reload and try again.";
}

/** A software request, as found. */
export type SoftwareRequest = OwnerRequest & { readonly kind: "software" };

const isSoftware = (request: OwnerRequest | null): request is SoftwareRequest =>
	request !== null && request.kind === "software";

/**
 * A value the rule's refusals have proved present. `writes` runs only once every refusal passed (src/server/terms.ts),
 * so this never throws; if it does, a refusal was left out, which is a bug and fails the request as one.
 */
export function proved<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("A rule wrote a value its refusals did not prove.");

	return value;
}

/** Before any other read: the id names a software request. A missing or empty id is read as no request (F6). */
export const findSoftwareRequest = alwaysWrites({
	name: "find the software request the owner acts on",
	given: (_request: null, facts: { readonly request: OwnerRequest | null }) =>
		facts.request,
	refusals: [
		unless(
			term("the id names a software request", isSoftware),
			() => new RequestNotFound(),
		),
	],
	writes: (request) => proved(isSoftware(request) ? request : null),
	writesText: "the request, to act on",
});

/** The request an action is decided on. */
export type Requested = { readonly request: SoftwareRequest };

/** Whether a project has started for the request: read for draft, send, question and decline. */
export type ProjectRead = { readonly projectStarted: boolean };

/** ProjectStarted: no project has started for the request (G2). */
export const noProjectStarted = unless(
	term(
		"no project has started for the request",
		(given: ProjectRead) => !given.projectStarted,
	),
	() => new ProjectStarted(),
);

/**
 * RequestClosed: the request has an email, and is not withdrawn unless the action is one a withdrawn request allows
 * (revoke, by the machine).
 */
export const requestOpen = (event: RequestEvent) =>
	unless(
		term(
			`the request has an email, and is not withdrawn unless ${event} is allowed from withdrawn`,
			(given: Requested) =>
				Boolean(given.request.email) &&
				(given.request.status !== "withdrawn" ||
					next(softwareRequest, "withdrawn", event) !== null),
		),
		() => new RequestClosed(),
	);

/** The machine allows the action from the request's stored status; otherwise the refusal `refuse` makes. */
export const statusAllows = <E extends Refusal>(
	event: RequestEvent,
	refuse: () => E,
) =>
	unless(
		term(
			`the request's status allows ${event}`,
			(given: Requested) =>
				next(softwareRequest, given.request.status, event) !== null,
		),
		refuse,
	);

/** Whether a live link of the request was made in the last 20 seconds (`created_at` later than the time read less 20 s). */
export type SendingRead = { readonly sending: boolean };

/** OfferStillSending: no live link of the request was made in the last 20 seconds (G5). */
export const notSending = unless(
	term(
		"no live link of the request was made in the last 20 seconds",
		(given: SendingRead) => !given.sending,
	),
	() => new OfferStillSending(),
);

/** What G1 compares at write time: the request row as it was read. */
export type RequestRead = {
	readonly id: string;
	readonly updatedAt: string;
	readonly status: SoftwareRequest["status"];
	readonly email: string;
};

export const requestRead = (request: SoftwareRequest): RequestRead => ({
	id: request.id,
	updatedAt: request.updatedAt,
	status: request.status,
	email: request.email,
});

/**
 * The write time: the time the flow read, or one millisecond after the version that was read when that is not earlier,
 * so a write never stamps a time before the row it follows. The version is the request's updated_at for fit, question
 * and decline, the open draft's for draft and send; revoke writes the time as read.
 */
export const writeTime = (now: string, versionRead: string | null) =>
	versionRead !== null && Date.parse(versionRead) >= Date.parse(now)
		? new Date(Date.parse(versionRead) + 1).toISOString()
		: now;

/** How long an abandoned review is kept after signing is retired. */
const RETAIN_ABANDONED_MS = 90 * 86400000;

/** Signing retired at a time: reviews abandoned (kept 90 days), drafts deleted, sessions revoked, links used. */
export type SigningRetired = {
	readonly at: string;
	readonly retainUntil: string;
};

/**
 * Signing retired (retireSigning), which decline, revoke and send share: its four statements are the store's
 * (src/lib/software-agreements.ts, `retireRequestSigning`); the time an abandoned review is kept until is decided here.
 */
export const retireSigning = (at: string): SigningRetired => ({
	at,
	retainUntil: new Date(Date.parse(at) + RETAIN_ABANDONED_MS).toISOString(),
});

/** An email's words, before it has an address. */
export type EmailWords = { readonly subject: string; readonly text: string };

/** The words of a question or a decline: the owner's text, signed. */
export const signedText = (text: string) => `${text}\n\nKazon`;

/** The mail settings, all set: CONTACT_FROM_EMAIL sends, OWNER_EMAIL is replied to and gets the copy. */
export type MailSettings = { readonly from: string; readonly owner: string };

/**
 * The client's email and the owner's copy, as the bridge sends them: the copy is the same email to the owner with its
 * subject marked "Copy: ". The flow builds them once the mail settings are known to be set.
 */
export const offerEmails = (
	settings: MailSettings,
	client: string,
	words: EmailWords,
): OfferEmails => ({
	client: {
		from: settings.from,
		reply_to: settings.owner,
		subject: words.subject,
		text: words.text,
		to: [client],
	},
	copy: {
		from: settings.from,
		reply_to: settings.owner,
		subject: `Copy: ${words.subject}`,
		text: words.text,
		to: [settings.owner],
	},
});

/** An attachment the details name, as `parseAgreementAttachments` reads it. */
export type NamedAttachment = {
	readonly filename: string;
	readonly version: string;
	readonly date: string;
	readonly sha256: string;
	readonly key: string;
	readonly bytes: number;
};

/** A metadata row of one of the request's attachments (`software_agreement_attachments`), as stored. */
export type AttachmentRow = {
	readonly object_key: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly filename: string;
	readonly version: string;
	readonly document_date: string;
};

/**
 * The closed archives as G11 reads them, over every agreement whose archive is closed: which of the named keys a manifest
 * names, and whether a manifest, or an entry of one, is not JSON. G11 reads each manifest with `json_each` and each entry
 * with `json_extract`, which raise "malformed JSON" on such a value: the guard's own message, so the batch is refused.
 */
export type ClosedArchives = {
	readonly keys: readonly string[];
	readonly unreadable: boolean;
};

/** What G11 checks, read first: the request's metadata rows for the named keys, and the closed archives. */
export type AttachmentsRead = {
	readonly rows: readonly AttachmentRow[];
	readonly closed: ClosedArchives;
};

/** The attachment is in no closed archive, and every closed archive reads (G11's `NOT EXISTS` refuses either). */
export const outsideClosedArchives = (
	attachment: NamedAttachment,
	closed: ClosedArchives,
) => !closed.unreadable && !closed.keys.includes(attachment.key);

/**
 * Each named attachment has its metadata row, unchanged (with SQL's `=` on each column), in no closed archive, and every
 * closed archive reads (G11). With none named there is nothing to check, as the batch then has no G11.
 */
export const attachmentsUsable = (
	named: readonly NamedAttachment[],
	read: AttachmentsRead,
) =>
	named.every(
		(attachment) =>
			outsideClosedArchives(attachment, read.closed) &&
			read.rows.some(
				(row) =>
					row.object_key === attachment.key &&
					row.sha256 === attachment.sha256 &&
					row.bytes === attachment.bytes &&
					row.filename === attachment.filename &&
					row.version === attachment.version &&
					row.document_date === attachment.date,
			),
	);

/** AgreementSigned: no `client_signed` or `executed` agreement of the request was read (G3). */
export const noSignedAgreement = unless(
	term(
		"the request has no client_signed or executed agreement",
		(given: { readonly signedAgreement: boolean }) => !given.signedAgreement,
	),
	() => new AgreementSigned(),
);
