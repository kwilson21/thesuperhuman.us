import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { readResumeRequestInput } from "~/server/contact-input";
import {
	forbidden,
	invalidJson,
	isAllowedOrigin,
	readJsonBody,
} from "~/server/public-form";
import { requestResume } from "~/server/rules/resume";
import { runRoute } from "~/server/run";
import { bindingsOrDefect, liveMail, liveTurnstile } from "~/server/services";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const { request, locals } = context;
	const env = locals.runtime.env;

	if (!isAllowedOrigin(request.headers.get("origin"))) return forbidden();

	const parsed = await readJsonBody(request);

	if (!parsed.ok) return invalidJson();

	const input = readResumeRequestInput(parsed.body);

	if (!input.ok) {
		return Response.json({ ok: false, errors: input.errors }, { status: 400 });
	}

	// A missing RATE_LIMIT or RESUME_STORE binding is a defect at its first read, as it always was (Astro answers 500).
	const services = Context.merge(
		Context.merge(
			bindingsOrDefect(env, ["RATE_LIMIT", "RESUME_STORE"]),
			liveTurnstile(env.TURNSTILE_SECRET_KEY),
		),
		liveMail(env.RESEND_API_KEY),
	);

	return runRoute(
		services,
		requestResume({
			input: input.value,
			visitor: {
				ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
				turnstileToken: input.value.turnstileToken,
			},
			now: Date.now(),
			id: crypto.randomUUID(),
			// The request's own origin, so a preview deployment's link points at the preview.
			origin: new URL(request.url).origin,
			from: env.CONTACT_FROM_EMAIL,
			to: env.CONTACT_TO_EMAIL,
		}).pipe(
			Effect.map(() => Response.json({ ok: true })),
			Effect.catchTags({
				RateLimited: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 429 }),
					),
				CaptchaFailed: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 403 }),
					),
				ResumeRequestNotSent: (refusal) =>
					Effect.succeed(
						Response.json({ ok: false, error: refusal.say }, { status: 500 }),
					),
			}),
		),
	);
};
