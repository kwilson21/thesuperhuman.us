// What the six flows of the owner's software request actions (POST /api/owner/requests/[id]/software: fit, question,
// decline, revoke, draft and send, in src/server/flows/offer-*.ts) share: what the route hands every flow, the first read
// (the request, which must be a software request), the reads after a refused batch, the client email of a question or a
// decline through the request machine's bridge, and the names of the failures whose fixed answer depends on where they
// happen (after the client email went out, after the draft was saved, in a send's live-link check). Nothing here builds a
// response: the route answers each tag (docs/plans/2026-11-offers-conversion.md, sections 3 and 5).
import { createEffectActor, send } from "@xstate/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import {
	EMAIL_LANDING_TIMEOUT,
	hasLanded,
	type OfferEmails,
	REQUEST_STATUSES,
	type RequestStatus,
	RESTORED,
	softwareRequest,
} from "../machines/software-request";
import { settled } from "../machines/settled";
import {
	OffersStoreFailed,
	readFreshLiveLink,
	readLinkLive,
	readOffers,
	readProjectStarted,
	readRequest,
} from "../offers-store";
import type {
	RefusedBatchRead,
	RefusedBatchReads,
} from "../rules/offer-refused-batch";
import {
	findSoftwareRequest,
	type MailSettings,
} from "../rules/software-request";
import { MailRefused, MailUncertain, type MusicDb } from "../services";

/** What the route hands every action's flow. */
export type OfferAction = {
	/** The request's id, as the route's params gave it (never empty: the route answers a missing id itself). */
	readonly requestId: string;
	/** The owner acting (`locals.owner.email`), written into the audit. */
	readonly actor: string;
	/** The time, as ISO text, read at each point the route has always read it. */
	readonly now: () => string;
	/**
	 * The start of the 20-second sending window, as ISO text (`offerSendingSince`), read at each point the route has always
	 * read it: each read of a fresh live link, and each batch that carries the sending guard (G5).
	 */
	readonly sendingSince: () => string;
};

/** The mail settings a question, a decline or a send emails with: null when RESEND_API_KEY, CONTACT_FROM_EMAIL or OWNER_EMAIL is missing. */
export type OfferMail = MailSettings | null;

/**
 * The mail settings are missing. A question or a decline answers 503 before anything is written (F8, #314); a send records
 * it in its outcome (the client email is not sent, `emailSent` false), as it always has.
 */
export class MailNotConfigured extends Data.TaggedError("MailNotConfigured") {}

/** The mail settings, or MailNotConfigured. */
export const mailSettings = (mail: OfferMail) =>
	mail === null ? Effect.fail(new MailNotConfigured()) : Effect.succeed(mail);

/**
 * A store that failed after the client email of a question or a decline went out: its record, its resolve, or a read the
 * answer to them needs. `failure` is what the database gave, for the route's log.
 */
export class OffersStoreFailedAfterEmail extends Data.TaggedError(
	"OffersStoreFailedAfterEmail",
)<{ readonly failure: unknown }> {}

/** The store failed after the client email went out: the same failure, named for its fixed answer. */
export const afterEmail = (failed: OffersStoreFailed) =>
	Effect.fail(new OffersStoreFailedAfterEmail({ failure: failed.failure }));

/** The request with the id, which must be a software request (RequestNotFound otherwise). */
export const findRequest = (requestId: string) =>
	readRequest(requestId).pipe(
		Effect.flatMap((request) => findSoftwareRequest.decide(null, { request })),
	);

/** A rule of src/server/rules/offer-refused-batch.ts: the next fact to read, or the refusal its reads end in. */
type RefusedBatchRule<E> = {
	readonly decide: (
		request: null,
		facts: RefusedBatchReads,
	) => Effect.Effect<RefusedBatchRead, E>;
};

/** The link revoke closes, which the reads after its refused batch look for; absent for every other action. */
class NoLinkToRead extends Error {
	constructor() {
		super("A refused batch asked for a link's state, and no link was given.");
	}
}

/**
 * Reads one fact after a refused batch, as the route always has: the page's link still live (revoke only, with the
 * created_at the page showed), a live link made in the last 20 seconds (the window read now), a started project, and every
 * offer version.
 */
