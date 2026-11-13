// What the Effect rules and saves depend on, one service each, in kwilson21/tally's form (`src/db/database.ts`): a
// route provides the request's own bindings and a test provides whichever doubles it likes. Time and the acting user are
// not services; they are plain inputs to a rule. `liveServices` is the one place that reads the request's env.
//
// The bindings are real here, and typed as required (see `bindingsOrUnavailable`). Mail, Stripe and Turnstile are only their interface and typed errors in this layer: each
// live implementation, wrapping the function the site calls today, comes with the first route that uses it.
import type StripeSdk from "stripe";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type { AudioPayment } from "../lib/audio-payments";

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

	// SAFETY: this starts with no services, and each binding that is set is added below with its own service class; the checks above make every name in `needs` one of them, so the route is promised only what it asked for.
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

	return { ok: true, services };
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
