// Counting a request against an address, through the RateLimit service (src/lib/rate-limit.ts keeps the count). The music
// routes answer a rate limit store that cannot be read or written with their fixed sentence, so a failure here is a named
// error, not a defect (the contact and resume routes, which answer a bare 500, count through ./guards instead).
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { checkRateLimit } from "../../lib/rate-limit";
import { RateLimit } from "../services";

/** The rate limit store could not be read or written. */
export class RateLimitStoreFailed extends Data.TaggedError(
	"RateLimitStoreFailed",
) {}

/** Counts one request from `ip` under `prefix`; true when it is within `max` in the window (one when `max` is left out). */
export const countRequest = (ip: string, prefix: string, max?: number) =>
	Effect.gen(function* () {
		const rateLimit = yield* RateLimit;

		const counted = yield* Effect.tryPromise({
			try: () => checkRateLimit(rateLimit, ip, prefix, max),
			catch: () => new RateLimitStoreFailed(),
		});

		return counted.allowed;
	});

/** Takes back the count of one request from `ip` under `prefix`, so a request that failed on our side does not use the allowance up. */
export const giveBack = (ip: string, prefix: string) =>
	Effect.gen(function* () {
		const rateLimit = yield* RateLimit;

		yield* Effect.tryPromise({
			try: () => rateLimit.delete(`${prefix}${ip}`),
			catch: () => new RateLimitStoreFailed(),
		});
	});
