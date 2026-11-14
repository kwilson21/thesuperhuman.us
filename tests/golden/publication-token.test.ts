import { ALL } from "~/pages/api/publication/[...path]";
import {
	fromJson,
	REDIRECT,
	RESOURCE,
	SCOPES,
	toolCall,
	VERIFIER,
	oauthKit,
} from "./areas/publication";
import { defineCorpus, type Case } from "./harness";

// The golden corpus for the token endpoint of /api/publication/[...path]: the authorization code exchanged for tokens
// (each rule the library enforces: verifier, redirect, resource, client, grant type, replay) and the refresh token
// (rotation, narrowing and widening the scope, replay, expiry, an allowlist that shrinks between requests). Every case
// first connects a client through the whole login (see publication-oauth.test.ts), using a Flow (tests/golden/areas/publication.ts).
//
// Branches: token 200 with access and refresh tokens, 400 invalid_grant / invalid_request / unsupported_grant_type /
// invalid_scope, 401 invalid_client, 405 for a GET. The MCP calls made with the issued tokens are in
// publication-mcp.test.ts; the few here only show what a token may read.
//
// The ten minute life of an authorization code is covered: the code is exchanged just inside it and just after it (the
// harness KV drops a key put with expirationTtl once the frozen clock passes it).

const { run, oc, connect, withKv } = oauthKit(ALL);

// ---------------------------------------------------------------- token and refresh

const JSON_HEADERS = { "content-type": "application/json" };
const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

/** A form body that may repeat or empty a field, as URLSearchParams writes it. */
const pairs = (fields: [string, string][]) =>
	new URLSearchParams(fields).toString();

/** A client assertion for `issuer`: a JWT the library can read the issuer from, with a signature it never reaches. */
const assertion = (issuer: string) => {
	const part = (value: { [name: string]: string }) =>
		btoa(JSON.stringify(value)).replaceAll("=", "");

	return [
		part({ alg: "RS256", typ: "JWT" }),
		part({ iss: issuer, sub: issuer }),
		"c2ln",
	].join(".");
};

const REFRESH_TTL = 2_592_001_000;
const CODE_LIFETIME = 600_000;