const readAfterRefusal = (
	action: OfferAction,
	linkCreatedAt: string | null,
	fact: RefusedBatchRead,
) =>
	Match.value(fact).pipe(
		Match.withReturnType<
			Effect.Effect<RefusedBatchReads, OffersStoreFailed, MusicDb>
		>(),
		Match.when("linkLive", () =>
			linkCreatedAt === null
				? Effect.die(new NoLinkToRead())
				: readLinkLive(action.requestId, linkCreatedAt).pipe(
						Effect.map((linkLive) => ({ linkLive })),
					),
		),
		Match.when("sending", () =>
			readFreshLiveLink(action.requestId, action.sendingSince()).pipe(
				Effect.map((sending) => ({ sending })),
			),
		),
		Match.when("projectStarted", () =>
			readProjectStarted(action.requestId).pipe(
				Effect.map((projectStarted) => ({ projectStarted })),
			),
		),
		Match.when("offers", () =>
			readOffers(action.requestId).pipe(Effect.map((offers) => ({ offers }))),
		),
		Match.exhaustive,
	);

/**
 * The answer to a refused batch, or to a refusal that names a condition only a batch checked before: the rule says which
 * fact to read next, the flow reads it, and the rule is asked again, until it refuses. Each read is made only when the
 * refusals before it did not answer, in the order the route has always read them. A read that fails is OffersStoreFailed.
 */
export const answerRefusedBatch = <E>(
	rule: RefusedBatchRule<E>,
	action: OfferAction,
	linkCreatedAt: string | null = null,
) => {
	const ask = (
		reads: RefusedBatchReads,
	): Effect.Effect<never, E | OffersStoreFailed, MusicDb> =>
		rule.decide(null, reads).pipe(
			Effect.flatMap((fact) => readAfterRefusal(action, linkCreatedAt, fact)),
			Effect.flatMap((read) => ask({ ...reads, ...read })),
		);

	return ask({});
};

/** The machine's landing, which `hasLanded` admits only on a stored status, is not one. */
class LandedNowhere extends Error {
	constructor() {
		super("The request machine landed on a state that is not stored.");
	}
}

/** How the client email of a question or a decline landed: the status the machine landed on, and whether the copy went. */
export type EmailLanding = {
	readonly status: RequestStatus;
	readonly copySent: boolean;
};

/**
 * The client email of a question or a decline, through the request machine's bridge (src/server/machines/software-request.ts):
 * the machine is restored at the stored status, QUESTION or DECLINE moves it to `asking` or `declining`, which sends the
 * client email and then the owner's copy, and the flow waits for the landing with `settled` (30 seconds, longer than the
 * two emails' own timeouts). A client email that was refused or may not have gone out lands on the stored status, and
 * fails here as MailRefused or MailUncertain; nothing more is saved. `settled` fails with TimeoutError when no landing
 * comes in time and with ActorStoppedError when the actor stops without one; a defect in the work dies with itself.
 */
export const emailThroughMachine = (
	status: RequestStatus,
	event: "QUESTION" | "DECLINE",
	emails: OfferEmails,
) =>
	Effect.gen(function* () {
		const actor = yield* createEffectActor(softwareRequest, {
			snapshot: softwareRequest.getPersistedSnapshot(
				softwareRequest.resolveState({ value: status, context: RESTORED }),
			),
		});

		yield* event === "QUESTION"
			? send(actor, { type: "QUESTION", emails })
			: send(actor, { type: "DECLINE", emails });

		const landed = yield* settled(actor, hasLanded, {
			timeout: EMAIL_LANDING_TIMEOUT,
		});

		const { failure, copySent } = landed.context;

		if (failure === "MailRefused") return yield* Effect.fail(new MailRefused());

		if (failure === "MailUncertain")
			return yield* Effect.fail(new MailUncertain());

		const landedOn = REQUEST_STATUSES.find((stored) => stored === landed.value);

		if (landedOn === undefined) return yield* Effect.die(new LandedNowhere());

		return { status: landedOn, copySent } satisfies EmailLanding;
	}).pipe(Effect.scoped);
