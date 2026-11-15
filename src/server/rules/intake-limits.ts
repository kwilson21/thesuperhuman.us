// The decisions the public forms share before anything is stored: the attempt limit, the captcha check and the request limit,
// each a refusal the route answers as it always has. The counters are read by the flow (src/server/flows/rate-limit.ts), so
// each rule is given the answer of its count, and the order of the rules is the order the flows check them in.
import * as Data from "effect/Data";
import { intakeWait } from "../../lib/music-request";
import { alwaysWrites, term, unless } from "../terms";
import { CaptchaRefused, CaptchaUnavailable } from "./captcha";

/** The address has used up its attempts in the window: 429. */
export class TooManyAttempts extends Data.TaggedError("TooManyAttempts") {
	readonly say = intakeWait;
}

/** The address has already sent a request in the window: 429. */
export class TooManyRequests extends Data.TaggedError("TooManyRequests") {
	readonly say = intakeWait;
}

/** An attempt is allowed while the address is within the attempt limit. */
export const attemptWithinLimit = alwaysWrites({
	name: "Count an attempt within the attempt limit",
	given: (
		request: { readonly attemptsAllowed: boolean },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the address is within its attempt limit",
				(given: { readonly attemptsAllowed: boolean }) => given.attemptsAllowed,
			),
			() => new TooManyAttempts(),
		),
	],
	writes: () => true,
	writesText: "the attempt, counted before the captcha is checked",
});

/** A request is stored only for a captcha check that passed. */
export const admitForPassedCheck = alwaysWrites({
	name: "Admit a request for a passed captcha check",
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
	writesText: "the request, for a captcha check that passed",
});

/** A request is stored only while the address is within its request limit. */
export const requestWithinLimit = alwaysWrites({
	name: "Count a request within the request limit",
	given: (
		request: { readonly requestAllowed: boolean },
		_facts: Record<string, never>,
	) => request,
	refusals: [
		unless(
			term(
				"the address is within its request limit",
				(given: { readonly requestAllowed: boolean }) => given.requestAllowed,
			),
			() => new TooManyRequests(),
		),
	],
	writes: () => true,
	writesText: "the request, counted against the address",
});
