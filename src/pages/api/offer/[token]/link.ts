import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	agreementJson,
	signingLinkFailed,
	signingLinkUnavailable,
} from "~/lib/agreement-access";
import { canonicalAgreementRequest } from "~/lib/agreement-host";
import {
	agreementRequest,
	nativeAgreementRoute,
} from "~/lib/agreement-request";
import { newOfferToken } from "~/lib/software-offers";
import { siteOrigin } from "~/lib/site-origin.mjs";
import { readSigningLinkInput } from "~/server/agreement-input";
import {
	liveAgreementAllowance,
	liveAgreementMail,
} from "~/server/agreement-services";
import { loggedAnswer } from "~/server/answers";
import { requestSigningLink } from "~/server/flows/signing-link";
import { linkSettings } from "~/server/rules/agreement-link";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable, liveTurnstile } from "~/server/services";

export const prerender = false;

const failed = loggedAnswer(signingLinkFailed.route, signingLinkFailed.answer);

/** A refusal's own sentence, with its status. */
const said = (status: number) => (refusal: { readonly say: string }) =>
	Effect.succeed(agreementJson({ ok: false, error: refusal.say }, status));

function noRecipient(env: Env, request: Request) {
	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	if (linkSettings(env) === null) return signingLinkUnavailable();

	return agreementJson(
		{ ok: false, error: "Enter a valid email address." },
		400,
	);
}

const post: APIRoute = async ({ request, locals, params }) => {
	const body = await agreementRequest(request, 4096);

	if (body instanceof Response) return body;

	const read = readSigningLinkInput(body);

	if (!read.ok)
		return agreementJson(
			{ ok: false, error: "Complete the security check." },
			400,
		);
	const env = locals.runtime.env;
	const token = params.token;

	// A request with no token (an empty one counts as none) has no recipient to send to. It is answered as the archive
	// path answered it before that path was removed: the same checks come first, then the 400.
	if (!token) return noRecipient(env, request);

	if (!canonicalAgreementRequest(env, request))
		return agreementJson({ ok: false }, 404);

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	const {
		MUSIC_DB: database,
		AUDIO_CLIENT_CODE_KEY: codeKey,
		RESEND_API_KEY: resendKey,
		CONTACT_FROM_EMAIL: sender,
		TURNSTILE_SECRET_KEY: turnstileSecret,
	} = env;

	// A code key under 32 characters is not refused here: it fails where the first keyed hash fails it, once the setting,
	// the offer and its recipient are read (CodeKeyUnusable, the same 503).
	if (
		!bindings.ok ||
		!database ||
		!codeKey ||
		!resendKey ||
		!sender ||
		!turnstileSecret
	)
		return signingLinkUnavailable();

	const form = request.headers
		.get("content-type")
		?.startsWith("application/x-www-form-urlencoded");

	return runRoute(
		Context.merge(
			Context.merge(
				Context.merge(bindings.services, liveTurnstile(turnstileSecret)),
				liveAgreementAllowance(database, codeKey),
			),
			liveAgreementMail(resendKey),
		),
		requestSigningLink({
			token,
			request,
			turnstileToken: read.value.turnstileToken,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			from: sender,
			origin: siteOrigin(env.SITE_ORIGIN),
			now: () => new Date(),
			newId: () => crypto.randomUUID(),
			newToken: newOfferToken,
		}).pipe(
			Effect.map(({ receiptAddress }) =>
				form
					? new Response(null, {
							status: 303,
							headers: {
								location: `/offer/${token}/sign?email=sent`,
								"cache-control": "private, no-store",
							},
						})
					: agreementJson({
							ok: true,
							message: `I sent a link to ${receiptAddress}. Tap it on any device to open your agreement.`,
						}),
			),
			Effect.catchTags({
				SigningOff: said(404),
				OfferUnavailable: said(404),
				// A project exists for the offer: answered as an offer that is unavailable (Q1), its sentence that one.
				SigningStarted: said(404),
				InvalidEmail: said(400),
				TooManyLinks: said(429),
				SecurityCheckFailed: said(403),
				CooldownRunning: said(429),
				MailRefused: said(502),
				CodeKeyUnusable: () => Effect.succeed(signingLinkUnavailable()),
				// A failed database, allowance, mail or hash call is the route's fixed sentence as a 500, logged once without
				// what was sent (the archive link's answer).
				AgreementStoreFailed: (failure) => failed(failure.failure),
				AgreementAllowanceFailed: (failure) => failed(failure.failure),
				AgreementMailFailed: (failure) => failed(failure.failure),
				HashFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect (terms that are not JSON, read for the mail's outcome; a bug) is the same fixed 500, logged once.
		signingLinkFailed,
	);
};

export const POST = nativeAgreementRoute(
	post,
	(context) => `/offer/${context.params.token}/sign`,
);
