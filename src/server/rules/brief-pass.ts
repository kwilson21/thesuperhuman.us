// The decision on a suggestion pass: a pass is issued only when the captcha check passed. A refusal of the token and an
// unavailable check are different answers (the visitor is asked to try again only when the check could not answer), so
// each is its own named refusal, and the flow reads the name.
import { alwaysWrites, term, unless } from "../terms";

/** The check said the token is not good: no pass, and the route answers the same empty body as before. */
export class CaptchaRefused {
	readonly _tag = "CaptchaRefused";
	readonly say = "";
}

/** The check could not answer: no pass, and the route answers 503. */
export class CaptchaUnavailable {
	readonly _tag = "CaptchaUnavailable";
	readonly say = "";
}

/** A pass is issued only for a check that passed. */
export const issueForPassedCheck = alwaysWrites({
	name: "Issue a suggestion pass for a passed captcha check",
	given: (
		request: { readonly outcome: "passed" | "refused" | "unavailable" },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the check could answer",
				(given: { readonly outcome: string }) =>
					given.outcome !== "unavailable",
			),
			() => new CaptchaUnavailable(),
		),
		unless(
			term(
				"the check passed the token",
				(given: { readonly outcome: string }) => given.outcome === "passed",
			),
			() => new CaptchaRefused(),
		),
	],
	writes: () => true,
	writesText: "a suggestion pass for this address",
});
