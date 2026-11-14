import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { agreementJson } from "~/lib/agreement-access";
import {
	agreementRequest,
	nativeAgreementRoute,
} from "~/lib/agreement-request";
import { newOfferToken } from "~/lib/software-offers";
import { siteOrigin } from "~/lib/site-origin.mjs";
import { readAgreementLinkInput } from "~/server/agreement-input";
import {
	liveAgreementAllowance,
	liveAgreementMail,
} from "~/server/agreement-services";
import { requestArchiveLink } from "~/server/flows/agreement-link";
import {
	ARCHIVE_RECEIPT,
	isCanonicalRequest,
	linkIsConfigured,
	UNAVAILABLE,
} from "~/server/rules/agreement-link";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, liveTurnstile } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/link";

const unavailable = () => agreementJson({ ok: false, error: UNAVAILABLE }, 500);

const post: APIRoute = async ({ request, locals }) => {
	const body = await agreementRequest(request, 4096);

	if (body instanceof Response) return body;

	const read = readAgreementLinkInput(body);

	if (!read.ok)
		return agreementJson(
			{ ok: false, error: "Complete the security check." },
			400,
		);
	const env = locals.runtime.env;

	if (
		!isCanonicalRequest({
			configuredOrigin: env.SITE_ORIGIN,
			requestUrl: request.url,
			hostHeader: request.headers.get("host"),
		})
	)
		return agreementJson({ ok: false }, 404);

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (
		!bindings.ok ||
		!linkIsConfigured({
			database: env.MUSIC_DB,
			codeKey: env.AUDIO_CLIENT_CODE_KEY,
			resendKey: env.RESEND_API_KEY,
			sender: env.CONTACT_FROM_EMAIL,
			turnstileSecret: env.TURNSTILE_SECRET_KEY,
		})
	)
		return agreementJson({ ok: false, error: UNAVAILABLE }, 503);

	const receipt = () => agreementJson({ ok: true, message: ARCHIVE_RECEIPT });

	return runRoute(
		Context.merge(
			Context.merge(
				Context.merge(
					bindings.services,
					liveTurnstile(env.TURNSTILE_SECRET_KEY!),
				),
				liveAgreementAllowance(env.MUSIC_DB!, env.AUDIO_CLIENT_CODE_KEY!),
			),
			liveAgreementMail(env.RESEND_API_KEY!),
		),
		requestArchiveLink({
			email: read.value.email,
			turnstileToken: read.value.turnstileToken,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			from: env.CONTACT_FROM_EMAIL!,
			origin: siteOrigin(env.SITE_ORIGIN),
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
			newToken: newOfferToken,
		}).pipe(
			Effect.map(() =>
				request.headers
					.get("content-type")
					?.startsWith("application/x-www-form-urlencoded")
					? new Response(null, {
							status: 303,
							headers: {
								location: "/agreements?email=sent",
								"cache-control": "private, no-store",
							},
						})
					: receipt(),
			),
			Effect.catchTags({
				InvalidEmail: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 400)),
				TooManyLinks: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 429)),
				SecurityCheckFailed: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 403)),
				CooldownRunning: (refusal) =>
					Effect.succeed(agreementJson({ ok: false, error: refusal.say }, 429)),
			}),
		),
		// An unexpected failure (a database, allowance or mail call that threw) is the route's fixed sentence as a 500.
		{ route: ROUTE, answer: unavailable },
	);
};

export const POST = nativeAgreementRoute(post, () => "/agreements");
