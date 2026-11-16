// What the owner's and the client's message routes decide about an audio project, from the facts the flow read: the project's
// stage and access, the request's status and email, the client's session, the latest published review and the answers to
// it, the revision rounds begun, and the number of messages the client sent in the last 300 seconds
// (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 4). Each decision is re-checked at write time by the
// write's own conditions in src/server/audio-project-store.ts (M1 to M3, M7 and M8: the project is open, the stage, the
// request's status, the session, the count under the cap, the review still the latest), so a request that lost a race is
// refused by the write and answers what a refused write answers, never a retry. The lookup comes first: it answers the
// same hidden 404 for a project the client cannot show, and nothing after it runs. 429 beats every other refusal after it.
// The access also closes in the owner status area through the trigger audio_project_close_declined_request (migration
// 0015), the second writer of revoked_at besides the access route and a client's stop; every write guard here checks it.
import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import type { RawValue } from "../../lib/fields";
import {
	REVISION_ROUNDS,
	validateProjectMessage,
} from "../../lib/audio-project-messages";
import { alwaysWrites, rule, term, unless } from "../terms";
import { proved } from "./software-request";

/** The window the client's messages are counted over, and how many it may send in it. */
export const CLIENT_MESSAGE_WINDOW_MS = 300_000;

export const CLIENT_MESSAGE_LIMIT = 12;

/** The text a client's answer stores when it carries no notes of its own. */
export const DEFAULT_ANSWER_TEXT = {
	approved: "I approve this mix.",
	stopped: "I’m stopping the project here.",
} as const;

/** The project cannot be shown: no session or project, another client's, a closed one, a withdrawn request. 404 `{ok:false}`. */
export class ProjectHidden extends Data.TaggedError("ProjectHidden") {
	readonly say = "Not found";
}

/** A write the project cannot take now: the stage is complete, the access is closed, the request is withdrawn. 409 `{ok:false}`. */
export class MessageNotAccepted extends Data.TaggedError("MessageNotAccepted") {
	readonly say = "The project cannot take a message now.";
}

/** The client sent 12 messages in the last 300 seconds. */
export class ClientRateLimited extends Data.TaggedError("ClientRateLimited") {
	readonly say = "Please wait a few minutes before sending another message.";
}

/** The answer does not fit the review: the stage, the review awaiting an answer, the named review or the rounds. */
export class ReviewNotAnswerable extends Data.TaggedError(
	"ReviewNotAnswerable",
) {
	readonly say =
		"That answer is not available for this review. Refresh the page to see where your song stands.";
}

/** The text is empty, too long, has a control character or a link that is not https. */
export class MessageTextInvalid extends Data.TaggedError("MessageTextInvalid") {
	readonly say =
		"Write up to 4,000 characters. Shared links must start with https://.";
}

/** A request for changes without notes. */
export class ChangesNeedNotes extends Data.TaggedError("ChangesNeedNotes") {
	readonly say = "Write the changes you would like, up to 4,000 characters.";
}

/** The project as stored. */
export type StoredProject = {
	readonly request_id: string;
	readonly stage: string;
	readonly revoked_at: string | null;
};

/** The owner request as stored. */
export type StoredRequest = {
	readonly status: string;
	readonly email: string;
};

/** A file of the project as stored. */
export type StoredFile = {
	readonly id: string;
	readonly version: string;
	readonly status: string;
	readonly published_at: string | null;
};

/** A client message that answered a review, as stored. */
export type StoredDecision = { readonly created_at: string };

/** An update of the project as stored. */
export type StoredUpdate = { readonly milestone: string | null };

/** A message as stored: who wrote it and whether it was read. */
export type StoredMessage = {
	readonly actor: string;
	readonly read_at: string | null;
};

type Given<Request, Facts> = {
	readonly request: Request;
	readonly facts: Facts;
};

const given = <Request, Facts>(
	request: Request,
	facts: Facts,
): Given<Request, Facts> => ({ request, facts });

type OwnerFacts = {
	readonly project: StoredProject | null;
	readonly request: StoredRequest | null;
};

/** The owner writes to a project that exists. A missing project is a 404 `{ok:false}`, for a message and for a read mark alike. */
export const ownerProject = alwaysWrites({
	name: "find the project the owner writes to",
	given: (_request: null, facts: OwnerFacts) => facts,
	refusals: [
		unless(
			term("the project exists", (facts: OwnerFacts) => facts.project !== null),
			() => new ProjectHidden(),
		),
	],
	writes: (facts) => facts,
	writesText: "the project and its request",
});

type OwnerPost = { readonly body: string; readonly ownerEmail: string };

