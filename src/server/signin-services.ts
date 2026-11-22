// The outside calls of the studio sign-in routes that the shared services file does not already name
// (docs/plans/2026-11-studio-signin-conversion.md, section 4): the two hashes (`SigninKeys`) and the code's email (a `Mail`
// of this area's own). Turnstile and the background are the shared `Turnstile` and `Background`. Each wraps the function
// the routes called before, with the secret the request's env gives, and names each way it can fail that a route answers
// differently; the route, not these, decides what the visitor sees.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { sendAudioMessage } from "../lib/audio-resend";
import { codeKeyUsable, hashValue, keyedHash } from "../lib/client-portal";
import { Mail, type MailMessage, MailRefused, MailUncertain } from "./services";

// ---- the hashes ----

/**
 * The code key is under 32 characters (or not set), so no keyed hash can be made with it. It fails the first keyed hash a
 * request asks for, which is where today's routes refused it: in the first allowance, before any statement. The route
 * answers 503, as for a missing key, and logs nothing.
 */
export class CodeKeyUnusable extends Data.TaggedError("CodeKeyUnusable") {}

/** The platform's digest or HMAC rejected. `failure` is for the route's log; it answers 500. */
export class SigninHashFailed extends Data.TaggedError("SigninHashFailed")<{
	readonly failure: unknown;
}> {}

export class SigninKeys extends Context.Service<
	SigninKeys,
	{
		/** The HMAC-SHA-256 of `message` with the code key (src/lib/client-portal.ts `keyedHash`), as hex. */
		readonly keyed: (
			message: string,
		) => Effect.Effect<string, CodeKeyUnusable | SigninHashFailed>;
		/** The SHA-256 of `value` (src/lib/client-portal.ts `hashValue`), as hex. */
		readonly plain: (value: string) => Effect.Effect<string, SigninHashFailed>;
	}
>()("site/SigninKeys") {}

/**
 * The two hashes, keyed with `codeKey` (env.AUDIO_CLIENT_CODE_KEY). Sign-out has no code key and asks only for the plain
 * hash, so it passes none; a keyed hash asked for without a usable key fails as `CodeKeyUnusable`.
 */
export const liveSigninKeys = (codeKey: string | undefined) =>
	Context.make(SigninKeys, {
		keyed: (message) =>
			codeKey !== undefined && codeKeyUsable(codeKey)
				? Effect.tryPromise({
						try: () => keyedHash(codeKey, message),
						catch: (failure) => new SigninHashFailed({ failure }),
					})
				: Effect.fail(new CodeKeyUnusable()),
		plain: (value) =>
			Effect.tryPromise({
				try: () => hashValue(value),
				catch: (failure) => new SigninHashFailed({ failure }),
			}),
	});

// ---- the code's email ----

/** What sendAudioMessage is asked to send. */
type AudioRequest = Parameters<typeof sendAudioMessage>[0];

type AudioPayload = AudioRequest["payload"];

/**
 * The payload Resend is sent, with its keys in the order the code route has always sent them: from, to, subject, then
 * the email's own fields (`studioCodeEmail` renders html, then text), and the fields a code's email never carries
 * (reply_to, attachments) last. `sendAudioMessage` keeps the order it is given and the golden corpus records the request
 * body as text, so the order is part of what was sent; `liveMail` (src/server/services.ts) and `liveOfferMail`
 * (src/server/offers-services.ts) write other orders, which is why this area has a Mail of its own.
 */
export function signinPayload(message: MailMessage): AudioPayload {
	const head = {
		from: message.from,
		to: [...message.to],
		subject: message.subject,
	};

	const payload: AudioPayload =
		message.html === undefined
			? { ...head, text: message.text }
			: { ...head, html: message.html, text: message.text };

	if (message.reply_to !== undefined) payload.reply_to = message.reply_to;

	if (message.attachments !== undefined)
		payload.attachments = [...message.attachments];

	return payload;
}

/**
 * The code's email through Resend, signed with `apiKey` (env.RESEND_API_KEY): `sendAudioMessage` with the payload above.
 * `MailRefused` is a confirmed rejection (an answer that is not a success, below 500): the flow discards the code.
 * `MailUncertain` is a 5xx, a timeout or no answer: the email may still arrive, so the code is kept.
 */
export const liveSigninMail = (apiKey: string) =>
	Context.make(Mail, {
		send: (message) =>
			// sendAudioMessage answers every failure as an outcome (the whole call is inside its try), so a rejection here would be a bug: a defect is intended.
			Effect.promise(() => {
				const request: AudioRequest = {
					apiKey,
					payload: signinPayload(message),
				};

				if (message.idempotencyKey !== undefined)
					request.idempotencyKey = message.idempotencyKey;

				return sendAudioMessage(request);
			}).pipe(
				Effect.flatMap(
					(sent): Effect.Effect<void, MailRefused | MailUncertain> =>
						sent.ok
							? Effect.void
							: Effect.fail(
									sent.uncertain === true
										? new MailUncertain()
										: new MailRefused(),
								),
				),
			),
	});
