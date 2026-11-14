import type { APIRoute } from "astro";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
	publicationBase,
	publicationOrigin,
	publicationResource,
	type LoginEnv,
} from "../lib/publication/oauth-login";
import { publicationMcp } from "../lib/publication/mcp";
import { BodyUnreadable, readBounded } from "./bounded-body";
import { keyBoundedKv } from "./publication-kv";
import { publicationTools } from "./publication-mcp";
import { publicationLogin } from "./publication-login";
import { bindingsOrUnavailable } from "./services";
import {
	listedProjects,
	narrowScopes,
	scopeFor,
	signedInOwner,
} from "./rules/publication-access";
import { runRoute } from "./run";

const paths = new Set([
	publicationBase + "/mcp",
	publicationBase + "/authorize",
	publicationBase + "/callback",
	publicationBase + "/token",
	publicationBase + "/register",
	"/.well-known/oauth-authorization-server",
	"/.well-known/oauth-protected-resource",
	"/.well-known/oauth-protected-resource" + publicationBase + "/mcp",
]);

const LARGEST_REQUEST = 32768;

const nonEmpty = Schema.String.check(
	Schema.makeFilter((s: string) => s.length > 0),
);

/** The connection the OAuth library attaches to a verified token: the owner's id and the scopes granted. */
const readIdentity = Schema.decodeUnknownResult(
	Schema.Struct({
		ownerId: nonEmpty,
		scopes: Schema.Array(nonEmpty),
	}),
);

/**
 * True when every binding and secret the publication login needs is set. LoginEnv also lists
 * OAUTH_PROVIDER, which OAuthProvider.fetch adds to the env object before any handler reads it,
 * so it is not checked here.
 */
function isConfigured(env: Env): env is LoginEnv & { OAUTH_KV: KVNamespace } {
	return Boolean(
		env.OAUTH_KV &&
			env.PUBLICATION_DB &&
			env.PUBLICATION_OWNER_ID &&
			env.PUBLICATION_GITHUB_CLIENT_ID &&
			env.PUBLICATION_GITHUB_CLIENT_SECRET &&
			env.PUBLICATION_COOKIE_KEY,
	);
}

const headers = { "Cache-Control": "no-store" };

/** The route's one answer for the site's own faults: the same sentence whatever failed, never a failure's text. */
const unavailable = () =>
	new Response("Publication connection unavailable.", {
		status: 500,
		headers,
	});

/** The provider's work: build it, hand it the request, and answer what it answers. */
const provide = (
	request: Request,
	env: LoginEnv & { OAUTH_KV: KVNamespace },
	ctx: ExecutionContext,
) =>
	Effect.tryPromise({
		try: async () => {
			// Dynamic import keeps Worker-only OAuth runtime out of unrelated website routes.
			const { OAuthProvider } = await import(
				"@cloudflare/workers-oauth-provider"
			);

			const scopes = listedProjects(env.PUBLICATION_PROJECTS).map(scopeFor);

			const provider = new OAuthProvider<LoginEnv>({
				apiRoute: publicationResource,
				apiHandler: {
					async fetch(req, bindings, apiContext) {
						const identity = readIdentity(
							"props" in apiContext ? apiContext.props : undefined,
						);

						if (
							!Result.isSuccess(identity) ||
							!signedInOwner(identity.success, bindings.PUBLICATION_OWNER_ID)
						)
							return new Response("Forbidden", { status: 403 });

						const services = bindingsOrUnavailable(bindings, [
							"PUBLICATION_DB",
						]);

						if (!services.ok)
							return new Response("Publication unavailable", { status: 503 });

						const setting = {
							ownerId: bindings.PUBLICATION_OWNER_ID,
							allowlist: bindings.PUBLICATION_PROJECTS,
							connection: identity.success,
						};

						// A tool answers in the MCP protocol's shape whatever happens inside (see publication-mcp.ts).
						return publicationMcp(
							req,
							identity.success,
							publicationTools(setting, services.services),
						);
					},
				},
				defaultHandler: { fetch: publicationLogin },
				authorizeEndpoint: publicationBase + "/authorize",
				tokenEndpoint: publicationBase + "/token",
				clientRegistrationEndpoint: publicationBase + "/register",
				scopesSupported: scopes,
				accessTokenTTL: 3600,
				refreshTokenTTL: 2592000,
				clientIdMetadataDocumentEnabled: false,
				resourceMetadata: {
					resource: publicationResource,
					authorization_servers: [publicationOrigin],
					scopes_supported: scopes,
				},
				// Refresh scope narrowing must also narrow the props consumed by MCP handlers.
				tokenExchangeCallback: (options) => ({
					accessTokenProps: {
						ownerId: options.userId,
						scopes: Effect.runSync(
							narrowScopes.decide(
								{
									requested: options.requestedScope,
									granted: options.scope,
									supported: scopes,
								},
								{},
							),
						),
					},
				}),
			});

			// The library keeps its state in KV; give it a namespace that answers "not found" for a key KV would refuse.
			const response = await provider.fetch(
				request,
				{ ...env, OAUTH_KV: keyBoundedKv(env.OAUTH_KV) },
				ctx,
			);

			const wrapped = new Response(response.body, response);
			wrapped.headers.set("Cache-Control", "no-store");

			return wrapped;
		},
		catch: () => new OAuthProviderFailed(),
	});

/** The OAuth library, or what it stands on (its KV namespace), failed. */
class OAuthProviderFailed extends Data.TaggedError("OAuthProviderFailed") {}

export const publicationOAuthRoute: APIRoute = async ({ request, locals }) => {
	const url = new URL(request.url);

	if (url.origin !== publicationOrigin || !paths.has(url.pathname))
		return new Response("Not found", { status: 404, headers });
	const env = locals.runtime.env;

	if (!isConfigured(env)) {
		return new Response("Publication connection is not configured.", {
			status: 503,
			headers,
		});
	}

	return runRoute(
		Context.empty(),
		Effect.gen(function* () {
			// Bound before any parser, including anonymous client registration.
			const bytes = request.body
				? yield* readBounded(request.body, LARGEST_REQUEST)
				: null;

			const limited =
				bytes === null
					? request
					: new Request(request.url, {
							method: request.method,
							headers: request.headers,
							body: bytes,
						});

			return yield* provide(limited, env, locals.runtime.ctx);
		}).pipe(
			Effect.catchTags({
				BodyTooLarge: () =>
					Effect.succeed(
						new Response("Request too large", { status: 413, headers }),
					),
				BodyUnreadable: () => Effect.succeed(unavailable()),
				OAuthProviderFailed: () => Effect.succeed(unavailable()),
			}),
		),
		{ route: "/api/publication", answer: unavailable },
	);
};
