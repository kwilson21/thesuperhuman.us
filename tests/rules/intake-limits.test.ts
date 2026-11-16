import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	admitForPassedCheck,
	attemptWithinLimit,
	requestWithinLimit,
} from "../../src/server/rules/intake-limits";
import type { Refusal } from "../../src/server/terms";
import { refuse } from "../helpers/rule-answers";

// The three decisions the public forms share, each as the answer a visitor gets. These rules always have something to do,
// so a rule that refuses nothing answers "stores".

const answered = <E extends Refusal>(decided: Effect.Effect<unknown, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => refuse(refusal._tag, refusal.say),
			onSuccess: () => "stores" as const,
		}),
	);

describe("the attempt limit", () => {
	it("counts an attempt while the address is within its limit", () => {
		expect(
			answered(attemptWithinLimit.decide({ attemptsAllowed: true }, {})),
		).toBe("stores");
	});

	it("refuses an address that has used its attempts up", () => {
		expect(
			answered(attemptWithinLimit.decide({ attemptsAllowed: false }, {})),
		).toEqual(
			refuse(
				"TooManyAttempts",
				"Please wait a few minutes before sending again.",
			),
		);
	});
});

describe("the captcha check", () => {
	it("admits a token the check passed", () => {
		expect(
			answered(admitForPassedCheck.decide({ outcome: "passed" }, {})),
		).toBe("stores");
	});

	it("refuses a token the check refused", () => {
		expect(
			answered(admitForPassedCheck.decide({ outcome: "refused" }, {})),
		).toEqual(
			refuse("CaptchaRefused", "Please complete the security check again."),
		);
	});

	it("says the check is unavailable, not refused, when it could not answer", () => {
		expect(
			answered(admitForPassedCheck.decide({ outcome: "unavailable" }, {})),
		).toEqual(
			refuse(
				"CaptchaUnavailable",
				"Sending is temporarily unavailable. Your details are still here. Please try again later.",
			),
		);
	});
});

describe("the request limit", () => {
	it("stores a request while the address is within its limit", () => {
		expect(
			answered(requestWithinLimit.decide({ requestAllowed: true }, {})),
		).toBe("stores");
	});

	it("refuses a second request from the same address in the window", () => {
		expect(
			answered(requestWithinLimit.decide({ requestAllowed: false }, {})),
		).toEqual(
			refuse(
				"TooManyRequests",
				"Please wait a few minutes before sending again.",
			),
		);
	});
});
