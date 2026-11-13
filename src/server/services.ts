// What the Effect rules and saves depend on, one service each, in kwilson21/tally's form (`src/db/database.ts`): a
// route provides the request's own bindings and a test provides whichever doubles it likes. Time and the acting user are
// not services; they are plain inputs to a rule. `liveServices` is the one place that reads the request's env.
//
// The bindings are real here. Mail, Stripe and Turnstile are only their interface and typed errors in this layer: each
// live implementation, wrapping the function the site calls today, comes with the first route that uses it.
import type StripeSdk from "stripe";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type { AudioPayment } from "../lib/audio-payments";

/**
 * Each binding below is typed as env.d.ts types it. MUSIC_DB, PUBLICATION_DB and OAUTH_KV are optional there, because a
 * deployment may not have them: the service is then `undefined`, and the route that needs it answers as it does today.
 */
export class MusicDb extends Context.Service<MusicDb, D1Database | undefined>()(
	"site/MusicDb",
) {}

export class PublicationDb extends Context.Service<
	PublicationDb,
	D1Database | undefined
>()("site/PublicationDb") {}

/** The KV namespace the rate limits count in (env.RATE_LIMIT). */
export class RateLimit extends Context.Service<RateLimit, KVNamespace>()(
	"site/RateLimit",
) {}

/** The KV namespace holding approval tokens and the resume PDFs (env.RESUME_STORE). */
export class ResumeStore extends Context.Service<ResumeStore, KVNamespace>()(
	"site/ResumeStore",
) {}

export class OAuthKv extends Context.Service<
	OAuthKv,
	KVNamespace | undefined
>()("site/OAuthKv") {}

/** The R2 bucket for audio, project files and agreement attachments (env.AUDIO). */
export class AudioBucket extends Context.Service<AudioBucket, R2Bucket>()(
	"site/AudioBucket",
) {}

/** The services `liveServices` provides: every binding. */
export type BindingServices =
	| MusicDb
	| PublicationDb
	| RateLimit
	| ResumeStore
	| OAuthKv
	| AudioBucket;

/** The one place that reads the request's env (`locals.runtime.env`) and turns its bindings into services. */
export const liveServices = (env: Env): Context.Context<BindingServices> =>
	Context.make(MusicDb, env.MUSIC_DB).pipe(
		Context.add(PublicationDb, env.PUBLICATION_DB),
		Context.add(RateLimit, env.RATE_LIMIT),
		Context.add(ResumeStore, env.RESUME_STORE),
		Context.add(OAuthKv, env.OAUTH_KV),
		Context.add(AudioBucket, env.AUDIO),
	);

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
		) => Effect.Effect<StripeInvoice, StripeUnavailable | StripeRefused>;
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
