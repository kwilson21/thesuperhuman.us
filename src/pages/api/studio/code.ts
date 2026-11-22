import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	newPendingNonce,
	newSigninCode,
	pendingSignInFromRequest,
} from "~/lib/audio-client-access";
import { clientPortalEnabled, normalizeClientEmail } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import {
	codeAddressInvalid,
	codeAllowanceSpent,
	codeCheckFailed,
	codeOnItsWay,
	codeRequestUnread,
	signinFailed,
	signinUnavailable,
	studioNotFound,
} from "~/lib/studio-signin";
import { loggedAnswer } from "~/server/answers";
import { requestCode } from "~/server/flows/signin-code";
import { runRoute } from "~/server/run";
import {
	bindingsOrUnavailable,
	liveBackground,
	liveTurnstile,
} from "~/server/services";
import { liveSigninKeys, liveSigninMail } from "~/server/signin-services";
import { readCodeRequest } from "~/server/signin-input";

// A code request issues a code bound to the browser that asked (the pending sign-in cookie, see audio-client-access.ts).
// A browser that sent its cookie gets the same value back whatever the outcome. Two requests from one browser at the same
// moment (two tabs) therefore both answer with that one value and each writes its code in place of the other's: both are
// emailed, only the code written last opens, and the cookie opens it whichever response arrives last. The earlier email's
// code does not work. That is accepted: the email allowance (3 per five minutes) bounds it. A browser that sent no cookie
// and sends two requests at once has no value to share, so its responses can overwrite each other and it asks again.
// The sequence is src/server/flows/signin-code.ts; the answers are src/lib/studio-signin.ts.
export const prerender = false;

const ROUTE = "/api/studio/code";

/** A store or hash failure: logged once, without what was sent, then 500 with the route's sentence. */
const failed = loggedAnswer(ROUTE, signinFailed);

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	if (!env || !clientPortalEnabled(env)) return studioNotFound();

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (
		!bindings.ok ||
		!env.TURNSTILE_SECRET_KEY ||
		!env.AUDIO_CLIENT_CODE_KEY ||
		!env.RESEND_API_KEY ||
		!env.CONTACT_FROM_EMAIL
	)
		return signinUnavailable();

	const body = await musicRequest(request, 4096);

	if (body instanceof Response) return body;

	const read = readCodeRequest(body);

	if (!read.ok) return codeRequestUnread();

	const address = normalizeClientEmail(read.value.email);

	if (!address) return codeAddressInvalid();

	const secure = new URL(request.url).protocol === "https:";

	return runRoute(
		Context.merge(
			Context.merge(
				Context.merge(
					bindings.services,
					liveTurnstile(env.TURNSTILE_SECRET_KEY),
				),
				Context.merge(
					liveSigninKeys(env.AUDIO_CLIENT_CODE_KEY),
					liveSigninMail(env.RESEND_API_KEY),
				),
			),
			liveBackground(locals.runtime.ctx),
		),
		requestCode({
			address,
			turnstileToken: read.value.turnstileToken,
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			pending: pendingSignInFromRequest(request),
			from: env.CONTACT_FROM_EMAIL,
			now: () => new Date(),
			newCode: newSigninCode,
			newNonce: newPendingNonce,
		}).pipe(
			// Every outcome of the issue is the same answer and the same cookie.
			Effect.map((answer) => codeOnItsWay(answer.pending, secure)),
			Effect.catchTags({
				AllowanceSpent: () => Effect.succeed(codeAllowanceSpent()),
				TurnstileFailed: () => Effect.succeed(codeCheckFailed()),
				// A code key under 32 characters, found at the first keyed hash before any statement: answered as a missing key.
				CodeKeyUnusable: () => Effect.succeed(signinUnavailable()),
				SigninHashFailed: (failure) => failed(failure.failure),
				SigninStoreFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's fixed sentence as a 500, logged once without what was sent.
		{ route: ROUTE, answer: signinFailed },
	);
};
