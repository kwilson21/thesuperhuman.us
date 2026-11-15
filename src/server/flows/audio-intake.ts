// An audio request: the attempt limit is counted first, then the captcha is checked, then the request limit is counted, and
// only then is the request stored. A storage failure gives the request's allowance back, is logged and sends the owner an
// urgent alert, and the visitor is told the request was not stored. A stored request answers at once; the owner notice and
// the studio invitation (when the client portal is on) are handed to the background (ctx.waitUntil, with no context they are waited for) at the point the route always did,
// and never change the answer.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import {
	type IntakeInput,
	ownerRequestForIntake,
} from "../../lib/audio-intake";
import { logUnexpected } from "../failure";
import { storeRequest } from "../intake-store";
import {
	admitForPassedCheck,
	attemptWithinLimit,
	requestWithinLimit,
} from "../rules/intake-limits";
import { CaptchaUnavailable } from "../rules/captcha";
import {
	Background,
	OwnerAlert,
	OwnerNotice,
	ProjectInvitation,
	TurnstileCheck,
} from "../services";
import { countRequest, giveBack } from "./rate-limit";

const ROUTE = "/api/audio-intake";

/** The attempts an address may make in the window, counted before the captcha is checked. */
const ATTEMPTS = 10;

const ATTEMPT_PREFIX = "rl:audio-attempt:";
const REQUEST_PREFIX = "rl:audio:";

/** Each answer of the intake, as the route shows it. */
export type IntakeAnswer =
	| { readonly kind: "tooManyAttempts" }
	| { readonly kind: "captchaUnavailable" }
	| { readonly kind: "captchaRefused" }
	| { readonly kind: "tooManyRequests" }
	| { readonly kind: "unstored" }
	| { readonly kind: "sent" };

export type IntakeSubmission = {
	readonly input: IntakeInput;
	readonly ip: string;
	/** Whether the client portal is on, so the visitor is invited. */
	readonly portal: boolean;
	readonly now: () => Date;
	readonly newId: () => string;
};

export const submitIntake = (submission: IntakeSubmission) =>
	Effect.gen(function* () {
		const attempts = yield* countRequest(
			submission.ip,
			ATTEMPT_PREFIX,
			ATTEMPTS,
		);

		const attempt = yield* Effect.result(
			attemptWithinLimit.decide({ attemptsAllowed: attempts }, {}),
		);

		if (Result.isFailure(attempt)) return { kind: "tooManyAttempts" } as const;

		const check = yield* TurnstileCheck;

		const outcome = yield* check.check(
			submission.input.turnstileToken,
			submission.ip,
		);

		const admitted = yield* Effect.result(
			admitForPassedCheck.decide({ outcome }, {}),
		);

		if (Result.isFailure(admitted))
			return admitted.failure instanceof CaptchaUnavailable
				? ({ kind: "captchaUnavailable" } as const)
				: ({ kind: "captchaRefused" } as const);

		const requested = yield* countRequest(submission.ip, REQUEST_PREFIX);

		const limit = yield* Effect.result(
			requestWithinLimit.decide({ requestAllowed: requested }, {}),
		);

		if (Result.isFailure(limit)) return { kind: "tooManyRequests" } as const;

		const stored = yield* Effect.result(
			storeRequest(ownerRequestForIntake(submission.input)),
		);

		if (Result.isFailure(stored)) {
			// Giving the allowance back is best effort: the owner must hear of a lost request even when the counter cannot be cleared.
			const released = yield* Effect.result(
				giveBack(submission.ip, REQUEST_PREFIX),
			);

			if (Result.isFailure(released))
				yield* Effect.sync(() => logUnexpected(ROUTE, released.failure.raised));

			yield* Effect.sync(() => logUnexpected(ROUTE, stored.failure.raised));

			const alert = yield* OwnerAlert;

			yield* Effect.result(
				alert.send({
					category: "request-storage",
					route: "/api/audio-intake",
					requestId: submission.newId(),
					code: "d1-write-failed",
					occurredAt: submission.now().toISOString(),
				}),
			);

			return { kind: "unstored" } as const;
		}

		const owner = yield* OwnerNotice;
		const background = yield* Background;

		// Each notice is best effort and says so itself: a failure is logged in the words the route has always used.
		const work = [
			owner
				.send({ input: submission.input, requestId: stored.success.id })
				.pipe(
					Effect.catchTag("OwnerNoticeFailed", () =>
						Effect.sync(() =>
							console.error("Owner notification email state is uncertain."),
						),
					),
				),
		];

		if (submission.portal) {
			const invitation = yield* ProjectInvitation;

			work.push(
				invitation
					.deliver(stored.success.id)
					.pipe(
						Effect.catchTag("ProjectInvitationFailed", () =>
							Effect.sync(() =>
								console.error("Studio invitation email state is uncertain."),
							),
						),
					),
			);
		}

		yield* background.defer(work);

		return { kind: "sent" } as const;
	});
