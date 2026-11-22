// What the owner and the client do on an audio project's messages: write a message, mark one read, and (the client) answer
// the latest review. Each action reads in the order the routes always did: for a client the session (a statement of its own),
// then ONE batch with the project and its request, the lookup rule that answers the one hidden 404 and lets nothing after it
// run, the text checks (400, before any count), then ONE batch of what the action's rule needs (the count among it), the rule,
// and the write. The write keeps today's conditions; a write that loses a race is refused, never retried: the count is read once
// more, because the race may have filled the window, and a full count answers 429 where the write's own refusal answers 409
// (docs/plans/2026-11-audio-projects-conversion.md, sections 2 and 3). The routes build every answer.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { hashValue } from "../../lib/client-portal";
import { hashing } from "../agreement-services";
import { readStudioSession } from "../agreement-store";
import {
	insertClientMessage,
	insertDecision,
	insertOwnerMessage,
	insertStoppingDecision,
	markClientMessageRead,
	markOwnerMessageRead,
	readClientMessageCount,
	readMessage,
	readProjectFacts,
	readReviewFacts,
	readSendFacts,
} from "../audio-project-store";
import {
	answerReview,
	answerText,
	CLIENT_MESSAGE_LIMIT,
	ClientRateLimited,
	clientLookup,
	MessageNotAccepted,
	markRead,
	ownerProject,
	postClientMessage,
	postOwnerMessage,
	ProjectHidden,
	ReviewNotAnswerable,
	sendText,
	windowStart,
} from "../rules/audio-project-messages";
import { openStudioSession } from "../rules/agreement-session";
import type { StoredProject } from "../rules/audio-project-messages";

/** A write's time, its window and so its session guard, taken from the clock at the write and not at the lookup. */
const stamped = <Write extends { at: string; windowStart: string }>(
	write: Write,
	at: Date,
): Write => ({ ...write, at: at.toISOString(), windowStart: windowStart(at) });

/** The owner's project, read in one batch: a missing one is a hidden 404. */
const ownerFacts = (id: string) =>
	readProjectFacts(id).pipe(
		Effect.flatMap((facts) => ownerProject.decide(null, facts)),
	);

/** The owner writes a message. The text is checked before the write, as the route always did. */
export const sendOwnerMessage = (input: {
	readonly id: string;
	readonly ownerEmail: string;
	readonly body: unknown;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const facts = yield* ownerFacts(input.id);
		const body = yield* sendText.decide({ body: input.body }, null);

		const write = yield* postOwnerMessage.decide(
			{ body, ownerEmail: input.ownerEmail },
			facts,
		);

		const saved = yield* insertOwnerMessage(
			input.id,
			write,
			input.now().toISOString(),
		);

		return yield* saved === null
			? Effect.fail(new MessageNotAccepted())
			: Effect.succeed(saved);
	});

/** The owner marks a client's message read. A message that is not one to mark is nothing to do, and the answer is the same. */
export const markClientMessageReadByOwner = (input: {
	readonly id: string;
	readonly messageId: number;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		yield* ownerFacts(input.id);
		const at = input.now();
		const message = yield* readMessage(input.id, input.messageId);
		const decided = yield* markRead.decide({ reader: "owner", at }, message);

		if (Option.isSome(decided))
			yield* markClientMessageRead(input.id, input.messageId, decided.value.at);
	});

/**
 * The client's session and project: the session as the cookie names it, open and not expired or revoked, and the lookup that
 * hides a project the client cannot show. Every miss is the one hidden 404.
 */
const clientProject = (input: {
	readonly id: string;
	readonly token: string;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const tokenHash = yield* hashing(() => hashValue(input.token));
		const stored = yield* readStudioSession(tokenHash);
		const at = input.now();

		if (stored === null) return yield* Effect.fail(new ProjectHidden());

		const session = yield* openStudioSession
			.decide({ now: at }, stored)
			.pipe(
				Effect.catchTag("StudioSessionNotOpen", () =>
					Effect.fail(new ProjectHidden()),
				),
			);

		const read = yield* readProjectFacts(input.id);
		const found = yield* clientLookup.decide(null, { session, ...read });

		return { tokenHash, at, project: found.project, request: found.request };
	});

/** The facts read just before a decision hold the project, which the client's lookup has already shown to exist. */
const withProject = <Facts extends { readonly project: StoredProject | null }>(
	facts: Facts,
) =>
	facts.project === null
		? Effect.fail(new ProjectHidden())
		: Effect.succeed({ ...facts, project: facts.project });

/**
 * After a write that found a condition gone: the window may have filled in between, so a full count is the client's 429 and
 * anything else is the write's own refusal.
 */
const recount = <Refusal>(id: string, at: Date, refusal: Refusal) =>
	readClientMessageCount(id, windowStart(at)).pipe(
		Effect.flatMap(
			(count): Effect.Effect<never, ClientRateLimited | Refusal> =>
				count >= CLIENT_MESSAGE_LIMIT
					? Effect.fail(new ClientRateLimited())
					: Effect.fail(refusal),
		),
	);

/** The client writes a message. */
export const sendClientMessage = (input: {
	readonly id: string;
	readonly token: string;
	readonly body: unknown;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const seen = yield* clientProject(input);
		const body = yield* sendText.decide({ body: input.body }, null);

		// The stage the rule decides from is read now, with the count, and not taken from the lookup: the owner's actions can move it
		// in between, and today the write's own guard reads it at write time.
		const facts = yield* readSendFacts(input.id, windowStart(seen.at)).pipe(
			Effect.flatMap(withProject),
		);

		const write = yield* postClientMessage.decide(
			{ body, at: seen.at },
			{ project: facts.project, count: facts.count },
		);

		// The write reads the clock again, as the old write did: its session guard and its window use that reading.
		const saved = yield* insertClientMessage(
			input.id,
			seen.tokenHash,
			stamped(write, input.now()),
		);

		return yield* saved === null
			? recount(input.id, input.now(), new MessageNotAccepted())
			: Effect.succeed(saved);
	});

/** The client answers the latest published review. */
export const answerLatestReview = (input: {
	readonly id: string;
	readonly token: string;
	readonly reviewId: string;
	readonly decision: "approved" | "changes" | "stopped";
	readonly body: unknown;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const seen = yield* clientProject(input);

		const text = yield* answerText.decide(
			{ decision: input.decision, body: input.body },
			null,
		);

		const facts = yield* readReviewFacts(input.id, windowStart(seen.at)).pipe(
			Effect.flatMap(withProject),
		);

		const write = yield* answerReview.decide(
			{
				decision: input.decision,
				reviewId: input.reviewId,
				text,
				at: seen.at,
			},
			facts,
		);

		// Stopping closes this project's access in the same write, so the review stops playing.
		const written = stamped(write, input.now());

		const saved =
			written.decision === "stopped"
				? yield* insertStoppingDecision(input.id, seen.tokenHash, written)
				: yield* insertDecision(input.id, seen.tokenHash, written);

		return yield* saved === null
			? recount(input.id, input.now(), new ReviewNotAnswerable())
			: Effect.succeed(saved);
	});

/** The client marks an owner's message read. */
export const markOwnerMessageReadByClient = (input: {
	readonly id: string;
	readonly token: string;
	readonly messageId: number;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const seen = yield* clientProject(input);
		const at = input.now();
		const message = yield* readMessage(input.id, input.messageId);

		const decided = yield* markRead.decide({ reader: "client", at }, message);

		if (Option.isSome(decided))
			yield* markOwnerMessageRead(
				input.id,
				input.messageId,
				seen.tokenHash,
				decided.value.at,
			);
	});
