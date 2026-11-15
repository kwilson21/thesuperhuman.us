import { createEffectLogic, setupEffect } from "@xstate/effect";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { Mail } from "../services";
import { failureOf } from "./failure";

// The owner request's moves on the software offers route (POST /api/owner/requests/[id]/software), as
// docs/plans/2026-11-offers-conversion.md, section 1 ("The owner request") and section 3, draw them. The request's
// `status` column holds new, reviewed, resolved or withdrawn (src/lib/owner-model.ts); of the six actions only decline
// changes it. The rules ask `next()` (src/server/machines/next.ts) whether the stored status allows an action; the writes
// are SQL compare-and-set guards (G1, the request as read), and this machine is what the rules read.
//
// Two states are never saved: `asking` and `declining` invoke the client email through the XState and Effect bridge,
// because question and decline save a move only after the email (the question's record, the decline's resolve). The
// flow restores the machine at the stored status (new or reviewed), sends QUESTION or DECLINE with the two emails, and
// waits with `settled` (src/server/machines/settled.ts) for the landing: `declining` lands on resolved when the client's
// email was accepted, `asking` on the state it came from; a refused or uncertain client email lands on the state it came
// from, with the failure in the context, and nothing more is saved. One invoking state serves both new and reviewed, so
// QUESTION and DECLINE keep the origin in the context, and each landing on the origin reads it.
//
// The status route's moves (review, reopen, resolve, withdraw; src/lib/owner-requests.ts) are not here: they join this
// machine when that route converts (step 12 of docs/plans/2026-11-effect-conversion.md).

