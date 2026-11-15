import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	admitForPassedCheck,
	attemptWithinLimit,
	requestWithinLimit,
} from "../../src/server/rules/audio-intake";
import { answerOf, refuse } from "../helpers/rule-answers";

// The three decisions on an audio request, each as the answer a visitor gets.

describe("the attempt limit", () => {
	it("counts an attempt while the address is within its limit", () => {
		expect(
			Effect.runSync(
				Effect.result(attemptWithinLimit.decide({ attemptsAllowed: true }, {})),
			)._tag,
		).toBe("Success");
	});

	it("refuses an address that has used its attempts up", () => {
		expect(
			answerOf(attemptWithinLimit.decide({ attemptsAllowed: false }, {})),
		).toEqual(refuse("TooManyAttempts", ""));
	});
});

describe("the captcha check", () => {
	it("admits a token the check passed", () => {
		expect(
			Effect.runSync(
				Effect.result(admitForPassedCheck.decide({ outcome: "passed" }, {})),
			)._tag,
		).toBe("Success");
	});

	it("refuses a token the check refused", () => {
		expect(
			answerOf(admitForPassedCheck.decide({ outcome: "refused" }, {})),
		).toEqual(refuse("CaptchaRefused", ""));
	});

	it("says the check is unavailable, not refused, when it could not answer", () => {
		expect(
			answerOf(admitForPassedCheck.decide({ outcome: "unavailable" }, {})),
		).toEqual(refuse("CaptchaUnavailable", ""));
	});
});

describe("the request limit", () => {
	it("stores a request while the address is within its limit", () => {
		expect(
			Effect.runSync(
				Effect.result(requestWithinLimit.decide({ requestAllowed: true }, {})),
			)._tag,
		).toBe("Success");
	});

	it("refuses a second request from the same address in the window", () => {
		expect(
			answerOf(requestWithinLimit.decide({ requestAllowed: false }, {})),
		).toEqual(refuse("TooManyRequests", ""));
	});
});
