// Issuing a suggestion pass: the captcha check decides (a rule reads its outcome), and only a passed check is signed into
// the cookie that lets the visitor ask for suggestions for the next half hour. The check is not counted here: the route has
// never counted its attempts (a STOP item for the owner). A signing failure is a named error the route logs and answers 500.
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { createSuggestionPass } from "../../lib/brief-suggestion-pass";
import { issueForPassedCheck } from "../rules/brief-pass";
import { CaptchaUnavailable } from "../rules/captcha";
import { TurnstileCheck } from "../services";

/** Signing the pass failed (the HMAC could not be made). */
export class PassSigningFailed extends Data.TaggedError("PassSigningFailed")<{
	readonly raised: unknown;
}> {}

export type PassAnswer =
	| { readonly kind: "issued"; readonly cookie: string }
	| { readonly kind: "refused" }
	| { readonly kind: "unavailable" };

export const issuePass = (submission: {
	readonly token: string;
	readonly ip: string;
	readonly secret: string;
}) =>
	Effect.gen(function* () {
		const check = yield* TurnstileCheck;
		const outcome = yield* check.check(submission.token, submission.ip);

		const verdict = yield* Effect.result(
			issueForPassedCheck.decide({ outcome }, {}),
		);

		if (Result.isFailure(verdict)) {
			return verdict.failure instanceof CaptchaUnavailable
				? ({ kind: "unavailable" } as const)
				: ({ kind: "refused" } as const);
		}

		const cookie = yield* Effect.tryPromise({
			try: () => createSuggestionPass(submission.secret, submission.ip),
			catch: (cause) => new PassSigningFailed({ raised: cause }),
		});

		return { kind: "issued", cookie } as const;
	});
