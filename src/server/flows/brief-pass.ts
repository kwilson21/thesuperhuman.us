// Issuing a suggestion pass: the captcha check decides (a rule reads its outcome), and only a passed check is signed into
// the cookie that lets the visitor ask for suggestions for the next half hour. The check is not counted here: the route has
// never counted its attempts (a STOP item for the owner). A refused or unavailable check is the rule's named refusal, and a
// signing failure is a named error; the route maps each (it logs the signing failure and answers 500).
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { createSuggestionPass } from "../../lib/brief-suggestion-pass";
import { issueForPassedCheck } from "../rules/brief-pass";
import { TurnstileCheck } from "../services";

/** Signing the pass failed (the HMAC could not be made). */
export class PassSigningFailed extends Data.TaggedError("PassSigningFailed")<{
	readonly failure: unknown;
}> {}

export const issuePass = (submission: {
	readonly token: string;
	readonly ip: string;
	readonly secret: string;
}) =>
	Effect.gen(function* () {
		const check = yield* TurnstileCheck;
		const outcome = yield* check.check(submission.token, submission.ip);

		yield* issueForPassedCheck.decide({ outcome }, {});

		return yield* Effect.tryPromise({
			try: () => createSuggestionPass(submission.secret, submission.ip),
			catch: (cause) => new PassSigningFailed({ failure: cause }),
		});
	});
