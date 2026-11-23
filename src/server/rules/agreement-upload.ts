// What the owner's upload of an agreement attachment (a PDF for a software request's agreement) decides, from the request,
// the bytes and what pdf-lib read of them (today's PUT in src/pages/api/owner/requests/[id]/agreement-attachments.ts;
// docs/plans/2026-11-signing-conversion.md, section 2, and fix B4). Outside work comes between the decisions, so the
// rule is staged, each stage deciding on what was read so far, in the order the route has always answered:
//   1. the signing setting, then the query (filename, version and date), the content type and a body: SigningOff,
//      UploadRefused "query" (uploadQuery). The setting is read before it; the body is read after it;
//   2. the body read within 10 MiB, then its first five bytes: UploadRefused "size" (the 413), UploadRefused "type"
//      (uploadBytes). pdf-lib is loaded after it; a module that cannot be loaded is the PDF check's 503, not a refusal;
//   3. the page count pdf-lib reads, or none when it cannot read the bytes: PdfUnreadable (B4), UploadRefused "pages"
//      (uploadPages). The digest is taken and the object put after it;
//   4. the request named by the route, read after the put: RequestNotFound (unknown, or not a software request),
//      RequestClosed (withdrawn or resolved) (acceptAttachment), which writes the attachment's row.
// Re-checked at write time by A24, the batch guard that the request is a software request neither withdrawn nor
// resolved. A guard that raised is not retried: the request is read again and `refusedUpload` answers, as today, from its
// kind alone. A refused upload deletes the object it put, unless its row was saved, as today.
import * as Data from "effect/Data";
import {
	type AttachmentQuery,
	readAttachmentQuery,
} from "../../lib/agreement-owner-input";
import { alwaysWrites, term, unless } from "../terms";
import { SigningOff } from "./signing-offer";
import { RequestNotFound } from "./software-request";

export { RequestNotFound };

/** The most bytes one attachment may have: the body is read up to this and refused past it. */
export const ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;

/** The object key of an attachment, from its id: the object is put under it before the request is read. */
export const attachmentKey = (id: string) => `agreements/attachments/${id}.pdf`;

/** Which check an upload failed: each answers 400 with its own sentence, but the size, which answers 413. */
export type UploadProblem = "query" | "size" | "type" | "pages";

const UPLOAD_SENTENCES: Readonly<Record<UploadProblem, string>> = {
	query: "Choose a PDF, version and date.",
	size: "Keep each PDF under 10 MiB.",
	type: "The file must be a PDF.",
	pages: "The PDF has no pages.",
};

/** The upload is refused before it is stored; `problem` names the check, and with it the sentence. */
export class UploadRefused extends Data.TaggedError("UploadRefused")<{
	readonly problem: UploadProblem;
}> {
	get say() {
		return UPLOAD_SENTENCES[this.problem];
	}
}

/** pdf-lib could not read the bytes (or count their pages): bad input, 400 (B4). */
export class PdfUnreadable extends Data.TaggedError("PdfUnreadable") {
	readonly say =
		"The PDF could not be validated. Use a supported PDF or sign outside the website.";
}

/** The request is withdrawn or resolved, or its batch guard raised: 409 (B4). */
export class RequestClosed extends Data.TaggedError("RequestClosed") {
	readonly say = "The attachment could not be saved.";
}

/** The signing setting as stored, or null when its row is missing. */
export type StoredSigningSetting = {
	readonly software_signing_enabled: number;
};

type QueryGiven = {
	readonly enabled: boolean;
	readonly query: AttachmentQuery | null;
	readonly isPdf: boolean;
	readonly hasBody: boolean;
};

/** Stage 1: signing is on, and the query reads, the content type is a PDF's and there is a body. */
export const uploadQuery = alwaysWrites({
	name: "upload: signing is on, and the query, type and body are there",
	given: (
		request: {
			/** The URL's search parameters, by name. */
			readonly query: Readonly<Record<string, string>>;
			readonly contentType: string | null;
			readonly hasBody: boolean;
		},
		facts: StoredSigningSetting | null,
	): QueryGiven => {
		const read = readAttachmentQuery(request.query);

		return {
			enabled: Boolean(facts?.software_signing_enabled),
			query: read.ok ? read.value : null,
			isPdf: request.contentType === "application/pdf",
			hasBody: request.hasBody,
		};
	},
	refusals: [
		unless(
			term("website signing is on", (given: QueryGiven) => given.enabled),
			() => new SigningOff(),
		),
		unless(
			term(
				"the query names a filename, version and date, the content type is a PDF's, and there is a body",
				(given: QueryGiven) =>
					given.query !== null && given.isPdf && given.hasBody,
			),
			() => new UploadRefused({ problem: "query" }),
		),
	],
	// SAFETY: `writes` runs only once the refusals above passed, which ruled out a query that does not read.
	writes: (given) => given.query as AttachmentQuery,
	writesText: "the filename, version and date the query names",
});

