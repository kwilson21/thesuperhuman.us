import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { musicRequest } from "~/lib/music-request";
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
	liveBriefCopy,
	liveOwnerAlert,
	liveSoftwareNotice,
	liveTurnstileCheck,
} from "~/server/services";

export const prerender = false;

const ROUTE = "/api/software-inquiry";

const preserved =
	"We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.";

const unavailable =
	"Sending is temporarily unavailable. Your details are still here. Please try again later.";

const notAvailable = () =>
	Response.json(
		{
			ok: false,
			error:
				"Sending is unavailable right now. Your details are still here. Please email kazon.wilson@thesuperhuman.us.",
		},
		{ status: 503 },
	);

const temporarilyUnavailable = (status: number) =>
	Response.json({ ok: false, error: unavailable }, { status });

/** Each answer of the inquiry flow, as the form shows it. */
const answerResponse = (answer: InquiryAnswer) => {
	switch (answer.kind) {
		case "tooManyAttempts":
			return Response.json(
				{ ok: false, error: "Please wait a few minutes before sending again." },
				{ status: 429 },
			);
		case "tooManyRequests":
			return Response.json(
				{
					ok: false,
					error:
						"Please wait a few minutes before sending again. Your details are still here.",
				},
				{ status: 429 },
			);
		case "captchaUnavailable":
			return temporarilyUnavailable(503);
		case "captchaRefused":
			return Response.json(
				{
					ok: false,
					errors: {
						turnstileToken: "Please complete the security check again.",
					},
				},
				{ status: 403 },
			);
		case "readFailed":
		case "unstored":
			return Response.json({ ok: false, error: preserved }, { status: 500 });
		case "idTaken":
			return Response.json({ ok: false, error: preserved }, { status: 409 });
		case "tooLarge":
			return Response.json(
				{
					ok: false,
					errors: { _form: "Keep the brief shorter and try again." },
				},
				{ status: 400 },
			);
		case "alreadyStored":
			return Response.json({
				ok: true,
				brief: softwareBrief(answer.request),
				clientCopyStatus: answer.request.details.clientCopyStatus ?? "failed",
			});
		case "sent":
			return Response.json({
				ok: true,
				brief: softwareBrief(answer.request),
				clientCopyStatus: answer.clientCopyStatus,
			});
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request, 32768);

	if (body instanceof Response) return body;
	const result = validateSoftwareInquiry(body);

	if (!result.ok)
		return Response.json({ ok: false, errors: result.errors }, { status: 400 });
	const env = locals.runtime?.env;

	if (!env?.TURNSTILE_SECRET_KEY) return notAvailable();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);
	const db = env.MUSIC_DB;

	if (!bindings.ok || !db) return notAvailable();

	/** A failure the form answers with the temporary sentence, logged as it always was. */
	const failed = (failure: { readonly cause: unknown }) =>
		Effect.sync(() => {
			logUnexpected(ROUTE, failure.cause);

			return temporarilyUnavailable(500);
		});

	return runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				liveTurnstileCheck(env.TURNSTILE_SECRET_KEY),
			),
			Context.merge(
				Context.merge(liveOwnerAlert(env), liveBriefCopy(db, env)),
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
				RateLimitStoreFailed: failed,
				BriefCopyFailed: failed,
			}),
		),
		// A defect is the route's temporary sentence, logged once.
		{ route: ROUTE, answer: () => temporarilyUnavailable(500) },
	);
};
