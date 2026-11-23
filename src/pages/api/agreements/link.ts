import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { agreementJson } from "~/lib/agreement-access";
import { canonicalAgreementRequest } from "~/lib/agreement-host";
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
import { loggedAnswer } from "~/server/answers";
import { requestArchiveLink } from "~/server/flows/agreement-link";
import {
	ARCHIVE_RECEIPT,
	linkSettings,
	UNAVAILABLE,
} from "~/server/rules/agreement-link";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, liveTurnstile } from "~/server/services";

export const prerender = false;

const ROUTE = "/api/agreements/link";

const unavailable = () => agreementJson({ ok: false, error: UNAVAILABLE }, 500);

const failed = loggedAnswer(ROUTE, unavailable);

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

	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);
	const configured = linkSettings(env);

	if (!bindings.ok || configured === null)
		return agreementJson({ ok: false, error: UNAVAILABLE }, 503);

	const receipt = () => agreementJson({ ok: true, message: ARCHIVE_RECEIPT });

	return runRoute(
		Context.merge(
			Context.merge(
				Context.merge(
					bindings.services,
					liveTurnstile(configured.turnstileSecret),
				),
				liveAgreementAllowance(configured.database, configured.codeKey),
			),
			liveAgreementMail(configured.resendKey),
		),
		requestArchiveLink({
			email: read.value.email,
			turnstileToken: read.value.turnstileToken,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			from: configured.sender,
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
				// A failed database, allowance, mail or hash call is the route's fixed sentence as a 500, logged without what was sent.
				AgreementStoreFailed: (failure) => failed(failure.failure),
				AgreementAllowanceFailed: (failure) => failed(failure.failure),
				// Never reached: `linkSettings` refuses a code key under 32 characters with this 503 before the program runs.
				CodeKeyUnusable: () =>
					Effect.succeed(agreementJson({ ok: false, error: UNAVAILABLE }, 503)),
				AgreementMailFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// An unexpected failure (a database, allowance or mail call that threw) is the route's fixed sentence as a 500.
		{ route: ROUTE, answer: unavailable },
	);
};

export const POST = nativeAgreementRoute(post, () => "/agreements");
