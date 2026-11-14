// The outside calls of the publication sign-in: the OAuth library's grant store (a KV namespace behind
// env.OAUTH_PROVIDER) and GitHub's sign-in endpoints. Each is one service with named failures, so a flow can be run in a
// test with doubles and a route can answer each failure on its own terms. Nothing here carries a failure's own text.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/** The OAuth library says the authorization request itself is wrong (an unknown client, a redirect that is not registered, a missing parameter). */
export class AuthRequestRefused extends Data.TaggedError(
	"AuthRequestRefused",
) {}

/** The grant store failed, or the library did, for a reason that is not the request's: the site's own fault. */
export class OAuthStoreFailed extends Data.TaggedError("OAuthStoreFailed") {}

/** GitHub could not be reached, answered 5xx, or answered with something that is not JSON. */
export class GithubUnavailable extends Data.TaggedError("GithubUnavailable") {}

type Grants = Pick<
	OAuthHelpers,
	"parseAuthRequest" | "lookupClient" | "completeAuthorization"
>;

export type ParsedAuthRequest = Awaited<ReturnType<Grants["parseAuthRequest"]>>;

export type RegisteredClient = Awaited<ReturnType<Grants["lookupClient"]>>;

export type Authorization = Parameters<Grants["completeAuthorization"]>[0];

export class OAuthGrants extends Context.Service<
	OAuthGrants,
	{
		readonly parse: (
			request: Request,
		) => Effect.Effect<
			ParsedAuthRequest,
			AuthRequestRefused | OAuthStoreFailed
		>;
		readonly lookupClient: (
			clientId: string,
		) => Effect.Effect<RegisteredClient, OAuthStoreFailed>;
		readonly complete: (
			authorization: Authorization,
		) => Effect.Effect<
			{ readonly redirectTo: string },
			AuthRequestRefused | OAuthStoreFailed
		>;
	}
>()("site/OAuthGrants") {}

/** The library marks a refusal of the request itself with the error name "AuthorizationError"; every other failure is the site's. */
const failureOf = (refusedByLibrary: boolean) =>
	refusedByLibrary ? new AuthRequestRefused() : new OAuthStoreFailed();

/** The grants of the request's own OAuth library (`env.OAUTH_PROVIDER`). */
export const liveOAuthGrants = (helpers: Grants) =>
	Context.make(OAuthGrants, {
		parse: (request) =>
			Effect.tryPromise({
				try: () => helpers.parseAuthRequest(request),
				catch: (error) =>
					failureOf(
						error instanceof Error && error.name === "AuthorizationError",
					),
			}),
		lookupClient: (clientId) =>
			Effect.tryPromise({
				try: () => helpers.lookupClient(clientId),
				catch: () => new OAuthStoreFailed(),
			}),
		complete: (authorization) =>
			Effect.tryPromise({
				try: () => helpers.completeAuthorization(authorization),
				catch: (error) =>
					failureOf(
						error instanceof Error && error.name === "AuthorizationError",
					),
			}),
	});

/** GitHub's answer: whether its status was a success, and its JSON body as it came. */
export type GithubAnswer = {
	readonly ok: boolean;
	readonly body: unknown;
};

export class GithubSignIn extends Context.Service<
	GithubSignIn,
	{
		readonly exchange: (
			params: URLSearchParams,
		) => Effect.Effect<GithubAnswer, GithubUnavailable>;
		readonly user: (
			token: string,
		) => Effect.Effect<GithubAnswer, GithubUnavailable>;
	}
>()("site/GithubSignIn") {}

/** Calls GitHub. A call that cannot be made, a 5xx or 429 answer, and a success whose body is not JSON are all GitHub being unavailable; any other 4xx is a refusal. */
const github = (url: string, init: RequestInit) =>
	Effect.tryPromise({
		try: async (): Promise<GithubAnswer | null> => {
			const response = await fetch(url, init);

			// Unavailable: 5xx and 429 (rate limiting) are GitHub's state, not a refusal of our request.
			if (response.status >= 500 || response.status === 429) return null;
			const json = await response.json().then(
				(body): { readonly body: unknown } | null => ({ body }),
				() => null,
			);

			// A body that is not JSON is GitHub being unavailable on a success, and GitHub refusing the request on any other 4xx.
			if (json === null)
				return response.status < 400 ? null : { ok: false, body: null };

			return { ok: response.ok, body: json.body };
		},
		catch: () => new GithubUnavailable(),
	}).pipe(
		Effect.flatMap((answer) =>
			answer === null
				? Effect.fail(new GithubUnavailable())
				: Effect.succeed(answer),
		),
	);

/** GitHub's real sign-in endpoints, each call bounded to ten seconds. */
export const liveGithub = () =>
	Context.make(GithubSignIn, {
		exchange: (params) =>
			github("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: params,
				signal: AbortSignal.timeout(10000),
			}),
		user: (token) =>
			github("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "superhuman-publication",
				},
				signal: AbortSignal.timeout(10000),
			}),
	});
