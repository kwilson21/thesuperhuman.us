// What the client's read of one project file decides, from the facts the flow read: the studio session's email, the file, the
// project's stage and access, the request's email and status and the payments (docs/plans/2026-11-audio-projects-conversion.md,
// sections 2 and 3). Every refusal is one tag, `FileHidden`, so an unknown file, another client's file, a revoked file, an
// unpaid review and a closed project answer alike. The session itself (open, not expired, not revoked) is judged before this
// by `openStudioSession`. The file read writes only the access record (FA1), keyed by the file, the session and the kind, so
// no guard re-checks this decision. The request's email is not checked for blank here, as the join of the session's email to
// the request's alone decided before (no session has a blank email: sign-in refuses it).
import * as Data from "effect/Data";
import { privateProjectObjectKey } from "../../lib/audio-project-files";
import { PROJECT_MOVES } from "../machines/audio-project";
import { alwaysWrites, term, unless } from "../terms";
import type { StoredPayment } from "./audio-project-files";
import type { StoredProject, StoredRequest } from "./audio-project-messages";
import { proved } from "./software-request";

/** The client cannot be shown the file, and nothing says why. 404 "File not found". */
export class FileHidden extends Data.TaggedError("FileHidden") {
	readonly say = "File not found";
}

/** The file as the client's read stores it. */
export type StoredClientFile = {
	readonly id: string;
	readonly request_id: string;
	readonly version: "review" | "final";
	readonly object_key: string;
	readonly display_name: string;
	readonly media_type: "audio/mpeg" | "audio/wav";
	readonly byte_size: number;
	readonly downloadable: number;
	readonly status: string;
	readonly published_at: string | null;
	readonly expires_at: string | null;
	readonly revoked_at: string | null;
};

type Facts = {
	readonly file: StoredClientFile | null;
	readonly project: StoredProject | null;
	readonly request: StoredRequest | null;
	readonly payment: StoredPayment | null;
};

type Given = Facts & {
	readonly email: string;
	readonly requestId: string;
	readonly at: string;
	readonly now: Date;
	readonly download: boolean;
};

/** The stages a review is shown in: the one a published review sets and the one a revision begun from it sets. */
const REVIEW_STAGES: readonly string[] = [
	PROJECT_MOVES.PUBLISH_REVIEW.to,
	PROJECT_MOVES.BEGIN_REVISION.to,
];

/** The stages a final is shown in: the one a published final sets and the one a completion sets. */
const FINAL_STAGES: readonly string[] = [
	PROJECT_MOVES.PUBLISH_FINAL.to,
	PROJECT_MOVES.COMPLETE.to,
];

/** A final is kept one year from its publication. */
const finalStillKept = (publishedAt: string, now: Date) => {
	const delivered = new Date(publishedAt);

	if (Number.isNaN(delivered.valueOf())) return false;
	delivered.setUTCFullYear(delivered.getUTCFullYear() + 1);

	return now < delivered;
};

const shown = (given: Given) => {
	const { file, project, request, payment } = given;

	if (file === null || project === null || request === null) return false;

	const kept =
		file.version === "final"
			? file.expires_at !== null &&
				FINAL_STAGES.includes(project.stage) &&
				payment?.booking_status === "paid" &&
				payment.balance_status === "paid" &&
				file.published_at !== null &&
				finalStillKept(file.published_at, given.now)
			: REVIEW_STAGES.includes(project.stage) &&
				payment?.booking_status === "paid";

	return (
		request.email === given.email &&
		file.status === "published" &&
		file.published_at !== null &&
		file.published_at <= given.at &&
		file.revoked_at === null &&
		project.revoked_at === null &&
		request.status !== "withdrawn" &&
		(file.expires_at === null || file.expires_at > given.at) &&
		kept &&
		file.object_key ===
			privateProjectObjectKey(given.requestId, file.id, file.media_type)
	);
};

/** The client's session may read this file, and a download is for a file the owner made downloadable. */
export const serveProjectFile = alwaysWrites({
	name: "show a project file to the client",
	given: (
		request: {
			readonly requestId: string;
			readonly email: string;
			readonly now: Date;
			readonly download: boolean;
		},
		facts: Facts,
	): Given => ({
		...facts,
		email: request.email,
		requestId: request.requestId,
		at: request.now.toISOString(),
		now: request.now,
		download: request.download,
	}),
	refusals: [
		unless(
			term(
				"the file is published, not revoked or expired, and its project, payment and stage show it to the session's client",
				shown,
			),
			() => new FileHidden(),
		),
		unless(
			term(
				"a download is of a file the owner made downloadable",
				(given: Given) => !given.download || given.file?.downloadable === 1,
			),
			() => new FileHidden(),
		),
	],
	writes: (given) => proved(given.file),
	writesText: "the file to stream or download",
});