const tokenCases: Case[] = [
	oc(
		"token: the code is exchanged with another registered client's id",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			f.step({
				method: "POST",
				path: "/api/publication/register",
				headers: JSON_HEADERS,
				body: JSON.stringify({
					client_name: "second",
					redirect_uris: [REDIRECT],
					token_endpoint_auth_method: "none",
				}),
				capture: { clientB: fromJson("client_id") },
			}),
			c.token({ client_id: "~clientB~" }),
		]),
	),
	oc(
		"token: the code is exchanged just inside its ten minute life",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({}, { advanceMs: CODE_LIFETIME - 1_000 }),
		]),
	),
	oc(
		"token: the code is exchanged after its ten minute life",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({}, { advanceMs: CODE_LIFETIME + 1_000 }),
		]),
	),
	oc(
		"token: the grant type in upper case",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ grant_type: "AUTHORIZATION_CODE" }),
		]),
	),
	oc(
		"token: a scope parameter on the exchange",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ scope: "publication:threadline" }),
		]),
	),
	oc(
		"token: a code with a trailing space",
		run((f, c) => [...connect(f, c).slice(0, 4), c.token({ code: "~code~ " })]),
	),
	oc(
		"token: two connections in a row give two sets of tokens",
		run((f, c) => [
			...connect(f, c),
			...connect(f, c),
			toolCall(f, "get_project_progress", { projectId: "threadline" }),
		]),
	),
	oc(
		"token: the code is exchanged for tokens",
		run((f, c) => connect(f, c)),
	),
	oc(
		"token: a wrong code verifier",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ code_verifier: "w".repeat(43) }),
		]),
	),
	oc(
		"token: a code verifier that is too short",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ code_verifier: "short" }),
		]),
	),
	oc(
		"token: no code verifier",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ code_verifier: null }),
		]),
	),
	oc(
		"token: the code is used twice",
		run((f, c) => [...connect(f, c), c.token()]),
	),
	oc(
		"token: a redirect_uri that differs",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ redirect_uri: "https://evil.test/cb" }),
		]),
	),
	oc(
		"token: no redirect_uri",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ redirect_uri: null }),
		]),
	),
	oc(
		"token: no resource",
		run((f, c) => [...connect(f, c).slice(0, 4), c.token({ resource: null })]),
	),
	oc(
		"token: the wrong resource",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ resource: "https://thesuperhuman.us/api/other" }),
		]),
	),
	oc(
		"token: another client id",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ client_id: "other-client" }),
		]),
	),
	oc(
		"token: no client id",
		run((f, c) => [...connect(f, c).slice(0, 4), c.token({ client_id: null })]),
	),
	oc(
		"token: no code",
		run((f, c) => [...connect(f, c).slice(0, 4), c.token({ code: null })]),
	),
	oc(
		"token: a made-up code",
		run((f, c) => [...connect(f, c).slice(0, 4), c.token({ code: "1:2:3" })]),
	),
	oc(
		"token: a code too long to be a key",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ code: "c".repeat(600) + ":2:3" }),
		]),
	),
	oc(
		"token: a client id too long to be a key",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ client_id: "c".repeat(600) }),
		]),
	),
	oc(
		"token: a client id too long to be a key, with an empty one before it",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["grant_type", "authorization_code"],
						["code", "~code~"],
						["client_id", ""],
						["client_id", "c".repeat(600)],
					]),
				},
			),
		]),
	),
	oc(
		"token: an empty client id before the real one",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["grant_type", "authorization_code"],
						["code", "~code~"],
						["code_verifier", VERIFIER],
						["redirect_uri", REDIRECT],
						["resource", RESOURCE],
						["client_id", ""],
						["client_id", "~client~"],
					]),
				},
			),
		]),
	),
	oc(
		"token: the code sent twice",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["grant_type", "authorization_code"],
						["code", "~code~"],
						["code", "other"],
						["client_id", "~client~"],
					]),
				},
			),
		]),
	),
	...[
		["just under the old limit on a header", "Basic ", 700],
		["well over the old limit on a header", "Basic ", 2000],
		["a lower case scheme", "basic ", 700],
		["a tab after the scheme", "Basic\t", 2000],
	].map(([how, scheme, size]) =>
		oc(
			`token: a client id too long to be a key in a Basic header, ${how}`,
			run((f, c) => [
				...connect(f, c).slice(0, 4),
				c.token(
					{},
					{
						headers: {
							...FORM_HEADERS,
							authorization: `${scheme}${btoa(`${"a".repeat(Number(size))}:secret`)}`,
						},
						body: pairs([
							["grant_type", "authorization_code"],
							["code", "~code~"],
						]),
					},
				),
			]),
		),
	),
	oc(
		"token: a client assertion whose issuer is too long to be a key",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["grant_type", "authorization_code"],
						["code", "~code~"],
						[
							"client_assertion_type",
							"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
						],
						["client_assertion", assertion("i".repeat(600))],
					]),
				},
			),
		]),
	),
	oc(
		"token: a revocation of a token too long to be a key",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["token", "t".repeat(600) + ":2:3"],
						["client_id", "~client~"],
					]),
					capture: {},
				},
			),
		]),
	),
	oc(
		"token: a revocation of a made-up token",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token(
				{},
				{
					body: pairs([
						["token", "1:2:3"],
						["client_id", "~client~"],
					]),
					capture: {},
				},
			),
		]),
	),
	oc(
		"token: no grant type",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ grant_type: null }),
		]),
	),
	oc(
		"token: the password grant",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ grant_type: "password" }),
		]),
	),
	oc(
		"token: the client credentials grant",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({ grant_type: "client_credentials" }),
		]),
	),
	oc(
		"token: a JSON body instead of a form",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			f.step({
				method: "POST",
				path: "/api/publication/token",
				headers: JSON_HEADERS,
				body: JSON.stringify({
					grant_type: "authorization_code",
					client_id: "~client~",
					code: "~code~",
					code_verifier: VERIFIER,
					redirect_uri: REDIRECT,
				}),
			}),
		]),
	),
	oc(
		"token: a GET",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			f.step({ path: "/api/publication/token" }),
		]),
	),
	oc(
		"token: the allowlist shrinks before the exchange",
		run((f, c) => [
			...connect(f, c).slice(0, 4),
			c.token({}, { env: { PUBLICATION_PROJECTS: "threadline" } }),
			toolCall(f, "get_project_progress", { projectId: "other" }),
		]),
	),
	oc(
		"token: a client authenticated by secret",
		run((_f, c) => [
			c.register({ token_endpoint_auth_method: "client_secret_post" }),
			c.authorize(),
			c.consent(),
			c.callback(),
			c.token({ client_secret: "wrong" }),
		]),
	),
	oc(
		"refresh: the refresh token is exchanged",
		run((f, c) => [
			...connect(f, c),
			c.refresh(),
			toolCall(
				f,
				"get_project_progress",
				{ projectId: "threadline" },
				{ token: "~access2~" },
			),
		]),
	),
	oc(
		"refresh: the old access token after a refresh",
		run((f, c) => [
			...connect(f, c),
			c.refresh(),
			toolCall(f, "get_project_progress", { projectId: "threadline" }),
		]),
	),
	oc(
		"refresh: narrowing to one project narrows what the token may read",
		run((f, c) => [
			...connect(f, c),
			c.refresh({ scope: "publication:threadline" }),
			toolCall(
				f,
				"get_project_progress",
				{ projectId: "threadline" },
				{ token: "~access2~" },
			),
			toolCall(
				f,
				"get_project_progress",
				{ projectId: "other" },
				{ token: "~access2~" },
			),
		]),
	),
	oc(
		"refresh: asking for more than was granted",
		run((f, c) => [
			...connect(f, c, "publication:threadline"),
			c.refresh({ scope: SCOPES }),
		]),
	),
	oc(
		"refresh: a scope that is not a project",
		run((f, c) => [
			...connect(f, c),
			c.refresh({ scope: "publication:stranger" }),
		]),
	),
	oc(
		"refresh: an empty scope",
		run((f, c) => [...connect(f, c), c.refresh({ scope: "" })]),
	),
	oc(
		"refresh: the old refresh token used again",
		run((f, c) => [...connect(f, c), c.refresh(), c.refresh()]),
	),
	oc(
		"refresh: the new refresh token used twice",
		run((f, c) => [
			...connect(f, c),
			c.refresh(),
			c.refresh({ refresh_token: "~refresh2~" }),
			c.refresh({ refresh_token: "~refresh2~" }),
		]),
	),
	oc(
		"refresh: no refresh token",
		run((f, c) => [...connect(f, c), c.refresh({ refresh_token: null })]),
	),
	oc(
		"refresh: a made-up refresh token",
		run((f, c) => [...connect(f, c), c.refresh({ refresh_token: "1:2:3" })]),
	),
	oc(
		"refresh: a refresh token too long to be a key",
		run((f, c) => [
			...connect(f, c),
			c.refresh({ refresh_token: "r".repeat(600) + ":2:3" }),
		]),
	),
	oc(
		"refresh: another client",
		run((f, c) => [...connect(f, c), c.refresh({ client_id: "other-client" })]),
	),
	oc(
		"refresh: after thirty days",
		run((f, c) => [
			...connect(f, c),
			c.refresh({}, { advanceMs: REFRESH_TTL }),
		]),
	),
	oc(
		"refresh: the allowlist shrinks before the refresh",
		run((f, c) => [
			...connect(f, c),
			c.refresh({}, { env: { PUBLICATION_PROJECTS: "threadline" } }),
			toolCall(
				f,
				"get_project_progress",
				{ projectId: "other" },
				{ token: "~access2~" },
			),
		]),
	),
	oc(
		"refresh: the allowlist is emptied before the refresh",
		run((f, c) => [
			...connect(f, c),
			c.refresh({}, { env: { PUBLICATION_PROJECTS: "" } }),
			toolCall(
				f,
				"get_project_progress",
				{ projectId: "threadline" },
				{ token: "~access2~" },
			),
		]),
	),
	oc(
		"refresh: the resource is left out",
		run((f, c) => [...connect(f, c), c.refresh({ resource: null })]),
	),
];

const cases: Case[] = [...withKv(tokenCases)];

defineCorpus("publication-token", ALL, cases);
