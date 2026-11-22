// The outside calls of the agreement routes that the shared services file does not already name: the agreement mail
// (src/lib/audio-resend.ts sendAudioMessage, which answers every outcome as a value) and the studio allowance counter (the
// studio sign-in area's count, `countAllowance` in src/server/studio-signin-store.ts, decided by `takeAllowance` in
// src/server/rules/studio-allowance.ts). Each live service wraps what the route called before, with the secret the
// request's env gives. A call that rejects is a defect: the route answers its fixed sentence as a 500 and logs it through
// logUnexpected, as the old routes' catch did.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { sendAudioMessage } from "../lib/audio-resend";
import { keyedHash } from "../lib/client-portal";
import { allowanceTimes, takeAllowance } from "./rules/studio-allowance";
import { MusicDb } from "./services";
import { countAllowance } from "./studio-signin-store";

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

/** A keyed hash of `message` with `secret`; a rejection (a code key under 32 characters included) is the route's 500. */
const keyedWith = (secret: string, message: string) =>
	Effect.tryPromise({
		try: () => keyedHash(secret, message),
		catch: (cause) => new AgreementAllowanceFailed({ failure: cause }),
	});

/**
 * The allowance counter in D1, keyed with the request's code key (env.AUDIO_CLIENT_CODE_KEY). A use reads the clock as it
 * is counted, then makes the key (the keyed hash of the scope and the subject) and counts it in one batch (the stale
 * windows pruned, the use counted); the allowance rule says whether it is within `limit`. The statements and their values
 * are the ones the studio sign-in routes count with, and the ones this counter ran before.
 */
export const liveAgreementAllowance = (db: D1Database, secret: string) =>
	Context.make(AgreementAllowance, {
		reserve: (scope, subject, limit) =>
			Effect.gen(function* () {
				const at = new Date();
				const key = yield* keyedWith(secret, `${scope}:${subject}`);

				const count = yield* countAllowance(key, allowanceTimes(at)).pipe(
					Effect.provideService(MusicDb, db),
					Effect.catchTags({
						StudioSigninStoreFailed: (failed) =>
							Effect.fail(
								new AgreementAllowanceFailed({ failure: failed.failure }),
							),
					}),
				);

				return yield* takeAllowance
					.decide({ limit }, count)
					.pipe(
						Effect.as(true),
						Effect.catchTags({ AllowanceSpent: () => Effect.succeed(false) }),
					);
			}),
		keyed: (message) => keyedWith(secret, message),
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
