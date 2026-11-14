import type { APIRoute } from "astro";
import {
	publicationLogin,
	publicationBase,
	publicationOrigin,
	publicationResource,
	type LoginEnv,
} from "./oauth-login";
import { publicationMcp, type PublicationIdentity } from "./mcp";
import { isText } from "../type-guards";

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

/** Bound before any parser, including anonymous client registration. */
async function bounded(request: Request): Promise<Request | null> {
	if (!request.body) return request;
	const reader = request.body.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;
		size += value.byteLength;

		if (size > 32768) {
			await reader.cancel();

			return null;
		}

		parts.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;

	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}

	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: bytes,
	});
}

/**
 * A KV key may not be longer than 512 bytes, and the OAuth library builds keys from what a visitor sends (a client id, the
 * parts of an authorization code or a refresh token). No real value comes near this long, so a longer one is replaced with a
 * stub no credential equals, and the library refuses the request as it refuses any unknown client or invalid grant, with
 * its own answer, before it reaches KV.
 */
const LONGEST_CREDENTIAL_PART = 256;

const tooLong = (value: string) =>
	new TextEncoder().encode(value).length > LONGEST_CREDENTIAL_PART;

async function keySafe(request: Request): Promise<Request> {
	const url = new URL(request.url);
	const headers = new Headers(request.headers);
	const basic = headers.get("authorization");

	if (basic?.startsWith("Basic ") && basic.length > 1024)
		headers.set("authorization", "Basic x");

	if (request.method === "GET") {
		if (tooLong(url.searchParams.get("client_id") ?? ""))
			url.searchParams.set("client_id", "x");

		return new Request(url, { method: request.method, headers });
	}

	if (
		!(headers.get("content-type") ?? "").startsWith(
			"application/x-www-form-urlencoded",
		)
	)
		return new Request(request, { headers });

	const fields = new URLSearchParams(await request.text());

	for (const name of ["client_id", "code", "refresh_token"])
		if (tooLong(fields.get(name) ?? "")) fields.set(name, "x");

	headers.delete("content-length");

	return new Request(url, {
		method: request.method,
		headers,
		body: fields.toString(),
	});
}

function isIdentity(value: unknown): value is PublicationIdentity {
	return (
		typeof value === "object" &&
		value !== null &&
		"ownerId" in value &&
		isText(value.ownerId) &&
		"scopes" in value &&
		Array.isArray(value.scopes) &&
		value.scopes.every(isText)
	);
}

/**
 * True when every binding and secret the publication login needs is set. LoginEnv also lists
 * OAUTH_PROVIDER, which OAuthProvider.fetch adds to the env object before any handler reads it,
 * so it is not checked here.
 */
function isConfigured(env: Env): env is LoginEnv {
	return Boolean(
		env.OAUTH_KV &&
			env.PUBLICATION_DB &&
			env.PUBLICATION_OWNER_ID &&
			env.PUBLICATION_GITHUB_CLIENT_ID &&
			env.PUBLICATION_GITHUB_CLIENT_SECRET &&
			env.PUBLICATION_COOKIE_KEY,
	);
}

export const publicationOAuthRoute: APIRoute = async ({ request, locals }) => {
	const url = new URL(request.url);
	const headers = { "Cache-Control": "no-store" };

	if (url.origin !== publicationOrigin || !paths.has(url.pathname))
		return new Response("Not found", { status: 404, headers });
	const env = locals.runtime.env;

	if (!isConfigured(env)) {
		return new Response("Publication connection is not configured.", {
			status: 503,
			headers,
		});
	}

	try {
		const limited = await bounded(request);

		if (!limited)
			return new Response("Request too large", { status: 413, headers });

		// Dynamic import keeps Worker-only OAuth runtime out of unrelated website routes.
		const { OAuthProvider } = await import(
			"@cloudflare/workers-oauth-provider"
		);

		const scopes = (env.PUBLICATION_PROJECTS ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.map((p) => `publication:${p}`);

		const provider = new OAuthProvider<LoginEnv>({
			apiRoute: publicationResource,
			apiHandler: {
				async fetch(req, bindings, ctx) {
					const identity: unknown = "props" in ctx ? ctx.props : undefined;

					if (
						!isIdentity(identity) ||
						identity.ownerId !== bindings.PUBLICATION_OWNER_ID
					) {
						return new Response("Forbidden", { status: 403 });
					}

					return publicationMcp(req, bindings, identity);
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
					scopes: options.requestedScope.filter(
						(scope) => options.scope.includes(scope) && scopes.includes(scope),
					),
				},
			}),
		});

		const response = await provider.fetch(
			await keySafe(limited),
			env,
			locals.runtime.ctx,
		);

		const wrapped = new Response(response.body, response);
		wrapped.headers.set("Cache-Control", "no-store");

		return wrapped;
	} catch {
		return new Response("Publication connection unavailable.", {
			status: 500,
			headers,
		});
	}
};
