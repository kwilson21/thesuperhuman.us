// The notices the owner's project routes send to the client: the project's invitation, and the email of an update, for the
// owner's retry and for what a file's publish or revoke and an update start in the background
// (docs/plans/2026-11-audio-projects-conversion.md, sections 3 and 4). A queue reads the notice's facts, judges them and writes
// with the compare-and-set that keeps today's conditions; a lost guard is `NoticeNotQueueable`, never retried. A delivery reads
// the claim first, with no read ahead of it (a read adds a turn before the claim, and the public intake's background then sends the
// owner's notice before the claim is written, which the corpus records): the claim is the compare-and-set that keeps today's
// conditions (pending; for the invitation also an open project and a request that is a service, not withdrawn, with an
// email), and a notice it does not take is quietly nothing to do. The delivery then finds the recipient (a failed read marks the notice failed, and a
// failed mark is the delivery's failure), asks the mail service and writes the outcome: sent, or failed when the provider
// refused, was never asked or there was no recipient. An uncertain answer writes nothing, so the notice stays `sending`. The
// clock is read at the claim and again at the outcome, as the delivery always did. A delivery that fails leaves its notice where
// it was, and the one fixed line of its caller says the state is uncertain; the lines are kept as they are. The routes build every
// answer.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
	type AudioProjectStoreFailed,
	claimInvitation,
	claimUpdateNotice,
	failInvitation,
	failUpdateNotice,
	queueInvitation,
	queueUpdateNotice,
	readInvitationFacts,
	readRecipient,
	readUpdateNoticeFacts,
	settleInvitation,
	settleUpdateNotice,
} from "../audio-project-store";
import {
	deliveryOutcome,
	type MailOutcome,
	NoticeNotQueueable,
	queueNotice,
	recipientOf,
} from "../rules/audio-project-notices";
import {
	Background,
	MusicDb,
	ProjectInvitation,
	ProjectInvitationFailed,
	StudioNoticeMail,
	type StudioNoticeMailFailed,
	liveStudioNoticeMail,
} from "../services";

/** The invitation's subject and an update's, as the mail has always carried them. */
const INVITATION_SUBJECT = "Your private studio project";

const UPDATE_SUBJECT = "Your studio project has an update";

/** The owner queues the project's invitation again. */
export const queueProjectInvitation = (input: {
	readonly requestId: string;
	readonly confirmedNotSent: boolean;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const facts = yield* readInvitationFacts(input.requestId);

		const write = yield* queueNotice.decide(
			{ kind: "invitation", confirmed: input.confirmedNotSent, now },
			facts,
		);

		const queued = yield* queueInvitation(input.requestId, write);

		if (!queued)
			return yield* Effect.fail(new NoticeNotQueueable({ kind: "invitation" }));
	});

/** The owner queues an update's email again. */
export const queueProjectUpdateNotice = (input: {
	readonly requestId: string;
	readonly updateId: number;
	readonly confirmedNotSent: boolean;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const now = input.now();
		const facts = yield* readUpdateNoticeFacts(input.requestId, input.updateId);

		const write = yield* queueNotice.decide(
			{ kind: "update", confirmed: input.confirmedNotSent, now },
			facts,
		);

		const queued = yield* queueUpdateNotice(
			input.requestId,
			input.updateId,
			write,
		);

		if (!queued)
			return yield* Effect.fail(new NoticeNotQueueable({ kind: "update" }));
	});

/** The recipient of a notice and what the provider did with it: `null` when there was no one to send to. */
const mailTo = (
	recipient: string | null,
	subject: string,
	kind: "invitation" | "update",
) =>
	recipient === null
		? Effect.succeed<MailOutcome>(null)
		: StudioNoticeMail.use((mail) =>
				mail.send({ to: recipient, subject, kind }),
			);

/** A delivery of the project's invitation: claims it, sends it and writes the outcome. */
export const deliverInvitation = (input: {
	readonly requestId: string;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const { requestId } = input;

		const claimed = yield* claimInvitation(
			requestId,
			input.now().toISOString(),
		);

		if (claimed === null) return;

		// A recipient read that fails marks the notice failed, and a mark that fails is this delivery's failure.
		const read = yield* readRecipient(requestId).pipe(
			Effect.map(Option.some),
			Effect.catchTag("AudioProjectStoreFailed", () =>
				failInvitation(requestId).pipe(Effect.as(Option.none())),
			),
		);

		if (Option.isNone(read)) return;

		const recipient = yield* recipientOf.decide(
			{ kind: "invitation" },
			read.value,
		);

		const mail = yield* mailTo(recipient, INVITATION_SUBJECT, "invitation");
		const outcome = yield* deliveryOutcome.decide({ mail }, null);

		if (Option.isSome(outcome))
			yield* settleInvitation(requestId, {
				status: outcome.value,
				sentAt: outcome.value === "sent" ? input.now().toISOString() : null,
			});
	});

/** A delivery of one update's email: claims it, sends it and writes the outcome. */
export const deliverUpdateNotice = (input: {
	readonly updateId: number;
	readonly now: () => Date;
}) =>
	Effect.gen(function* () {
		const { updateId } = input;

		const requestId = yield* claimUpdateNotice(
			updateId,
			input.now().toISOString(),
		);

		if (requestId === null) return;

		const read = yield* readRecipient(requestId).pipe(
			Effect.map(Option.some),
			Effect.catchTag("AudioProjectStoreFailed", () =>
				failUpdateNotice(updateId).pipe(Effect.as(Option.none())),
			),
		);

		if (Option.isNone(read)) return;

		const recipient = yield* recipientOf.decide({ kind: "update" }, read.value);

		const mail = yield* mailTo(recipient, UPDATE_SUBJECT, "update");
		const outcome = yield* deliveryOutcome.decide({ mail }, null);

		if (Option.isSome(outcome))
			yield* settleUpdateNotice(updateId, {
				status: outcome.value,
				sentAt: outcome.value === "sent" ? input.now().toISOString() : null,
			});
	});

/**
 * Starts a delivery in the background (ctx.waitUntil), at this point of the request. The delivery runs with the services the
 * request has; a failure or a defect of it leaves the notice where it was and logs the one fixed line `uncertain` says.
 */
export const deliverInBackground = (
	delivery: Effect.Effect<
		void,
		AudioProjectStoreFailed | StudioNoticeMailFailed,
		MusicDb | StudioNoticeMail
	>,
	uncertain: string,
) =>
	Effect.gen(function* () {
		const background = yield* Background;
		const context = yield* Effect.context<MusicDb | StudioNoticeMail>();

		yield* background.defer([
			delivery.pipe(
				Effect.provideContext(context),
				Effect.catchTags({
					AudioProjectStoreFailed: () =>
						Effect.sync(() => console.error(uncertain)),
					StudioNoticeMailFailed: () =>
						Effect.sync(() => console.error(uncertain)),
				}),
				// A defect is the same state: the old `.catch` printed the line for any rejection, and the task settles fulfilled.
				Effect.catchDefect(() => Effect.sync(() => console.error(uncertain))),
			),
		]);
	});

/** The studio invitation through the invitation delivery flow, with the database and the env the request gives (the public intake's service). */
export const liveProjectInvitation = (db: D1Database, env: Env) =>
	Context.make(ProjectInvitation, {
		deliver: (requestId) =>
			deliverInvitation({ requestId, now: () => new Date() }).pipe(
				Effect.provideContext(
					Context.merge(Context.make(MusicDb, db), liveStudioNoticeMail(env)),
				),
				Effect.mapError(() => new ProjectInvitationFailed()),
			),
	});