/** The owner's message is taken while the project is not complete, its access is open and the request is not withdrawn (M1). */
export const postOwnerMessage = alwaysWrites({
	name: "post the owner's message",
	given: (request: OwnerPost, facts: OwnerFacts) => given(request, facts),
	refusals: [
		unless(
			term(
				"the project is not complete",
				(g: Given<OwnerPost, OwnerFacts>) =>
					g.facts.project?.stage !== "complete",
			),
			() => new MessageNotAccepted(),
		),
		unless(
			term(
				"the project's access is open",
				(g: Given<OwnerPost, OwnerFacts>) =>
					g.facts.project !== null && g.facts.project.revoked_at === null,
			),
			() => new MessageNotAccepted(),
		),
		unless(
			term(
				"the request is not withdrawn",
				(g: Given<OwnerPost, OwnerFacts>) =>
					g.facts.request !== null && g.facts.request.status !== "withdrawn",
			),
			() => new MessageNotAccepted(),
		),
	],
	writes: (g) => ({
		ownerEmail: g.request.ownerEmail,
		body: g.request.body,
	}),
	writesText: "the owner's message",
});

type Lookup = {
	readonly session: { readonly email: string };
	readonly project: StoredProject | null;
	readonly request: StoredRequest | null;
};

/**
 * The lookup that comes first for a client: the session's email is the request's, and that email is not blank (the file route
 * does not ask this), the project exists and its access is open, and the request is not withdrawn. Every refusal is the one
 * hidden 404. The session itself (open, not expired, not revoked) is judged before this by `openStudioSession`.
 */
export const clientLookup = alwaysWrites({
	name: "find the project a client may write to",
	given: (_request: null, facts: Lookup) => facts,
	refusals: [
		unless(
			term(
				"the project and its request exist",
				(facts: Lookup) => facts.project !== null && facts.request !== null,
			),
			() => new ProjectHidden(),
		),
		unless(
			term(
				"the session's email is the request's",
				(facts: Lookup) => facts.request?.email === facts.session.email,
			),
			() => new ProjectHidden(),
		),
		unless(
			term(
				"the request's email is not blank",
				(facts: Lookup) => facts.request?.email !== "",
			),
			() => new ProjectHidden(),
		),
		unless(
			term(
				"the project's access is open",
				(facts: Lookup) => facts.project?.revoked_at === null,
			),
			() => new ProjectHidden(),
		),
		unless(
			term(
				"the request is not withdrawn",
				(facts: Lookup) => facts.request?.status !== "withdrawn",
			),
			() => new ProjectHidden(),
		),
	],
	writes: (facts) => ({
		project: proved(facts.project),
		request: proved(facts.request),
	}),
	writesText: "the project and its request, for the client's action",
});

type TextAction = {
	readonly body: unknown;
};

type AnswerText = {
	readonly decision: "approved" | "changes" | "stopped";
	readonly body: unknown;
};

const hasText = (body: RawValue) =>
	Predicate.isString(body) && body.trim() !== "";

/** A plain message's text: valid, trimmed, up to 4,000 characters, with no link that is not https. */
export const sendText = alwaysWrites({
	name: "read the text of a message",
	given: (request: TextAction, _facts: null) =>
		validateProjectMessage(request.body),
	refusals: [
		unless(
			term("the text is valid", (text: string | null) => text !== null),
			() => new MessageTextInvalid(),
		),
	],
	writes: (text) => text ?? "",
	writesText: "the message's text",
});

type AnswerGiven = {
	readonly request: AnswerText;
	readonly notes: string | null;
};

/**
 * The text an answer to a review stores. A request for changes needs notes; approving or stopping needs none, but notes that
 * are given must be valid. With none, approving and stopping store a sentence of their own (DEFAULT_ANSWER_TEXT).
 */
export const answerText = alwaysWrites({
	name: "read the text of an answer to a review",
	given: (request: AnswerText, _facts: null): AnswerGiven => ({
		request,
		notes: hasText(request.body) ? validateProjectMessage(request.body) : null,
	}),
	refusals: [
		unless(
			term(
				"a request for changes has notes",
				(g: AnswerGiven) =>
					g.request.decision !== "changes" || g.notes !== null,
			),
			() => new ChangesNeedNotes(),
		),
		unless(
			term(
				"notes that are given are valid",
				(g: AnswerGiven) => !hasText(g.request.body) || g.notes !== null,
			),
			() => new MessageTextInvalid(),
		),
	],
	writes: (g) =>
		g.notes ??
		// The empty text is unreachable: a request for changes without notes is refused above.
		(g.request.decision === "changes"
			? ""
			: DEFAULT_ANSWER_TEXT[g.request.decision]),
	writesText: "the answer's text",
});

type ClientSend = { readonly body: string; readonly at: Date };

type ClientSendFacts = {
	readonly project: StoredProject;
	/** How many messages the client sent in the last 300 seconds (M6). */
	readonly count: number;
};

