import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { studioSessionFromRequest } from "~/lib/audio-client-access";
import { clientPortalEnabled } from "~/lib/client-portal";
import { signedOut, signOutLocally, studioNotFound } from "~/lib/studio-signin";
import { loggedAnswer } from "~/server/answers";
import { signOut } from "~/server/flows/signin-sign-out";
import { runRoute } from "~/server/run";
import { bindingsOrUnavailable } from "~/server/services";
import { liveSigninKeys } from "~/server/signin-services";

// The sequence is src/server/flows/signin-sign-out.ts; the answers are src/lib/studio-signin.ts. Every answer clears the
// session cookie, so the page signs the browser out even when the session could not be revoked here.
export const prerender = false;

const ROUTE = "/api/studio/sign-out";

export const POST: APIRoute = async ({ request, locals }) => {
	const env = locals.runtime?.env;

	if (!env || !clientPortalEnabled(env)) return studioNotFound();

	const secure = new URL(request.url).protocol === "https:";
	const bindings = bindingsOrUnavailable(env, ["MUSIC_DB"]);

	if (!bindings.ok) return signOutLocally(503, secure);

	/** The revoking statement or the hash failed: logged once, without what was sent, then 500 with the cookie cleared. */
	const failed = loggedAnswer(ROUTE, () => signOutLocally(500, secure));

	return runRoute(
		// Sign-out asks only for the plain hash: it needs no code key.
		Context.merge(bindings.services, liveSigninKeys(undefined)),
		signOut({
			token: studioSessionFromRequest(request),
			now: () => new Date(),
		}).pipe(
			Effect.map(() => signedOut(secure)),
			Effect.catchTags({
				SigninHashFailed: (failure) => failed(failure.failure),
				StudioSigninStoreFailed: (failure) => failed(failure.failure),
			}),
		),
		// A defect is the route's own answer as a 500, logged once without what was sent.
		{ route: ROUTE, answer: () => signOutLocally(500, secure) },
	);
};
