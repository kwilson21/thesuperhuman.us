// The checks every public form runs after its body has been read, in this order: a coarse limit on the visitor's
// address, the captcha, and the visitor's own allowance. This is a flow, not a rule: it counts, checks, then counts again.
// The coarse limit comes first so the captcha service is not asked without bound; the allowance comes last so a request
// that fails the captcha never uses up the allowance of the visitor who sends the real one. Contact and resume request
// share them. Each refusal carries the sentence the form shows.
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

/** How many captcha attempts one address may make in a window; the same count the audio and software forms allow. */
const ATTEMPTS = 10;

/**
 * Counts the attempt against the visitor's address, checks the captcha, then counts the submission against the
 * visitor's allowance. A rate limit store that cannot be read or written is a defect, not a refusal: the route answers
 * 500 as it did.
 */
export const passGuards = (visitor: Visitor) =>
	Effect.gen(function* () {
		const rateLimit = yield* RateLimit;

		// A defect is intended here, not a refusal: the old route let a KV failure escape as an unanswered 500, and the golden corpus proves it.
		const attempt = yield* Effect.promise(() =>
			checkRateLimit(rateLimit, visitor.ip, "rl:attempt:", ATTEMPTS),
		);

		if (!attempt.allowed) return yield* Effect.fail(new RateLimited());

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(visitor.turnstileToken, visitor.ip)
			.pipe(Effect.mapError(() => new CaptchaFailed()));

		// The same intended defect as the count above.
		const counted = yield* Effect.promise(() =>
			checkRateLimit(rateLimit, visitor.ip),
		);

		if (!counted.allowed) return yield* Effect.fail(new RateLimited());
	});
