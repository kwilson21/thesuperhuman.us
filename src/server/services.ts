// What the Effect rules and saves depend on, one service each, in kwilson21/tally's form (`src/db/database.ts`): a
// route provides the request's own bindings and a test provides whichever doubles it likes. Time and the acting user are
// not services; they are plain inputs to a rule. `liveServices` is the one place that reads the request's env.
//
// The bindings are real here, and typed as required (see `bindingsOrUnavailable`). Mail, Stripe and Turnstile are only their interface and typed errors in this layer: each
// live implementation, wrapping the function the site calls today, comes with the first route that uses it.
import type StripeSdk from "stripe";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { AudioPayment } from "../lib/audio-payments";
import { sendMail } from "../lib/resend";
import { verifyTurnstile } from "../lib/turnstile";

/**
 * Each binding service is typed as REQUIRED, as kwilson21/tally types its `Database`: a program that reads one is never
 * handed `undefined`. env.d.ts types MUSIC_DB, PUBLICATION_DB and OAUTH_KV as optional, because a deployment may not
 * have them; `bindingsOrUnavailable` is the one place that decides what a missing binding means, before the program runs.
 */
export class MusicDb extends Context.Service<MusicDb, D1Database>()(
	"site/MusicDb",
) {}

export class PublicationDb extends Context.Service<PublicationDb, D1Database>()(
	"site/PublicationDb",
) {}

/** The KV namespace the rate limits count in (env.RATE_LIMIT). */
export class RateLimit extends Context.Service<RateLimit, KVNamespace>()(
	"site/RateLimit",
) {}

/** The KV namespace holding approval tokens and the resume PDFs (env.RESUME_STORE). */
export class ResumeStore extends Context.Service<ResumeStore, KVNamespace>()(
	"site/ResumeStore",
) {}

export class OAuthKv extends Context.Service<OAuthKv, KVNamespace>()(
	"site/OAuthKv",
) {}

/** The R2 bucket for audio, project files and agreement attachments (env.AUDIO). */
export class AudioBucket extends Context.Service<AudioBucket, R2Bucket>()(
	"site/AudioBucket",
) {}

/** The names of the env bindings that have a service. */
const BINDING_NAMES = [
	"MUSIC_DB",
	"PUBLICATION_DB",
	"RATE_LIMIT",
	"RESUME_STORE",
	"OAUTH_KV",
	"AUDIO",
] as const;

export type BindingName = (typeof BINDING_NAMES)[number];

/** The service each binding name gives. */
type ServiceOf = {
	readonly MUSIC_DB: MusicDb;
	readonly PUBLICATION_DB: PublicationDb;
	readonly RATE_LIMIT: RateLimit;
	readonly RESUME_STORE: ResumeStore;
	readonly OAUTH_KV: OAuthKv;
	readonly AUDIO: AudioBucket;
};

/**
 * The one place that reads the request's env (`locals.runtime.env`) and turns its bindings into services, and the one
 * place that decides a binding is missing. A route names the bindings it needs and calls this BEFORE `runRoute`:
 *
 *     const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);
 *     if (!bindings.ok) return musicUnavailable();
 *     return runRoute(bindings.services, program);
 *
 * A binding counts as missing when it is falsy, as `!env.MUSIC_DB` does in the routes today. The route answers a missing
 * binding as it does today (`isAudioIntakeAvailable` and `musicUnavailable` in src/lib/audio-intake.ts and
 * src/lib/music-request.ts: a 503); the services it gets promise only the bindings it named. Secrets such as
 * TURNSTILE_SECRET_KEY are not bindings and are not checked here: they belong to the live service that reads them.
 */
export function bindingsOrUnavailable<
	const Needs extends readonly [BindingName, ...BindingName[]],
>(
	env: Env,
	needs: Needs,
):
	| {
			readonly ok: true;
			readonly services: Context.Context<ServiceOf[Needs[number]]>;
	  }
	| { readonly ok: false; readonly missing: Needs[number][] } {
	const missing = needs.filter((name) => !env[name]);

	if (missing.length > 0) return { ok: false, missing };

	return { ok: true, services: boundServices(env) };
}

/**
 * The services for every binding that is set, and none for one that is not. `bindingsOrUnavailable` has checked the
 * ones the route needs before it hands this over, and `legacyBindingsOrDefect` leaves a missing one to fail at the first read.
 */
function boundServices(env: Env) {
	// SAFETY: the empty context is typed as holding every service, and the lines below add exactly those whose binding is set; a service that was not added is absent, and reading an absent service dies with "Service not found", which is the defect `legacyBindingsOrDefect` is for and the case `bindingsOrUnavailable` has ruled out for the services a route needs.
	let services = Context.empty() as Context.Context<ServiceOf[BindingName]>;

	if (env.MUSIC_DB) services = Context.add(services, MusicDb, env.MUSIC_DB);

	if (env.PUBLICATION_DB)
		services = Context.add(services, PublicationDb, env.PUBLICATION_DB);

	if (env.RATE_LIMIT)
		services = Context.add(services, RateLimit, env.RATE_LIMIT);

	if (env.RESUME_STORE)
		services = Context.add(services, ResumeStore, env.RESUME_STORE);

	if (env.OAUTH_KV) services = Context.add(services, OAuthKv, env.OAUTH_KV);

	if (env.AUDIO) services = Context.add(services, AudioBucket, env.AUDIO);

	return services;
}

