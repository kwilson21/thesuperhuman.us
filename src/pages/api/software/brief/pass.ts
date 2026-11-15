import type { APIRoute } from "astro";
import * as Effect from "effect/Effect";
import { suggestionPassCookie } from "~/lib/brief-suggestion-pass";
import { BodyReadFailed, readBody, readPassInput } from "~/server/brief-input";
import { logUnexpected } from "~/server/failure";
import { issuePass, PassSigningFailed } from "~/server/flows/brief-pass";
import { runRoute } from "~/server/run";
import { liveTurnstileCheck } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/software/brief/pass";

const headers = () => new Headers({ "cache-control": "no-store" });

/** A pass that was not issued says nothing of why: the same `{ ok: false }` the route has always answered. */
const notIssued = () => Response.json({ ok: false }, { headers: headers() });

const signingFailed = () =>
	Response.json({ ok: false }, { status: 500, headers: headers() });

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;
	const ip = request.headers.get("cf-connecting-ip");

	if (
		!env?.TURNSTILE_SECRET_KEY ||
		env.SOFTWARE_SUGGESTIONS_ENABLED !== "true" ||
		!ip
	)
		return notIssued();
	const secret = env.TURNSTILE_SECRET_KEY;

	return runRoute(
		liveTurnstileCheck(secret),
		Effect.gen(function* () {
			const read = readPassInput(yield* readBody(request, 4096));

			if (!read.ok) return notIssued();

			return yield* issuePass({ token: read.value.token, ip, secret }).pipe(
				Effect.map((answer) => {
					if (answer.kind === "unavailable")
						// The captcha service cannot answer: a known unavailable dependency.
						return Response.json(
							{ ok: false },
							{ status: 503, headers: headers() },
						);

					if (answer.kind === "refused") return notIssued();
					const issued = headers();

					issued.set(
						"set-cookie",
						`${suggestionPassCookie}=${answer.cookie}; Path=/api/software/brief; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`,
					);

					return Response.json({ ok: true }, { headers: issued });
				}),
			);
		}).pipe(
			Effect.catchTags({
				BodyReadFailed: (failure: BodyReadFailed) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return signingFailed();
					}),
				PassSigningFailed: (failure: PassSigningFailed) =>
					Effect.sync(() => {
						logUnexpected(ROUTE, failure.failure);

						return signingFailed();
					}),
			}),
		),
		{ route: ROUTE, answer: signingFailed },
	);
};