/** The start of the window the client's messages are counted over, as the stored text compares it. */
export const windowStart = (at: Date) =>
	new Date(at.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();

const notFull = term(
	"the client has room for another message",
	(g: { readonly facts: { readonly count: number } }) =>
		g.facts.count < CLIENT_MESSAGE_LIMIT,
);

/** A client's message is taken while the window has room (checked first) and the project is not complete (M2). */
export const postClientMessage = alwaysWrites({
	name: "post the client's message",
	given: (request: ClientSend, facts: ClientSendFacts) => given(request, facts),
	refusals: [
		unless(notFull, () => new ClientRateLimited()),
		unless(
			term(
				"the project is not complete",
				(g: Given<ClientSend, ClientSendFacts>) =>
					g.facts.project.stage !== "complete",
			),
			() => new MessageNotAccepted(),
		),
	],
	writes: (g) => ({
		body: g.request.body,
		at: g.request.at.toISOString(),
		windowStart: windowStart(g.request.at),
		limit: CLIENT_MESSAGE_LIMIT,
	}),
	writesText: "the client's message",
});

type Answer = {
	readonly decision: "approved" | "changes" | "stopped";
	readonly reviewId: string;
	readonly text: string;
	readonly at: Date;
};

type AnswerFacts = {
	readonly project: StoredProject;
	readonly files: readonly StoredFile[];
	/** The client messages that answered a review. */
	readonly decisions: readonly StoredDecision[];
	readonly updates: readonly StoredUpdate[];
	readonly count: number;
};

type AnswerSeen = {
	readonly request: Answer;
	readonly facts: AnswerFacts;
	/** The latest published review that has a time, the first of equal times, or null. */
	readonly latest: StoredFile | null;
	/** Every published review with that latest time: the write's `ORDER BY ... LIMIT 1` may take any of them. */
	readonly tied: readonly StoredFile[];
	/** A published review exists and no client message answered a review at or after its publication. */
	readonly awaiting: boolean;
	readonly rounds: number;
};

const publishedAt = (file: StoredFile) => file.published_at ?? "";

const latestReview = (files: readonly StoredFile[]): StoredFile | null =>
	files
		.filter(
			(file) =>
				file.version === "review" &&
				file.status === "published" &&
				file.published_at !== null,
		)
		.reduce<StoredFile | null>(
			(latest, file) =>
				latest === null || publishedAt(file) > publishedAt(latest)
					? file
					: latest,
			null,
		);

/**
 * The client answers the latest published review. It awaits an answer while the stage is review_ready and no client
 * message answered a review at or after its publication; the answer names that review; and the decision fits the rounds:
 * approving always, a request for changes while fewer than two revision rounds have begun, stopping once two have.
 */
export const answerReview = alwaysWrites({
	name: "answer the latest review",
	given: (request: Answer, facts: AnswerFacts): AnswerSeen => {
		const latest = latestReview(facts.files);

		return {
			request,
			facts,
			latest,
			tied: facts.files.filter(
				(file) =>
					latest !== null &&
					file.version === "review" &&
					file.status === "published" &&
					file.published_at === latest.published_at,
			),
			awaiting:
				latest !== null &&
				!facts.decisions.some(
					(decision) => decision.created_at >= publishedAt(latest),
				),
			rounds: facts.updates.filter(
				(update) => update.milestone === "revision_started",
			).length,
		};
	},
	refusals: [
		unless(notFull, () => new ClientRateLimited()),
		unless(
			term(
				"the project is at review_ready",
				(g: AnswerSeen) => g.facts.project.stage === "review_ready",
			),
			() => new ReviewNotAnswerable(),
		),
		unless(
			term(
				"a published review awaits an answer",
				(g: AnswerSeen) => g.awaiting,
			),
			() => new ReviewNotAnswerable(),
		),
		unless(
			term("the answer names the latest review", (g: AnswerSeen) =>
				g.tied.some((file) => file.id === g.request.reviewId),
			),
			() => new ReviewNotAnswerable(),
		),
		unless(
			term(
				"the decision fits the revision rounds used",
				(g: AnswerSeen) =>
					g.request.decision === "approved" ||
					g.rounds < REVISION_ROUNDS === (g.request.decision === "changes"),
			),
			() => new ReviewNotAnswerable(),
		),
	],
	writes: (g) => ({
		decision: g.request.decision,
		reviewId: g.request.reviewId,
		body: g.request.text,
		at: g.request.at.toISOString(),
		windowStart: windowStart(g.request.at),
		limit: CLIENT_MESSAGE_LIMIT,
	}),
	writesText: "the client's answer to the review",
});

type MarkRequest = { readonly reader: "owner" | "client"; readonly at: Date };

/**
 * A message is marked read when it is the other side's and not yet read. Anything else is nothing to do, and the route
 * answers `{ok:true}` either way (M7, M8).
 */
export const markRead = rule({
	name: "mark a message read",
	given: (request: MarkRequest, message: StoredMessage | null) => ({
		request,
		message,
	}),
	nothingToDoIf: term(
		"the message is not the other side's or was read",
		(g: { request: MarkRequest; message: StoredMessage | null }) =>
			g.message === null ||
			g.message.actor !== (g.request.reader === "owner" ? "client" : "owner") ||
			g.message.read_at !== null,
	),
	refusals: [],
	writes: (g) => ({ at: g.request.at.toISOString() }),
	writesText: "the time the message was read",
});
