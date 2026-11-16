// The outside calls of the agreement routes that the shared services file does not already name: the agreement mail
// (src/lib/audio-resend.ts sendAudioMessage, which answers every outcome as a value) and the studio allowance counter
// (src/lib/audio-client-access.ts reserveStudioAllowance, which counts a key in D1). Each live service wraps the function
// the route called before, with the secret the request's env gives. A call that rejects is a defect: the route answers its
// fixed sentence as a 500 and logs it through logUnexpected, as the old routes' catch did.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { sendAudioMessage } from "../lib/audio-resend";
import { reserveStudioAllowance } from "../lib/audio-client-access";
import { keyedHash } from "../lib/client-portal";

/** What Resend said about one message: sent, refused, or not known (the send may have happened). */
export type MailOutcome = "sent" | "refused" | "uncertain";

export type AgreementMailMessage = Parameters<
	typeof sendAudioMessage
>[0]["payload"];

/** The mail call rejected, which its callee is written never to do. The route logs the cause and answers its fixed 500. */
export class AgreementMailFailed extends Data.TaggedError(
	"AgreementMailFailed",
)<{ readonly failure: unknown }> {}

/** The allowance counter or the keyed hash rejected. The route logs the cause and answers its fixed 500. */
export class AgreementAllowanceFailed extends Data.TaggedError(
	"AgreementAllowanceFailed",
)<{ readonly failure: unknown }> {}

export class AgreementMail extends Context.Service<
	AgreementMail,
	{
		readonly send: (
			payload: AgreementMailMessage,
		) => Effect.Effect<MailOutcome, AgreementMailFailed>;
	}
>()("site/AgreementMail") {}

/** The agreement mail through Resend, signed with `apiKey` (env.RESEND_API_KEY). */
export const liveAgreementMail = (apiKey: string) =>
	Context.make(AgreementMail, {
		send: (payload) =>
			Effect.tryPromise({
				try: () => sendAudioMessage({ apiKey, payload }),
				catch: (cause) => new AgreementMailFailed({ failure: cause }),
			}).pipe(
				Effect.map(
					(sent): MailOutcome =>
						sent.ok ? "sent" : sent.uncertain ? "uncertain" : "refused",
				),
			),
	});

export class AgreementAllowance extends Context.Service<
	AgreementAllowance,
	{
		/** Counts one use of `subject` under `scope` and says whether it is within `limit`. */
		readonly reserve: (
			scope: string,
			subject: string,
			limit: number,
		) => Effect.Effect<boolean, AgreementAllowanceFailed>;
		/** A keyed hash of `message` with the code key. */
		readonly keyed: (
			message: string,
		) => Effect.Effect<string, AgreementAllowanceFailed>;
	}
>()("site/AgreementAllowance") {}

/** The allowance counter in D1, keyed with the request's code key (env.AUDIO_CLIENT_CODE_KEY). */
export const liveAgreementAllowance = (db: D1Database, secret: string) =>
	Context.make(AgreementAllowance, {
		reserve: (scope, subject, limit) =>
			Effect.tryPromise({
				try: () => reserveStudioAllowance(db, scope, subject, limit, secret),
				catch: (cause) => new AgreementAllowanceFailed({ failure: cause }),
			}).pipe(Effect.map((allowance) => allowance.allowed)),
		keyed: (message) =>
			Effect.tryPromise({
				try: () => keyedHash(secret, message),
				catch: (cause) => new AgreementAllowanceFailed({ failure: cause }),
			}),
	});

/** Hashing a token with the platform's digest rejected. The route logs the cause and answers its fixed 500. */
export class HashFailed extends Data.TaggedError("HashFailed")<{
	readonly failure: unknown;
}> {}

/** Hashes `value` with `hash` (the site's token hash or the bytes' digest) and names a failure. */
export const hashing = (hash: () => Promise<string>) =>
	Effect.tryPromise({
		try: hash,
		catch: (cause) => new HashFailed({ failure: cause }),
	});
