import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { clientPortalEnabled } from "~/lib/audio-client-access";
import { validateIntake } from "~/lib/audio-intake";
import {
	intakeNotAvailable,
	intakeNotStored,
	intakeTemporarilyUnavailable,
	musicRequest,
} from "~/lib/music-request";
import { loggedAnswer } from "~/server/answers";
import { submitIntake } from "~/server/flows/audio-intake";
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

const failed = loggedAnswer(ROUTE, () => intakeTemporarilyUnavailable(500));

export const POST: APIRoute = async ({ request, locals }) => {
	const body = await musicRequest(request, 32768);

	if (body instanceof Response) return body;
	const result = validateIntake(body);

	if (!result.ok)
		return Response.json({ ok: false, errors: result.errors }, { status: 400 });
	const env = locals.runtime?.env;

	if (!env?.TURNSTILE_SECRET_KEY) return intakeNotAvailable();
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB", "RATE_LIMIT"]);
	const db = env.MUSIC_DB;

	if (!bindings.ok || !db) return intakeNotAvailable();

	return runRoute(
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
			Effect.map(() => Response.json({ ok: true })),
			Effect.catchTags({
				TooManyAttempts: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 429 }),
					),
				TooManyRequests: (refusal) =>
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
				RequestNotStored: () =>
					Effect.succeed(
						Response.json(
							{ ok: false, error: intakeNotStored },
							{ status: 500 },
						),
					),
				RateLimitStoreFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's temporary sentence, logged once.
		{ route: ROUTE, answer: () => intakeTemporarilyUnavailable(500) },
	);
};
