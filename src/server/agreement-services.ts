// The outside calls of the agreement routes that the shared services file does not already name: the agreement mail
// (src/lib/audio-resend.ts sendAudioMessage, which answers every outcome as a value) and the studio allowance counter (the
// studio sign-in area's count, `countAllowance` in src/server/studio-signin-store.ts, decided by `takeAllowance` in
// src/server/rules/studio-allowance.ts). Each live service wraps what the route called before, with the secret the
// request's env gives. A call that rejects is a defect: the route answers its fixed sentence as a 500 and logs it through
// logUnexpected, as the old routes' catch did. A code key under 32 characters is the one named refusal, CodeKeyUnusable,
// which the route answers 503 as today.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { sendAudioMessage } from "../lib/audio-resend";
import { codeKeyUsable, keyedHash } from "../lib/client-portal";
import type { CountedUse } from "./rules/signing-link";
import { allowanceTimes, takeAllowance } from "./rules/studio-allowance";
import { MusicDb } from "./services";
import { CodeKeyUnusable } from "./signin-services";
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

/**
 * One use an allowance counted: whether it is within the limit, the keyed hash it was counted under, and the start of the
 * window its count answered (`RETURNING uses,window_start`). A signing link whose mail is refused gives each use back by
 * its key and window start (`refundAllowances` in src/server/rules/signing-link.ts). A count that came back with no row
 * (which the upsert never does) is refused, and its window start is empty, as `reserveStudioAllowance` answered it; a
 * refused use answers 429 before any mail, so it is never given back.
 */
export type AllowanceUse = CountedUse & { readonly allowed: boolean };

export class AgreementAllowance extends Context.Service<
	AgreementAllowance,
	{
		/** Counts one use of `subject` under `scope` and says whether it is within `limit`, with the use counted. */
		readonly reserve: (
			scope: string,
			subject: string,
			limit: number,
		) => Effect.Effect<
			AllowanceUse,
			AgreementAllowanceFailed | CodeKeyUnusable
		>;
		/** A keyed hash of `message` with the code key. */
		readonly keyed: (
			message: string,
		) => Effect.Effect<string, AgreementAllowanceFailed | CodeKeyUnusable>;
	}
>()("site/AgreementAllowance") {}

/**
 * A keyed hash of `message` with `secret`. A code key under 32 characters is CodeKeyUnusable before anything is hashed (the
 * signing link answers it 503 where the first keyed hash fails it today, after the setting, the offer and the recipient
 * are read; the archive link refuses such a key before it reads anything); any other rejection is AgreementAllowanceFailed.
 */
const keyedWith = (secret: string, message: string) =>
	codeKeyUsable(secret)
		? Effect.tryPromise({
				try: () => keyedHash(secret, message),
				catch: (cause) => new AgreementAllowanceFailed({ failure: cause }),
			})
		: Effect.fail(new CodeKeyUnusable());

/**
 * The allowance counter in D1, keyed with the request's code key (env.AUDIO_CLIENT_CODE_KEY). A use reads the clock as it
 * is counted, then makes the key (the keyed hash of the scope and the subject) and counts it in one batch (the stale
 * windows pruned, the use counted); the allowance rule says whether it is within `limit`. The statements and their values
 * are the ones the studio sign-in routes count with, and the ones `reserveStudioAllowance` (src/lib/audio-client-access.ts)
 * ran. A code key under 32 characters is CodeKeyUnusable before the clock is read, as today's signing link checks the key
 * before its first use is counted.
 */
export const liveAgreementAllowance = (db: D1Database, secret: string) =>
	Context.make(AgreementAllowance, {
		reserve: (scope, subject, limit) =>
			Effect.gen(function* () {
				if (!codeKeyUsable(secret))
					return yield* Effect.fail(new CodeKeyUnusable());

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

				const allowed = yield* takeAllowance
					.decide({ limit }, { uses: count.uses })
					.pipe(
						Effect.as(true),
						Effect.catchTags({ AllowanceSpent: () => Effect.succeed(false) }),
					);

				const use: AllowanceUse = {
					key,
					window_start: count.window_start ?? "",
					allowed,
				};

				return use;
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