/** The stored statuses, in the order of src/lib/owner-model.ts. */
export const REQUEST_STATUSES = [
	"new",
	"reviewed",
	"resolved",
	"withdrawn",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** The six actions, as the events the machine takes. */
export type RequestEvent =
	| "FIT"
	| "QUESTION"
	| "DECLINE"
	| "REVOKE"
	| "DRAFT"
	| "SEND";

/** A client email failure that lands on the origin. */
export type MailFailure = "MailRefused" | "MailUncertain";

/** The machine's context: plain values, so `next` can be given a row's own (src/server/machines/next.ts). */
const RequestContext = Schema.Struct({
	/** The status QUESTION or DECLINE left, while its email is in flight and once it lands; null before. */
	origin: Schema.NullOr(Schema.Literals(["new", "reviewed"])),
	/** Why the client email did not go out, once it landed on the origin by failing; null otherwise. */
	failure: Schema.NullOr(Schema.Literals(["MailRefused", "MailUncertain"])),
	/** Whether the owner's copy was accepted, once the client email was. */
	copySent: Schema.Boolean,
});

export type RequestContext = typeof RequestContext.Type;

/** The context a stored status is restored with: no email has been tried. */
export const RESTORED: RequestContext = {
	origin: null,
	failure: null,
	copySent: false,
};

/** One email as the bridge sends it (the shape `Mail` takes, src/server/services.ts). */
const Message = Schema.Struct({
	from: Schema.String,
	reply_to: Schema.String,
	subject: Schema.String,
	text: Schema.String,
	to: Schema.Array(Schema.String),
});

/** The two emails of a question or a decline: the client's, then the owner's copy, sent only when the client's was accepted. */
const Emails = Schema.Struct({ client: Message, copy: Message });

export type OfferEmails = typeof Emails.Type;

/** The event carried no emails: a bug in the flow, never an email sent with no address. */
class NoEmails extends Error {
	constructor() {
		super("QUESTION or DECLINE reached the email without its emails.");
	}
}

/**
 * The invoked work: the client email, then the owner's copy. A refused or uncertain client email fails the work, so the
 * machine lands on the origin; a copy that fails only sets `copySent` false, as the route has always answered it. With no
 * emails (the event carried none) it dies before it sends anything, and the program dies with it.
 */
const emailClient = createEffectLogic({
	schemas: { input: Schema.UndefinedOr(Emails) },
	effect: ({ input }) =>
		Effect.gen(function* () {
			if (input === undefined) return yield* Effect.die(new NoEmails());

			const mail = yield* Mail;

			yield* mail.send(input.client);

			const copySent = yield* mail.send(input.copy).pipe(
				Effect.as(true),
				Effect.catchTags({
					MailRefused: () => Effect.succeed(false),
					MailUncertain: () => Effect.succeed(false),
				}),
			);

			return { copySent };
		}),
});

/** How long a flow waits for the landing: longer than the two emails in a row, each with its own 10-second timeout. */
export const EMAIL_LANDING_TIMEOUT = "30 seconds";

/**
 * Whether QUESTION or DECLINE has landed: the machine left its invoking state for a stored status. The origin tells a
 * landing on new or reviewed from the restored state before the event: it is set only by the event.
 */
export const hasLanded = (snapshot: {
	readonly context: RequestContext;
	readonly matches: (state: never) => boolean;
	readonly value: unknown;
}) =>
	snapshot.context.origin !== null &&
	snapshot.value !== "asking" &&
	snapshot.value !== "declining";

/** An event that keeps the status; it carries nothing. */
const Plain = Schema.Struct({});

/**
 * QUESTION or DECLINE, with the two emails the invoking state sends: an event the flow sends must carry them. `next` asks
 * with the type alone and never starts the work. The schemas type the machine; the bridge does not check them at run
 * time without a validator, so an event that arrives without them anyway makes the work die before it sends anything.
 */
const WithEmails = Schema.Struct({ emails: Emails });

export const softwareRequest = setupEffect({
	schemas: {
		context: RequestContext,
		events: {
			FIT: Plain,
			QUESTION: WithEmails,
			DECLINE: WithEmails,
			REVOKE: Plain,
			DRAFT: Plain,
			SEND: Plain,
		},
	},
	actors: { emailClient },
}).createMachine({
	id: "softwareRequest",
	initial: "new",
	context: RESTORED,
	states: {
		new: {
			on: {
				FIT: { target: "new" },
				DRAFT: { target: "new" },
				SEND: { target: "new" },
				REVOKE: { target: "new" },
				QUESTION: ({ context }) => ({
					target: "asking",
					context: { ...context, origin: "new", failure: null },
				}),
				DECLINE: ({ context }) => ({
					target: "declining",
					context: { ...context, origin: "new", failure: null },
				}),
			},
		},
		reviewed: {
			on: {
				FIT: { target: "reviewed" },
				DRAFT: { target: "reviewed" },
				SEND: { target: "reviewed" },
				REVOKE: { target: "reviewed" },
				QUESTION: ({ context }) => ({
					target: "asking",
					context: { ...context, origin: "reviewed", failure: null },
				}),
				DECLINE: ({ context }) => ({
					target: "declining",
					context: { ...context, origin: "reviewed", failure: null },
				}),
			},
		},
		resolved: { on: { REVOKE: { target: "resolved" } } },
		withdrawn: { on: { REVOKE: { target: "withdrawn" } } },
		asking: {
			invoke: {
				src: "emailClient",
				input: ({ event }) => ("emails" in event ? event.emails : undefined),
				// The landing on the origin: new when it is new, reviewed when it is reviewed (QUESTION set it on the way in).
				onDone: ({ context, event }) =>
					context.origin === null
						? undefined
						: {
								target: context.origin,
								context: { ...context, copySent: event.output.copySent },
							},
				onError: ({ context, event }) => {
					// `failureOf` rethrows a defect or an interruption, so only a failed client email lands.
					const failure = failureOf(event);

					return context.origin !== null &&
						(Predicate.isTagged(failure, "MailRefused") ||
							Predicate.isTagged(failure, "MailUncertain"))
						? {
								target: context.origin,
								context: { ...context, failure: failure._tag },
							}
						: undefined;
				},
			},
		},
		declining: {
			invoke: {
				src: "emailClient",
				input: ({ event }) => ("emails" in event ? event.emails : undefined),
				onDone: ({ context, event }) => ({
					target: "resolved",
					context: { ...context, copySent: event.output.copySent },
				}),
				onError: ({ context, event }) => {
					const failure = failureOf(event);

					return context.origin !== null &&
						(Predicate.isTagged(failure, "MailRefused") ||
							Predicate.isTagged(failure, "MailUncertain"))
						? {
								target: context.origin,
								context: { ...context, failure: failure._tag },
							}
						: undefined;
				},
			},
		},
	},
});
