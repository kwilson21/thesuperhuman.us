// The resume flows: sequences that act between decisions, so they are Effect programs that call services (not pure rules).
// A visitor asks for
// the resume (`requestResume`): the request is stored for seven days and the owner is emailed a single-use link. The owner
// opens the link (`approveResume`): the PDF is emailed to the visitor and the request is deleted, only once the email
// has gone. Each flow reads what it needs through services and fails with a named refusal; a refusal carries facts, and
// the route words and escapes the page. The time, the id and the origin are plain inputs.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { resumeApprovalMessage, resumeDeliveryMessage } from "../../lib/resend";
import {
	type ResumeAudience,
	createResumeRequest,
	deleteResumeRequest,
	getResumeRequest,
} from "../../lib/resume-requests";
import { RESUME_FILENAMES, loadResume } from "../../lib/resumes";
import type { ResumeRequestInput } from "../contact-input";
import { Mail, ResumeStore } from "../services";
import { type Visitor, passGuards } from "./guards";

/** Resend did not take the approval email, so the owner has no link to click. */
export class ResumeRequestNotSent extends Data.TaggedError(
	"ResumeRequestNotSent",
) {
	readonly say =
		"Could not send the request right now. Please email kazon.wilson@thesuperhuman.us directly.";
}

export type ResumeRequestSubmission = {
	readonly input: ResumeRequestInput;
	readonly visitor: Visitor;
	/** The time of the request, in milliseconds, stored with it. */
	readonly now: number;
	/** The new request's id, which is in the approval link. */
	readonly id: string;
	/** The origin the request came to, so a preview deployment links to itself. */
	readonly origin: string;
	/** env.CONTACT_FROM_EMAIL */
	readonly from: string;
	/** env.CONTACT_TO_EMAIL */
	readonly to: string;
};

export const requestResume = (submission: ResumeRequestSubmission) =>
	Effect.gen(function* () {
		const { input, visitor, now, id, origin, from, to } = submission;

		yield* passGuards(visitor);

		const store = yield* ResumeStore;

		const request = {
			name: input.name,
			email: input.email,
			company: input.company,
			audience: input.audience,
			note: input.note,
		};

		// A defect is intended here, not a refusal: the old route let a KV failure escape as an unanswered 500, and the golden corpus proves it.
		yield* Effect.promise(() => createResumeRequest(store, request, id, now));

		const approvalUrl = new URL(
			`/api/resume-approve?id=${id}`,
			origin,
		).toString();

		const mail = yield* Mail;

		yield* mail
			.send(
				resumeApprovalMessage({
					request: { ...request, ts: now },
					from,
					to,
					approvalUrl,
				}),
			)
			.pipe(Effect.mapError(() => new ResumeRequestNotSent()));
	});

/** The approval link has no id. */
export class MissingRequestId extends Data.TaggedError("MissingRequestId") {
	readonly say = "This link is malformed.";
}

/** No request is stored under the id: it was used already, or its seven days passed. */
export class RequestNotFound extends Data.TaggedError("RequestNotFound") {
	readonly say =
		"This approval link has either been used already or expired. Requests are single-use and live for seven days.";
}

/** The PDF for the request's audience is not in the store. The request stays saved. */
export class ResumePdfMissing extends Data.TaggedError("ResumePdfMissing")<{
	readonly audience: ResumeAudience;
}> {}

/** Resend did not take the email with the PDF. The request stays saved, so the link can be tried again. */
export class ResumeNotSent extends Data.TaggedError("ResumeNotSent")<{
	readonly requesterName: string;
	readonly email: string;
}> {}

export type ResumeApproval = {
	/** The `id` query parameter of the link, or null when it has none (or an empty one). */
	readonly id: string | null;
	/** env.CONTACT_FROM_EMAIL */
	readonly from: string;
};

/** Emails the resume to the person who asked, deletes the request, and answers who it went to and which resume. */
export const approveResume = (approval: ResumeApproval) =>
	Effect.gen(function* () {
		const { id, from } = approval;

		if (!id) return yield* Effect.fail(new MissingRequestId());

		const store = yield* ResumeStore;
		// A defect is intended here, not a refusal: the old route let a KV failure escape as an unanswered 500, and the golden corpus proves it.
		const stored = yield* Effect.promise(() => getResumeRequest(store, id));

		if (!stored) return yield* Effect.fail(new RequestNotFound());

		// A defect is intended here, not a refusal: the old route let a KV failure escape as an unanswered 500, and the golden corpus proves it.
		const pdf = yield* Effect.promise(() => loadResume(store, stored.audience));

		if (!pdf) {
			return yield* Effect.fail(
				new ResumePdfMissing({ audience: stored.audience }),
			);
		}

		const mail = yield* Mail;

		yield* mail
			.send(
				resumeDeliveryMessage({
					from,
					to: stored.email,
					name: stored.name,
					pdf,
					filename: RESUME_FILENAMES[stored.audience],
				}),
			)
			.pipe(
				Effect.mapError(
					() =>
						new ResumeNotSent({
							requesterName: stored.name,
							email: stored.email,
						}),
				),
			);

		// Only delete on confirmed send success (single-use, prevents replay).
		// A defect is intended here, not a refusal: the old route let a KV failure escape as an unanswered 500, and the golden corpus proves it.
		yield* Effect.promise(() => deleteResumeRequest(store, id));

		return { audience: stored.audience, email: stored.email };
	});
