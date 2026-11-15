import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { clientPortalEnabled } from "~/lib/audio-client-access";
import { validateIntake } from "~/lib/audio-intake";
import { musicRequest } from "~/lib/music-request";
import { logUnexpected } from "~/server/failure";
import { type IntakeAnswer, submitIntake } from "~/server/flows/audio-intake";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveOwnerAlert,
	liveOwnerNotice,
	liveProjectInvitation,
	liveTurnstileCheck,
} from "~/server/services";

export const prerender = false;

const ROUTE = "/api/audio-intake";

const unavailable =
	"Sending is temporarily unavailable. Your details are still here. Please try again later.";

const unstored =
	"We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.";

const wait = "Please wait a few minutes before sending again.";

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

/** Each answer of the intake flow, as the form shows it. */
const answerResponse = (answer: IntakeAnswer) => {
	switch (answer.kind) {
		case "tooManyAttempts":
		case "tooManyRequests":
			return Response.json({ ok: false, error: wait }, { status: 429 });
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
		case "unstored":
			return Response.json({ ok: false, error: unstored }, { status: 500 });
		case "sent":
			return Response.json({ ok: true });
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request, 32768);

	if (body instanceof Response) return body;
	const result = validateIntake(body);

	if (!result.ok)
		return Response.json({ ok: false, errors: result.errors }, { status: 400 });
	const env = locals.runtime?.env;

	if (!env?.TURNSTILE_SECRET_KEY) return notAvailable();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);
	const db = env.MUSIC_DB;

	if (!bindings.ok || !db) return notAvailable();

	const answer = await runRoute(
		Context.merge(
			Context.merge(
				bindings.services,
				liveTurnstileCheck(env.TURNSTILE_SECRET_KEY),
			),
			Context.merge(
				Context.merge(liveOwnerAlert(env), liveOwnerNotice(env)),
				Context.merge(
					liveProjectInvitation(db, env),
					liveBackground(locals.runtime?.ctx),
				),
			),
		),
		submitIntake({
			input: result.value,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			portal: clientPortalEnabled(env),
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
		}).pipe(
			Effect.map(answerResponse),
			Effect.catchTag("RateLimitStoreFailed", (failure) =>
				Effect.sync(() => {
					logUnexpected(ROUTE, failure.cause);

					return temporarilyUnavailable(500);
				}),
			),
		),
		// A defect is the route's temporary sentence, logged once.
		{ route: ROUTE, answer: () => temporarilyUnavailable(500) },
	);

	return answer;
};
