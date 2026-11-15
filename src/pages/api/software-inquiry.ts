import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	intakeNotAvailable,
	intakeNotStored,
	intakeTemporarilyUnavailable,
	intakeTooLarge,
	musicRequest,
} from "~/lib/music-request";
import { softwareBrief, validateSoftwareInquiry } from "~/lib/software-inquiry";
import { logUnexpected } from "~/server/failure";
import {
	type InquiryAnswer,
	submitInquiry,
} from "~/server/flows/software-inquiry";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveClientCopyMail,
	liveOwnerAlert,
	liveSoftwareNotice,
	liveTurnstileCheck,
} from "~/server/services";

export const prerender = false;

const ROUTE = "/api/software-inquiry";

/** What the flow answers when it goes through, as the form shows it. */
const answerResponse = (answer: InquiryAnswer) =>
	Response.json({
		ok: true,
		brief: softwareBrief(answer.request),
		clientCopyStatus:
			answer.kind === "alreadyStored"
				? (answer.request.details.clientCopyStatus ?? "failed")
				: answer.clientCopyStatus,
	});

/** The brief was not stored, or its stored copy is another visitor's: the fixed sentence, with the status given. */
const notStored = (status: number) =>
	Response.json({ ok: false, error: intakeNotStored }, { status });

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request, 32768);

	if (body instanceof Response) return body;
	const result = validateSoftwareInquiry(body);

	if (!result.ok)
		return Response.json({ ok: false, errors: result.errors }, { status: 400 });
	const env = locals.runtime?.env;

	if (!env?.TURNSTILE_SECRET_KEY) return intakeNotAvailable();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);

	if (!bindings.ok) return intakeNotAvailable();

	/** A failure the form answers with the temporary sentence, logged as it always was. */
	const failed = (failure: { readonly failure: unknown }) =>
		Effect.sync(() => {
			logUnexpected(ROUTE, failure.failure);

			return intakeTemporarilyUnavailable(500);
		});

	return runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				liveTurnstileCheck(env.TURNSTILE_SECRET_KEY),
			),
			Context.merge(
				Context.merge(liveOwnerAlert(env), liveClientCopyMail(env)),
				Context.merge(
					liveSoftwareNotice(env),
					liveBackground(locals.runtime?.ctx),
				),
			),
		),
		submitInquiry({
			input: result.value,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			Effect.map(answerResponse),
			Effect.catchTags({
				TooManyAttempts: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 429 }),
					),
				TooManyBriefs: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 429 }),
					),
				CaptchaUnavailable: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 503 }),
					),
				CaptchaRefused: (refusal) =>
					Effect.succeed(
						Response.json(
							{ ok: false, errors: { turnstileToken: refusal.say } },
							{ status: 403 },
						),
					),
				SubmissionIdTaken: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 409 }),
					),
				BriefReadFailed: () => Effect.succeed(notStored(500)),
				BriefNotStored: () => Effect.succeed(notStored(500)),
				BriefTooLarge: () =>
					Effect.succeed(
						Response.json(
							{ ok: false, errors: { _form: intakeTooLarge } },
							{ status: 400 },
						),
					),
				RateLimitStoreFailed: failed,
			}),
		),
		// A defect is the route's temporary sentence, logged once.
		{ route: ROUTE, answer: () => intakeTemporarilyUnavailable(500) },
	);
};