/**
 * ONLY for routes whose current answer to a missing binding is a 500 at first use: `src/pages/api/contact.ts`,
 * `resume-request.ts` and `resume-approve.ts` read their KV namespaces without checking, so a deployment missing one
 * fails (Astro answers 500) at the first read, after the checks and effects that come before it. This gives them the
 * same: a binding that is not set is not provided, and the flow that reads it dies with "Service not found" at that
 * point, a defect that `runRoute` rejects with. The type is honest about it: any service may be missing. A new route
 * must use `bindingsOrUnavailable`, which answers a missing binding before anything runs;
 * `tests/architecture/legacy-bindings.test.ts` fails when any other file imports this.
 */
export function legacyBindingsOrDefect(
	env: Env,
): Context.Context<ServiceOf[BindingName]> {
	return boundServices(env);
}

// Mail: Resend. A refusal is a provider answer that is not a success below 500; an uncertain send is a 5xx or a timeout,
// which does not prove the provider rejected the email (what sendAudioMessage in src/lib/audio-resend.ts reports as
// `uncertain`). A caller that must not send twice keeps its idempotency key across the retry.

/** Resend answered and did not send the email. */
export class MailRefused extends Data.TaggedError("MailRefused") {}

/** Resend did not answer in time, or failed on its side: the email may or may not have been sent. */
export class MailUncertain extends Data.TaggedError("MailUncertain") {}

/** An email, in the shape Resend's API takes and sendAudioMessage sends. */
export type MailMessage = {
	readonly from: string;
	readonly to: readonly string[];
	readonly subject: string;
	readonly text: string;
	readonly html?: string;
	readonly reply_to?: string;
	readonly attachments?: readonly { filename: string; content: string }[];
	readonly idempotencyKey?: string;
};

export class Mail extends Context.Service<
	Mail,
	{
		readonly send: (
			message: MailMessage,
		) => Effect.Effect<void, MailRefused | MailUncertain>;
	}
>()("site/Mail") {}

// Stripe: invoices and webhooks (src/lib/stripe-invoicing.ts).

/** Stripe is switched off, or its keys are not set on this deployment. */
export class StripeUnavailable extends Data.TaggedError("StripeUnavailable") {}

/** Stripe answered and did not make the invoice. */
export class StripeRefused extends Data.TaggedError("StripeRefused") {}

/**
 * Stripe did not answer in time, or failed on its side: the invoice may or may not have been created. As `MailUncertain`
 * says of an email, this is not a refusal, and a caller that must not create two keeps its idempotency key across a retry.
 */
export class StripeUncertain extends Data.TaggedError("StripeUncertain") {}

/** A webhook whose signature does not match its body. */
export class StripeSignatureInvalid extends Data.TaggedError(
	"StripeSignatureInvalid",
) {}

/** Who an invoice is for and what it says. */
export type StripeInvoiceRequest = {
	readonly name: string;
	readonly email: string;
	readonly summary: string;
};

/** The invoice Stripe made, as createInvoiceWithClient answers today. */
export type StripeInvoice = {
	readonly stripeCustomerId: string;
	readonly invoiceId: string;
	readonly hostedInvoiceUrl: string;
	readonly status: "open";
};

export class Stripe extends Context.Service<
	Stripe,
	{
		readonly createInvoice: (
			kind: "booking" | "balance",
			request: StripeInvoiceRequest,
			payment: AudioPayment,
		) => Effect.Effect<
			StripeInvoice,
			StripeUnavailable | StripeRefused | StripeUncertain
		>;
		readonly verifyWebhook: (
			rawBody: string,
			signature: string,
		) => Effect.Effect<
			StripeSdk.Event,
			StripeUnavailable | StripeSignatureInvalid
		>;
	}
>()("site/Stripe") {}

// Turnstile: the bot check on public forms (src/lib/turnstile.ts).

/** The token did not pass: Turnstile said no, did not answer in time, or answered something unreadable. */
export class TurnstileFailed extends Data.TaggedError("TurnstileFailed") {}

export class Turnstile extends Context.Service<
	Turnstile,
	{
		readonly verify: (
			token: string,
			remoteIp: string,
		) => Effect.Effect<void, TurnstileFailed>;
	}
>()("site/Turnstile") {}

// The live Mail and Turnstile. Each wraps the function the site called before (sendMail in src/lib/resend.ts, which
// the Resend-backed senders there share, and verifyTurnstile in src/lib/turnstile.ts) with the secret the request's env
// gives. A secret that is not set is passed on as it is, as it was: the provider then refuses it.

/** Mail through Resend, signed with `apiKey` (env.RESEND_API_KEY). */
export const liveMail = (apiKey: string) =>
	Context.make(Mail, {
		send: (message) =>
			// sendMail answers every failure as an outcome, so a rejection here would be a bug: a defect is intended, as the old routes let it escape as a 500.
			Effect.promise(() => sendMail(apiKey, message)).pipe(
				Effect.flatMap(
					(outcome): Effect.Effect<void, MailRefused | MailUncertain> => {
						switch (outcome) {
							case "sent":
								return Effect.void;
							case "refused":
								return Effect.fail(new MailRefused());
							case "uncertain":
								return Effect.fail(new MailUncertain());
						}
					},
				),
			),
	});

/** The Turnstile check with `secret` (env.TURNSTILE_SECRET_KEY). */
export const liveTurnstile = (secret: string) =>
	Context.make(Turnstile, {
		verify: (token, remoteIp) =>
			// verifyTurnstile answers every failure as false, so a rejection here would be a bug: a defect is intended, as the old routes let it escape as a 500.
			Effect.promise(() => verifyTurnstile(token, secret, remoteIp)).pipe(
				Effect.flatMap((passed) =>
					passed ? Effect.void : Effect.fail(new TurnstileFailed()),
				),
			),
	});