type BytesGiven = { readonly bytes: ArrayBuffer | null };

/** The first five bytes of a PDF, read as today: decoded as UTF-8 and compared as text. */
const startsLikePdf = (bytes: ArrayBuffer) =>
	new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";

/** Stage 2: the body was within 10 MiB, and starts as a PDF does. */
export const uploadBytes = alwaysWrites({
	name: "upload: the body is within 10 MiB and starts as a PDF",
	given: (
		request: {
			/** The body, or null when it ran past `ATTACHMENT_LIMIT_BYTES`. */
			readonly bytes: ArrayBuffer | null;
		},
		_facts: null,
	): BytesGiven => request,
	refusals: [
		unless(
			term(
				"the body is within 10 MiB",
				(given: BytesGiven) => given.bytes !== null,
			),
			() => new UploadRefused({ problem: "size" }),
		),
		unless(
			term(
				"the body starts with %PDF-",
				(given: BytesGiven) =>
					given.bytes !== null && startsLikePdf(given.bytes),
			),
			() => new UploadRefused({ problem: "type" }),
		),
	],
	// SAFETY: `writes` runs only once the refusals above passed, which ruled out a body past the limit.
	writes: (given) => given.bytes as ArrayBuffer,
	writesText: "the bytes, for pdf-lib to read",
});

type PagesGiven = { readonly pages: number | null };

/** Stage 3: pdf-lib read the bytes, and they have a page. */
export const uploadPages = alwaysWrites({
	name: "upload: pdf-lib reads the PDF, and it has a page",
	given: (
		request: {
			/** The page count pdf-lib read, or null when it could not load the bytes or count their pages. */
			readonly pages: number | null;
		},
		_facts: null,
	): PagesGiven => request,
	refusals: [
		unless(
			term(
				"pdf-lib could read the bytes",
				(given: PagesGiven) => given.pages !== null,
			),
			() => new PdfUnreadable(),
		),
		unless(
			term("the PDF has a page", (given: PagesGiven) => Boolean(given.pages)),
			() => new UploadRefused({ problem: "pages" }),
		),
	],
	writes: () => ({}),
	writesText: "nothing: the digest is taken and the object put next",
});

/** The request an attachment is for, as stored, or null when no request has the id. */
export type StoredUploadRequest = {
	readonly kind: string;
	readonly status: string;
};

/** The attachment's row, as inserted (the columns in the table's order). */
export type AttachmentRow = {
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

type AttachGiven = {
	readonly request: StoredUploadRequest | null;
	readonly row: AttachmentRow;
};

const softwareRequest = unless(
	term(
		"the request is a software request",
		(given: { readonly request: StoredUploadRequest | null }) =>
			given.request?.kind === "software",
	),
	() => new RequestNotFound(),
);

/** Stage 4: the request is an open software request, and the attachment's row is written. */
export const acceptAttachment = alwaysWrites({
	name: "upload: the attachment is for an open software request",
	given: (
		request: {
			readonly id: string;
			/** The request id the route names (empty when it names none, which no request has). */
			readonly requestId: string;
			readonly query: AttachmentQuery;
			readonly sha256: string;
			readonly bytes: number;
			readonly at: Date;
			/** The owner's email. */
			readonly owner: string;
		},
		facts: StoredUploadRequest | null,
	): AttachGiven => ({
		request: facts,
		row: {
			id: request.id,
			request_id: request.requestId,
			filename: request.query.filename,
			version: request.query.version,
			document_date: request.query.date,
			object_key: attachmentKey(request.id),
			sha256: request.sha256,
			bytes: request.bytes,
			created_at: request.at.toISOString(),
			created_by: request.owner,
		},
	}),
	refusals: [
		softwareRequest,
		unless(
			term(
				"the request is neither withdrawn nor resolved",
				(given: AttachGiven) =>
					given.request !== null &&
					given.request.status !== "withdrawn" &&
					given.request.status !== "resolved",
			),
			() => new RequestClosed(),
		),
	],
	writes: (given) => given.row,
	writesText:
		"the attachment's row, with its key, digest, size, time and owner",
});

/**
 * The answer to an upload whose batch guard raised, from the request read again: an unknown or other request is not
 * found, and a software request changed since it was read, so it answers as closed whatever its status reads now (today's
 * `refusedUpload` reads its kind alone).
 */
export const refusedUpload = alwaysWrites({
	name: "upload: answer a batch whose guard raised",
	given: (_request: null, facts: StoredUploadRequest | null) => ({
		request: facts,
	}),
	refusals: [
		softwareRequest,
		unless(
			term("the batch was not refused, which it was", () => false),
			() => new RequestClosed(),
		),
	],
	writes: () => ({}),
	writesText: "nothing: a refused batch always answers a refusal",
});
