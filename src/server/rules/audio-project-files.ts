// What the owner's publish and revoke of a project file decide, from the facts the flow read: the file, the project's stage
// and access, the request's status, the payments, the live review files and the published files of the project
// (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 4). Each decision is re-checked at write time by the
// write's own conditions in src/server/audio-project-store.ts (P2 to P5, FR2 to FR5: the file's status, the project open, the
// request not withdrawn, the booking paid, the stage the version may be published in), so a request that lost a race is
// refused by the write and answers 409 at once. Two batch guards raise instead, and `decideAndSave` reads and decides again:
// P3's (the live review files are the ones read) and FR3's (the stage and the version's other published files are the ones
// read). The stage reset after a revoke is decided here, from the stage and the other published files. The access also
// closes in the owner status area through the trigger audio_project_close_declined_request (migration 0015), the second
// writer of revoked_at besides the access route and a client's stop; every write guard here checks it.
import * as Data from "effect/Data";
import { privateProjectObjectKey } from "../../lib/audio-project-files";
import { FILE_MOVES } from "../machines/project-file";
import { PROJECT_MOVES, type ProjectStage } from "../machines/audio-project";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredProject, StoredRequest } from "./audio-project-messages";
import { proved } from "./software-request";

/** The file cannot be published: it is not an uploaded file with its object, or the project cannot take it now. 409. */
export class FileNotPublishable extends Data.TaggedError("FileNotPublishable") {
	readonly say =
		"This file cannot be published yet. Check the project and payment state.";
}

/** The file cannot be revoked: it is not uploaded or published, a shared file has no note, or the project is closed. 409. */
export class FileNotRevocable extends Data.TaggedError("FileNotRevocable") {
	readonly say =
		"This file cannot be revoked here. A shared file needs a short note to the client.";
}

/** The booking and the balance of a project's payment, as stored. */
export type StoredPayment = {
	readonly booking_status: string;
	readonly balance_status: string;
};

/** The file a publish reads: its row as stored. */
export type StoredDraftFile = {
	readonly id: string;
	readonly request_id: string;
	readonly version: "review" | "final";
	readonly object_key: string;
	readonly media_type: "audio/mpeg" | "audio/wav";
	readonly byte_size: number;
	readonly status: string;
};

/** A published file of the project, as stored. */
export type PublishedFile = {
	readonly id: string;
	readonly version: "review" | "final";
};

const actorGiven = (request: { readonly actor: string }, _facts: null) =>
	request.actor.trim() !== "";

/** A publish is made by an owner whose email is not blank. This is the first check, before anything is read. */
export const publishActor = alwaysWrites({
	name: "name the owner who publishes",
	given: actorGiven,
	refusals: [
		unless(
			term("the owner's email is not blank", (named: boolean) => named),
			() => new FileNotPublishable(),
		),
	],
	writes: () => null,
	writesText: "nothing: the owner is named",
});

/** A revoke is made by an owner whose email is not blank. This is the first check, before anything is read. */
export const revokeActor = alwaysWrites({
	name: "name the owner who revokes",
	given: actorGiven,
	refusals: [
		unless(
			term("the owner's email is not blank", (named: boolean) => named),
			() => new FileNotRevocable(),
		),
	],
	writes: () => null,
	writesText: "nothing: the owner is named",
});

type DraftGiven = {
	readonly requestId: string;
	readonly file: StoredDraftFile | null;
};

/** The file is uploaded, not yet published, and its object key is the one the project and the file name make. */
export const draftFile = alwaysWrites({
	name: "find the uploaded file to publish",
	given: (
		request: { readonly requestId: string },
		facts: { readonly file: StoredDraftFile | null },
	): DraftGiven => ({ requestId: request.requestId, file: facts.file }),
	refusals: [
		unless(
			term("the file exists", (given: DraftGiven) => given.file !== null),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"the file is uploaded and not yet published",
				(given: DraftGiven) =>
					given.file !== null &&
					FILE_MOVES.PUBLISH.some((status) => status === given.file?.status),
			),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"the file's object key is the one its project and name make",
				(given: DraftGiven) =>
					given.file !== null &&
					given.file.object_key ===
						privateProjectObjectKey(
							given.requestId,
							given.file.id,
							given.file.media_type,
						),
			),
			() => new FileNotPublishable(),
		),
	],
	writes: (given) => proved(given.file),
	writesText: "the file to publish",
});

/** The bucket holds the file's object, and it is the size the row says. */
export const objectOfFile = alwaysWrites({
	name: "check the object of the file to publish",
	given: (
		request: { readonly object: { readonly size: number } | null },
		facts: { readonly file: StoredDraftFile },
	) => ({ object: request.object, file: facts.file }),
	refusals: [
		unless(
			term(
				"the object exists and is the size the row says",
				(given: {
					readonly object: { readonly size: number } | null;
					readonly file: StoredDraftFile;
				}) =>
					given.object !== null && given.object.size === given.file.byte_size,
			),
			() => new FileNotPublishable(),
		),
	],
	writes: () => null,
	writesText: "nothing: the object is there",
});

type ProjectFacts = {
	readonly project: StoredProject | null;
	readonly request: StoredRequest | null;
	readonly payment: StoredPayment | null;
};

type PublishGiven = ProjectFacts & {
	readonly file: StoredDraftFile;
	readonly live: readonly PublishedFile[];
};

/**
 * The project takes the file: its access is open, the request is not withdrawn, the booking is paid (and, for a final, the
 * balance), and its stage is one the version may be published in. A published review is replaced by any file published, so
 * the write revokes the live review files this decision names.
 */
