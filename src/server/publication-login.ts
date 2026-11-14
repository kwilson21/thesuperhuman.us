// The publication sign-in handler the OAuth library calls for every request that is not its own (the consent page, the
// consent form's post, GitHub's callback). It routes by method and path, runs the sign-in flow for the step and answers: a
// refusal of the visitor's request is 400 with the sign-in sentence and the login cookie cleared; the site's own faults
// are 500 (the grant store, the cookie key) or 503 (GitHub unavailable) with one fixed sentence and never a failure's text.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
	publicationBase,
	cookieName,
	type LoginEnv,
} from "../lib/publication/oauth-login";
import {
	approveConsent,
	finishSignIn,
	showConsent,
	type LoginWorld,
} from "./flows/publication-login";
import { encode } from "./publication-cookie";
import { liveGithub, liveOAuthGrants } from "./publication-services";
import { LoginRefused } from "./rules/publication-login";
import { runRoute } from "./run";

const cookie = (value: string, age = 600) =>
	`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

const cleared = { "Cache-Control": "no-store", "Set-Cookie": cookie("", 0) };

const refused = () =>
	new Response(new LoginRefused().say, { status: 400, headers: cleared });

const unavailable = (status: 500 | 503) =>
	new Response("Publication connection unavailable.", {
		status,
		headers: cleared,
	});

function redirect(url: string, token: string, age = 600) {
	return new Response(null, {
		status: 302,
		headers: {
			Location: url,
			"Set-Cookie": cookie(token, age),
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
}

const world: LoginWorld = {
	now: () => Date.now(),
	random: () => encode(crypto.getRandomValues(new Uint8Array(32))),
};

export async function publicationLogin(
	request: Request,
	env: LoginEnv,
): Promise<Response> {
	const url = new URL(request.url);

	const services = Context.merge(
		liveOAuthGrants(env.OAUTH_PROVIDER),
		liveGithub(),
	);

	const route = {
		route: "/api/publication",
		answer: () => unavailable(500),
	};

	if (
		url.pathname === publicationBase + "/authorize" &&
		request.method === "GET"
	)
		return runRoute(
			services,
			showConsent(request, env, world).pipe(
				Effect.map(
					(page) =>
						new Response(page.html, {
							headers: {
								"Content-Type": "text/html; charset=utf-8",
								"Cache-Control": "no-store",
								// Preserve Origin on the same-site consent POST; omit cross-site referrers.
								"Set-Cookie": cookie(page.cookie),
								"Referrer-Policy": "same-origin",
								// Browsers also enforce form-action on the POST's redirect destination.
								"Content-Security-Policy": page.policy,
							},
						}),
				),
				Effect.catchTags({
					AuthRequestRefused: () => Effect.succeed(refused()),
					LoginRefused: () => Effect.succeed(refused()),
					OAuthStoreFailed: () => Effect.succeed(unavailable(500)),
					CookieKeyInvalid: () => Effect.succeed(unavailable(500)),
				}),
			),
			route,
		);

	if (
		url.pathname === publicationBase + "/authorize" &&
		request.method === "POST"
	)
		return runRoute(
			services,
			approveConsent(request, env, world).pipe(
				Effect.map((next) => redirect(next.location, next.cookie)),
				Effect.catchTags({
					LoginRefused: () => Effect.succeed(refused()),
					BodyUnreadable: () => Effect.succeed(refused()),
					CookieKeyInvalid: () => Effect.succeed(unavailable(500)),
				}),
			),
			route,
		);

	if (
		url.pathname === publicationBase + "/callback" &&
		request.method === "GET"
	)
		return runRoute(
			services,
			finishSignIn(request, env, world).pipe(
				Effect.map((redirectTo) => redirect(redirectTo, "", 0)),
				Effect.catchTags({
					LoginRefused: () => Effect.succeed(refused()),
					AuthRequestRefused: () => Effect.succeed(refused()),
					OAuthStoreFailed: () => Effect.succeed(unavailable(500)),
					CookieKeyInvalid: () => Effect.succeed(unavailable(500)),
					GithubUnavailable: () => Effect.succeed(unavailable(503)),
				}),
			),
			route,
		);

	return new Response("Not found", { status: 404 });
}
