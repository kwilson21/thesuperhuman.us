// The music interest flow: a listener says they want a release. The sequence matters, as it does for the contact form: the
// address is counted coarsely first so the captcha service is not asked without bound, then the captcha is checked, then
// the listener's own allowance is counted (so a request that fails the captcha never uses it up), then the interest and
// the owner's requests are stored in one batch. When that store fails, the allowance is given back (best effort, so the
// owner is still told if it cannot be) and the owner is alerted, then the failure goes on to the route. It builds no
// response text; each refusal carries the sentence the form shows.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { saveInterest } from "../music-store";
import type { InterestInput } from "../music-input";
import { recordInterest } from "../rules/music-interest";
import { OwnerAlert, Turnstile } from "../services";
import { countRequest, giveBack } from "./rate-limit";

export class TooManyInterests extends Data.TaggedError("TooManyInterests") {
	readonly say = "Please wait a few minutes before sending another request.";
}

export class VerificationExpired extends Data.TaggedError(
	"VerificationExpired",
) {
	readonly say = "Verification expired. Please try again.";
}

/** How many captcha attempts one address may make in a window. */
const ATTEMPTS = 10;

export type InterestSubmission = {
	readonly input: InterestInput;
	/** The address Cloudflare saw. */
	readonly ip: string;
	/** The time, read when the interest is stored. */
	readonly now: () => Date;
	/** A new random id, for each owner request and for the alert. */
	readonly newId: () => string;
};

export const submitInterest = (submission: InterestSubmission) =>
	Effect.gen(function* () {
		const { input, ip, now, newId } = submission;

		if (!(yield* countRequest(ip, "rl:music-interest-attempt:", ATTEMPTS)))
			return yield* Effect.fail(new TooManyInterests());

		const turnstile = yield* Turnstile;

		yield* turnstile
			.verify(input.turnstileToken, ip)
			.pipe(Effect.mapError(() => new VerificationExpired()));

		if (!(yield* countRequest(ip, "rl:music-interest:")))
			return yield* Effect.fail(new TooManyInterests());

		// A rule that refuses nothing and has something to do always answers a write.
		const write = yield* recordInterest
			.decide(input, {})
			.pipe(Effect.map(Option.getOrThrow));

		const stored = now().toISOString();
		const requestIds = write.requests.map(() => `music-${newId()}`);

		yield* saveInterest(write, requestIds, stored).pipe(
			Effect.tapErrorTag("MusicStoreFailed", () =>
				Effect.gen(function* () {
					// Giving the allowance back must not stop the owner being told that a request was lost.
					yield* giveBack(ip, "rl:music-interest:").pipe(Effect.ignore);

					const alert = yield* OwnerAlert;

					yield* alert.send({
						category: "request-storage",
						route: "/api/music-interest",
						requestId: newId(),
						code: "d1-write-failed",
						occurredAt: now().toISOString(),
					});
				}),
			),
		);
	});