export const publishableProject = alwaysWrites({
	name: "publish a file into its project",
	given: (
		request: { readonly file: StoredDraftFile },
		facts: ProjectFacts & { readonly live: readonly PublishedFile[] },
	): PublishGiven => ({ ...facts, file: request.file }),
	refusals: [
		unless(
			term(
				"the project's access is open",
				(given: PublishGiven) =>
					given.project !== null && given.project.revoked_at === null,
			),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"the request is not withdrawn",
				(given: PublishGiven) =>
					given.request !== null && given.request.status !== "withdrawn",
			),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"the booking is paid",
				(given: PublishGiven) => given.payment?.booking_status === "paid",
			),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"a final's balance is paid",
				(given: PublishGiven) =>
					given.file.version !== "final" ||
					given.payment?.balance_status === "paid",
			),
			() => new FileNotPublishable(),
		),
		unless(
			term(
				"the stage lets this version be published",
				(given: PublishGiven) =>
					given.project !== null &&
					stagesToPublish(given.file.version).some(
						(stage) => stage === given.project?.stage,
					),
			),
			() => new FileNotPublishable(),
		),
	],
	writes: (given) => ({
		targetStage: targetStage(given.file.version),
		supersedes: given.live
			.filter((file) => file.version === "review" && file.id !== given.file.id)
			.map((file) => file.id),
	}),
	writesText:
		"the file as published, the project's new stage and the live review files it replaces",
});

/** The stages a file of this version may be published in, read from the project machine. */
export const stagesToPublish = (version: "review" | "final") =>
	version === "review"
		? PROJECT_MOVES.PUBLISH_REVIEW.from
		: PROJECT_MOVES.PUBLISH_FINAL.from;

/** The stage a published file of this version puts the project in. */
export const targetStage = (version: "review" | "final") =>
	version === "review"
		? PROJECT_MOVES.PUBLISH_REVIEW.to
		: PROJECT_MOVES.PUBLISH_FINAL.to;

/** What a revoke reads of the file. */
export type StoredRevokeFile = {
	readonly version: "review" | "final";
	readonly status: string;
};

type RevokeFileGiven = {
	readonly file: StoredRevokeFile | null;
	readonly note: string;
	readonly firstStatus: string | null;
};

/**
 * The file is uploaded or published, is still the status the request's first read saw (a check against what the owner's
 * action saw is a refusal here, never something a retry may satisfy), and a published file has a note of 1 to 1,000
 * characters for the client.
 */
export const revocableFile = alwaysWrites({
	name: "find the file to revoke",
	given: (
		request: { readonly note: string; readonly firstStatus: string | null },
		facts: { readonly file: StoredRevokeFile | null },
	): RevokeFileGiven => ({
		file: facts.file,
		note: request.note,
		firstStatus: request.firstStatus,
	}),
	refusals: [
		unless(
			term(
				"the file exists and is uploaded or published",
				(given: RevokeFileGiven) =>
					given.file !== null &&
					FILE_MOVES.REVOKE.some((status) => status === given.file?.status),
			),
			() => new FileNotRevocable(),
		),
		unless(
			term(
				"the file is the status the first read saw",
				(given: RevokeFileGiven) =>
					given.firstStatus === null ||
					given.file?.status === given.firstStatus,
			),
			() => new FileNotRevocable(),
		),
		unless(
			term(
				"a published file has a note of 1 to 1,000 characters",
				(given: RevokeFileGiven) =>
					given.file?.status !== "published" ||
					(given.note.length >= 1 && given.note.length <= 1000),
			),
			() => new FileNotRevocable(),
		),
	],
	writes: (given) => ({
		file: proved(given.file),
		note: given.note,
	}),
	writesText: "the file to revoke and the note",
});

type RevokeGiven = {
	readonly file: StoredRevokeFile;
	readonly fileId: string;
	readonly project: StoredProject | null;
	readonly published: readonly PublishedFile[];
};

/**
 * The project is open, and the revoke's stage reset: when no other published file of the version is left and the stage is
 * the one the version resets (review_ready for a review; final_files_ready or complete for a final), the project returns to
 * in_progress so a replacement can be uploaded and published. The write keeps the other published files it was decided
 * from as its guard, and the stage too when it decided a reset.
 */
export const revokeInProject = alwaysWrites({
	name: "revoke a file in its project",
	given: (
		request: { readonly file: StoredRevokeFile; readonly fileId: string },
		facts: {
			readonly project: StoredProject | null;
			readonly published: readonly PublishedFile[];
		},
	): RevokeGiven => ({ ...request, ...facts }),
	refusals: [
		unless(
			term(
				"the project's access is open",
				(given: RevokeGiven) =>
					given.project !== null && given.project.revoked_at === null,
			),
			() => new FileNotRevocable(),
		),
	],
	writes: (given) => {
		const project = proved(given.project);

		const others = given.published
			.filter(
				(file) =>
					file.version === given.file.version && file.id !== given.fileId,
			)
			.map((file) => file.id);

		const resets =
			others.length === 0 &&
			resetStages(given.file.version).some((stage) => stage === project.stage);

		return {
			stage: project.stage,
			others,
			reset: resets,
		};
	},
	writesText:
		"the stage read, the other published files of the version, and whether the project returns to in_progress",
});

/** The stages a revoked last file of this version resets the project from, read from the project machine. */
export const resetStages = (
	version: "review" | "final",
): readonly ProjectStage[] =>
	version === "review"
		? PROJECT_MOVES.REVOKE_REVIEW.from
		: PROJECT_MOVES.REVOKE_FINAL.from;
