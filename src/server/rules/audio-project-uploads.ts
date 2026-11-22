// What the owner's file uploads decide, from the facts the flow read: the project's stage and access, the request's status, the
// payment, the upload row and the parts the owner sends (docs/plans/2026-11-audio-projects-conversion.md, sections 2, 3 and 4).
// A file may be uploaded in the stages it may be published in (the project machine's publish moves). Each decision is
// re-checked at write time by the write's own conditions in src/server/audio-project-store.ts (S2 and S4: the project open,
// the request not withdrawn, the booking paid, the stage; S4 also the upload still pending; S7 and S9: no file row for the
// upload), so a request that lost a race is refused by the write and answers what a refused write answers today. The access
// also closes in the owner status area through the trigger audio_project_close_declined_request (migration 0015), the second
// writer of revoked_at besides the access route and a client's stop.
import * as Data from "effect/Data";
import { privateProjectObjectKey } from "../../lib/audio-project-files";
import {
	expectedPartLength,
	maxPartEtagLength,
	uploadPartSize,
} from "../../lib/audio-project-uploads";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredProject, StoredRequest } from "./audio-project-messages";
import { type StoredPayment, stagesToPublish } from "./audio-project-files";
import { proved } from "./software-request";

/** The project cannot take a file now. 409. */
export class UploadNotReady extends Data.TaggedError("UploadNotReady") {
	readonly say = "This project is not ready for file upload.";
}

/** The upload is not the project's, or is gone. 404. */
export class UploadGone extends Data.TaggedError("UploadGone") {
	readonly say = "This upload is no longer available.";
}

/** The object is not the size the owner said. 409. */
export class UploadSizeMismatch extends Data.TaggedError("UploadSizeMismatch") {
	readonly say = "The file size did not match. It was not published.";
}

/** The upload cannot be finished: it is being discarded, the project cannot take it, its parts do not add up, or R2 lost it. 409. */
export class UploadNotFinishable extends Data.TaggedError(
	"UploadNotFinishable",
) {
	readonly say = "This upload cannot be finished now.";
}

/** The part has a length or a number the upload does not have. 400. */
export class PartWrongSize extends Data.TaggedError("PartWrongSize") {
	readonly say = "This file part has the wrong size.";
}

/** The part cannot be put now: the upload is being discarded or R2 no longer has it. 409. */
export class PartNotUploadable extends Data.TaggedError("PartNotUploadable") {
	readonly say = "This part could not be uploaded. Please try again.";
}

/** The upload row as stored. */
export type StoredUpload = {
	readonly id: string;
	readonly request_id: string;
	readonly upload_id: string;
	readonly object_key: string;
	readonly version: "review" | "final";
	readonly display_name: string;
	readonly media_type: "audio/mpeg" | "audio/wav";
	readonly byte_size: number;
	readonly state: "pending" | "discarding";
	readonly created_at: string;
};

type Readiness = {
	readonly project: StoredProject | null;
	readonly request: StoredRequest | null;
	readonly payment: StoredPayment | null;
};

type ReadyGiven = Readiness & { readonly version: "review" | "final" };

/** Whether the project takes a file of this version: access open, request not withdrawn, booking paid, a stage it may be published in. */
const takesFile = (given: ReadyGiven) =>
	given.project !== null &&
	given.project.revoked_at === null &&
	given.request !== null &&
	given.request.status !== "withdrawn" &&
	given.payment?.booking_status === "paid" &&
	stagesToPublish(given.version).some(
		(stage) => stage === given.project?.stage,
	);

const readyGiven = (
	request: { readonly version: "review" | "final" },
	facts: Readiness,
): ReadyGiven => ({ ...facts, version: request.version });

const readyTerm = term(
	"the project takes a file of this version: its access is open, the request is not withdrawn, the booking is paid and the stage allows it",
	takesFile,
);

/** A start, or a part, is taken while the project takes a file of its version. */
export const projectTakesUpload = alwaysWrites({
	name: "take an upload into the project",
	given: readyGiven,
	refusals: [unless(readyTerm, () => new UploadNotReady())],
	writes: () => null,
	writesText: "nothing: the project is ready",
});

/** A completion is finished while the project takes a file of its version. */
export const projectTakesFinishedUpload = alwaysWrites({
	name: "finish an upload into the project",
	given: readyGiven,
	refusals: [unless(readyTerm, () => new UploadNotFinishable())],
	writes: () => null,
	writesText: "nothing: the project is ready",
});

/** The object key of a new upload: a request id that cannot make an R2 key makes none, and the project is not ready for it. */
export const newUploadKey = alwaysWrites({
	name: "make the key of a new upload's object",
	given: (
		request: {
			readonly requestId: string;
			readonly id: string;
			readonly mediaType: "audio/mpeg" | "audio/wav";
		},
		_facts: null,
	) =>
		privateProjectObjectKey(request.requestId, request.id, request.mediaType),
	refusals: [
		unless(
			term("the key can be made", (key: string | null) => key !== null),
			() => new UploadNotReady(),
		),
	],
	writes: (key) => proved(key),
	writesText: "the object key",
});

