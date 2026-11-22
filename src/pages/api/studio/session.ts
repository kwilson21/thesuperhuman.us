import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	newSessionToken,
	pendingSignInFromRequest,
} from "~/lib/audio-client-access";
import { clientPortalEnabled, normalizeClientEmail } from "~/lib/client-portal";
import { musicRequest } from "~/lib/music-request";
import {
	codeInvalidOrExpired,
	entryAllowanceSpent,
	entryUnread,
	signedIn,
	signinFailed,
	signinUnavailable,
	studioNotFound,
} from "~/lib/studio-signin";
import { loggedAnswer } from "~/server/answers";
import { signIn } from "~/server/flows/signin-session";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";
import { liveSigninKeys } from "~/server/signin-services";
import { readSessionRequest } from "~/server/signin-input";

// The sequence is src/server/flows/signin-session.ts; the answers are src/lib/studio-signin.ts.
export const prerender = false;

const ROUTE = "/api/studio/session";

/** A store or hash failure: logged once, without what was sent, then 500 with the route's sentence. */
const failed = loggedAnswer(ROUTE, signinFailed);

/** One answer for a wrong, expired, used or never-issued code, a lost race and a browser that did not ask for the code. */
const refused = () => Effect.succeed(codeInvalidOrExpired());

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	if (!env || !clientPortalEnabled(env)) return studioNotFound();

	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok || !env.AUDIO_CLIENT_CODE_KEY) return signinUnavailable();

	const body = await musicRequest(request, 4096);

	if (body instanceof Response) return body;

	const read = readSessionRequest(body);
	const address = read.ok ? normalizeClientEmail(read.value.email) : null;

	if (!read.ok || !address) return entryUnread();

	const secure = new URL(request.url).protocol === "https:";

	return runRoute(
		Context.merge(bindings.services, liveSigninKeys(env.AUDIO_CLIENT_CODE_KEY)),
		signIn({
			address,
			code: read.value.code,
			pending: pendingSignInFromRequest(request),
			ip: request.headers.get("cf-connecting-ip") ?? "0.0.0.0",
			now: () => new Date(),
			newToken: newSessionToken,
		}).pipe(
			Effect.map((token) => signedIn(token, secure)),
			Effect.catchTags({
				NoCodeToTry: refused,
				CodeNotAccepted: refused,
				AllowanceSpent: () => Effect.succeed(entryAllowanceSpent()),
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
