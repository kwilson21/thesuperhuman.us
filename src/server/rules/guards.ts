// The two checks every public form runs after its body has been read: the visitor has not just submitted, and the
// captcha passed. Contact and resume request share them, in this order (the rate limit counts a submission even when the
// captcha then fails, as it always has). Each refusal carries the sentence the form shows.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { checkRateLimit } from "../../lib/rate-limit";
import { RateLimit, Turnstile } from "../services";

export class RateLimited extends Data.TaggedError("RateLimited") {
	readonly say = "Please wait a few minutes before submitting again.";
}

export class CaptchaFailed extends Data.TaggedError("CaptchaFailed") {
	readonly say = "Captcha failed.";
}

/** Who is submitting: the address Cloudflare saw, and the captcha token the form sent. */
export type Visitor = {
	readonly ip: string;
	readonly turnstileToken: string;
};

/**
 * Counts the submission against the visitor's address and checks the captcha. A rate limit store that cannot be read or
 * written is a defect, not a refusal: the route answers 500 as it did.
 */
export const passGuards = (visitor: Visitor) =>
	Effect.gen(function* () {
		const rateLimit = yield* RateLimit;

		const counted = yield* Effect.promise(() =>
			checkRateLimit(rateLimit, visitor.ip),
		);

		if (!counted.allowed) return yield* Effect.fail(new RateLimited());

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(visitor.turnstileToken, visitor.ip)
			.pipe(Effect.mapError(() => new CaptchaFailed()));
	});