/** The upload row exists in the project. */
export const existingUpload = alwaysWrites({
	name: "find the upload of the project",
	given: (_request: null, facts: { readonly upload: StoredUpload | null }) =>
		facts.upload,
	refusals: [
		unless(
			term(
				"the upload exists",
				(upload: StoredUpload | null) => upload !== null,
			),
			() => new UploadGone(),
		),
	],
	writes: (upload) => proved(upload),
	writesText: "the upload",
});

/** The upload row is pending, so it may be finished. */
export const pendingToFinish = alwaysWrites({
	name: "finish a pending upload",
	given: (_request: null, upload: StoredUpload) => upload.state,
	refusals: [
		unless(
			term("the upload is pending", (state: string) => state === "pending"),
			() => new UploadNotFinishable(),
		),
	],
	writes: () => null,
	writesText: "nothing: the upload is pending",
});

/** The upload row is pending, so a part may be put. */
export const pendingToPut = alwaysWrites({
	name: "put a part into a pending upload",
	given: (_request: null, upload: StoredUpload) => upload.state,
	refusals: [
		unless(
			term("the upload is pending", (state: string) => state === "pending"),
			() => new PartNotUploadable(),
		),
	],
	writes: () => null,
	writesText: "nothing: the upload is pending",
});

type PartsGiven = {
	readonly parts: readonly {
		readonly partNumber: number;
		readonly etag: string;
	}[];
	readonly count: number;
};

/** With no object in R2 yet, the parts the owner sends are the file's parts: all of them, in order, with entity tags. */
export const completionParts = alwaysWrites({
	name: "complete an upload from its parts",
	given: (
		request: {
			readonly parts: PartsGiven["parts"] | null;
			readonly byteSize: number;
		},
		_facts: null,
	) => ({
		parts: request.parts,
		count: Math.ceil(request.byteSize / uploadPartSize),
	}),
	refusals: [
		unless(
			term(
				"the parts are every part of the file, in order, with entity tags",
				(given: {
					readonly parts: PartsGiven["parts"] | null;
					readonly count: number;
				}) =>
					given.parts !== null &&
					given.parts.length === given.count &&
					given.parts.every(
						(part, index) =>
							part.partNumber === index + 1 &&
							part.etag.length > 0 &&
							part.etag.length <= maxPartEtagLength,
					),
			),
			() => new UploadNotFinishable(),
		),
	],
	writes: (given) => proved(given.parts),
	writesText: "the parts to complete the upload with",
});

/** The object R2 holds is the size the owner said. */
export const objectOfUpload = alwaysWrites({
	name: "check the object of an upload",
	given: (request: { readonly size: number }, upload: StoredUpload) =>
		request.size === upload.byte_size,
	refusals: [
		unless(
			term("the object is the size the upload says", (same: boolean) => same),
			() => new UploadSizeMismatch(),
		),
	],
	writes: () => null,
	writesText: "nothing: the object is the size",
});

/** A file row of the upload exists, from the insert or from an earlier completion. */
export const fileOfUpload = alwaysWrites({
	name: "find the file of an upload",
	given: (_request: null, facts: { readonly fileId: string | null }) =>
		facts.fileId,
	refusals: [
		unless(
			term("the file row exists", (id: string | null) => id !== null),
			() => new UploadNotFinishable(),
		),
	],
	writes: (id) => proved(id),
	writesText: "the file's id",
});

/** The part is one of the upload's parts, and the length the request says is the part's. */
export const partOfUpload = alwaysWrites({
	name: "check a part against its upload",
	given: (
		request: {
			readonly part: number;
			readonly contentLength: string | null;
		},
		upload: StoredUpload,
	) => ({
		length: expectedPartLength(upload.byte_size, request.part),
		contentLength: request.contentLength,
	}),
	refusals: [
		unless(
			term(
				"the part exists and a stated length is its length",
				(given: {
					readonly length: number | null;
					readonly contentLength: string | null;
				}) =>
					given.length !== null &&
					(given.contentLength === null ||
						Number(given.contentLength) === given.length),
			),
			() => new PartWrongSize(),
		),
	],
	writes: (given) => proved(given.length),
	writesText: "the length the part must have",
});

/** The bytes read are the part's length. */
export const bodyOfPart = alwaysWrites({
	name: "check the bytes of a part",
	given: (
		request: { readonly body: ArrayBuffer | null },
		facts: { readonly length: number },
	) => ({ body: request.body, length: facts.length }),
	refusals: [
		unless(
			term(
				"the bytes are the part's length",
				(given: {
					readonly body: ArrayBuffer | null;
					readonly length: number;
				}) => given.body !== null && given.body.byteLength === given.length,
			),
			() => new PartWrongSize(),
		),
	],
	writes: (given) => proved(given.body),
	writesText: "the bytes of the part",
});
