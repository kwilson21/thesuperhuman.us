// The decision on a suggestion pass: a pass is issued only when the captcha check passed. A refused token and an
// unavailable check are the two named refusals in ./captcha.
import { alwaysWrites, term, unless } from "../terms";
import { CaptchaRefused, CaptchaUnavailable } from "./captcha";

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
