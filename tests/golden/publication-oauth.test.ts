import { ALL } from "~/pages/api/publication/[...path]";
import {
	CHALLENGE,
	connection,
	Flow,
	form,
	github,
	REDIRECT,
	RESOURCE,
	SCOPES,
	seededClient,
	SEEDED_CLIENT,
	via,
	withChunks,
	oauthKit,
} from "./areas/publication";
import {
	defineCorpus,
	json,
	networkDown,
	text,
	type Case,
	type Step,
} from "./harness";

// The golden corpus for the login half of /api/publication/[...path] (src/lib/publication/oauth.ts and oauth-login.ts):
// routing and configuration, the size limit, client registration, the authorize page, consent and the GitHub callback.
// The OAuth library (@cloudflare/workers-oauth-provider) keeps its state in OAUTH_KV; the harness seeds
// crypto.getRandomValues, fixes the one key WebCrypto draws on its own and freezes the clock, so every
// id, code, token and sealed cookie is deterministic and recorded with its real value. A later request needs a value an
// earlier answer made, so those cases use a Flow (tests/golden/areas/publication.ts): ~name~ in a request marks a
// captured value, and the request is recorded as written. The token and refresh cases are in publication-token.test.ts
// and the MCP cases in publication-mcp.test.ts.
//
// Response branches, and the cases that reach them (names start with the group):
//
//   routing (publicationOAuthRoute)
//   404 "Not found"                      route: wrong origin, unknown path, trailing slash, other case, bare base
//   503 "...is not configured."          config: each of OAUTH_KV, PUBLICATION_DB, PUBLICATION_OWNER_ID,
//                                        PUBLICATION_GITHUB_CLIENT_ID, PUBLICATION_GITHUB_CLIENT_SECRET,
//                                        PUBLICATION_COOKIE_KEY missing, and each of the four texts empty
//   413 "Request too large"              size: one body, a stream with no length, exactly at the limit
//   503 "...unavailable."                register: OAuth KV failing on put
//   library answers                      route (discovery), register (201 and each refusal)
//   publicationLogin
//   authorize GET 200 HTML + cookie      authorize: page, markup in the client name, scope subsets, a missing resource
//   authorize GET 400 fail()             authorize: each rule (response type, challenge, scope, resource, client, cookie size,
//                                        cookie key errors, KV failure)
//   authorize POST 302 to GitHub         consent: happy, replay, expiry boundary
//   authorize POST 400 fail()            consent: origin, cookie missing, tampered, truncated, wrong nonce, approved twice, key rotation
//   callback 302 to the client           callback: happy, replay
//   callback 400 fail()                  callback: cookie, state, code, GitHub token and user answers (refused, error, wrong
//                                        user, network down, malformed), expiry, KV failure
//   404 "Not found" (login handler)      login: an authorize/callback path with the wrong method
//
// Not reachable through the harness: the expiry of a KV key (the harness records expirationTtl and does not expire
// keys, so an authorization code that outlives its ten minutes still works), and a cookie that decrypts to invalid UTF-8.

const { run, oc, withKv } = oauthKit(ALL);

// ---------------------------------------------------------------- routing and configuration

const wellKnown = (path: string): Step => ({ method: "GET", path });

const routing: Case[] = [
	oc("route: authorization server metadata", [
		wellKnown("/.well-known/oauth-authorization-server"),
	]),
	oc("route: protected resource metadata", [
		wellKnown("/.well-known/oauth-protected-resource"),
	]),
	oc("route: protected resource metadata for the MCP path", [
		wellKnown("/.well-known/oauth-protected-resource/api/publication/mcp"),
	]),
	oc(
		"route: metadata with the allowlist unset lists no scopes",
		[wellKnown("/.well-known/oauth-authorization-server")],
		{ omit: ["PUBLICATION_PROJECTS"] },
	),
	oc(
		"route: metadata with spaces and empty items in the allowlist",
		[wellKnown("/.well-known/oauth-authorization-server")],
		{ env: { PUBLICATION_PROJECTS: " other , ,threadline ," } },
	),
	oc("route: an unknown path", [wellKnown("/api/publication/unknown")]),
	oc("route: the bare base path", [wellKnown("/api/publication")]),
	oc("route: a trailing slash on the MCP path", [
		wellKnown("/api/publication/mcp/"),
	]),
	oc("route: the MCP path in upper case", [wellKnown("/api/publication/MCP")]),
	oc("route: another well-known document", [
		wellKnown("/.well-known/openid-configuration"),
	]),
	oc("route: a wrong well-known suffix", [
		wellKnown("/.well-known/oauth-protected-resource/api/publication/other"),
	]),
	oc(
		"route: another origin is not found, whatever the path",
		run((f) => [
			f.step({
				method: "POST",
				path: "/api/publication/mcp",
				origin: "https://example.test",
				body: "{}",
			}),
		]),
	),
	oc(
		"route: the www host is another origin",
		run((f) => [
			f.step({
				path: "/.well-known/oauth-authorization-server",
				origin: "https://www.thesuperhuman.us",
			}),
		]),
	),
	oc(
		"route: an unknown path is answered before configuration is checked",
		[wellKnown("/api/publication/unknown")],
		{ omit: ["PUBLICATION_COOKIE_KEY"] },
	),
];

const settings = [
	"PUBLICATION_OWNER_ID",
	"PUBLICATION_GITHUB_CLIENT_ID",
	"PUBLICATION_GITHUB_CLIENT_SECRET",
	"PUBLICATION_COOKIE_KEY",
] as const;

const configuration: Case[] = [
	oc(
		"config: OAUTH_KV is not bound",
		[wellKnown("/.well-known/oauth-authorization-server")],
		{ kv: { OAUTH_KV: { missing: true } } },
	),
	oc(
		"config: PUBLICATION_DB is not bound",
		[wellKnown("/.well-known/oauth-authorization-server")],
		{ publication: { missing: true } },
	),
	...settings.map((name) =>
		oc(
			`config: ${name} is not set`,
			[wellKnown("/.well-known/oauth-authorization-server")],
			{ omit: [name] },
		),
	),
	...settings.map((name) =>
		oc(
			`config: ${name} is empty`,
			[wellKnown("/.well-known/oauth-authorization-server")],
			{ env: { [name]: "" } },
		),
	),
	oc(
		"config: an unconfigured deployment refuses the MCP path and the authorize path too",
		[
			{ method: "POST", path: "/api/publication/mcp", body: "{}" },
			{ method: "GET", path: "/api/publication/authorize" },
		],
		{ omit: ["PUBLICATION_OWNER_ID"] },
	),
	oc(
		"config: PUBLICATION_PROJECTS unset leaves no scopes to grant",
		run((_f, c) => [c.register(), c.authorize()]),
		{ omit: ["PUBLICATION_PROJECTS"] },
	),
];

// ---------------------------------------------------------------- size limit

const chunk = (n: number) => new Uint8Array(n).fill(0x20);

const size: Case[] = [
	oc("size: a 32769-byte registration body is too large", [
		{
			method: "POST",
			path: "/api/publication/register",
			headers: { "content-type": "application/json" },
			body: "x".repeat(32769),
		},
	]),
	oc("size: a 32768-byte registration body is read, then refused as JSON", [
		{
			method: "POST",
			path: "/api/publication/register",
			headers: { "content-type": "application/json" },
			body: "x".repeat(32768),
		},
	]),
	oc("size: a token request body over the limit", [
		{
			method: "POST",
			path: "/api/publication/token",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: `grant_type=authorization_code&code=${"a".repeat(33000)}`,
		},
	]),
	oc("size: an MCP body over the limit, before the bearer token is looked at", [
		{
			method: "POST",
			path: "/api/publication/mcp",
			body: "y".repeat(40000),
		},
	]),
	oc("size: a stream with no length over the limit", [
		{
			method: "POST",
			path: "/api/publication/register",
			body: "(four chunks of 9000 bytes)",
			handler: via(
				ALL,
				withChunks([chunk(9000), chunk(9000), chunk(9000), chunk(9000)]),
			),
		},
	]),
	oc("size: a stream of small chunks under the limit", [
		{
			method: "POST",
			path: "/api/publication/register",
			headers: { "content-type": "application/json" },
			body: "(three chunks of one JSON document)",
			handler: via(
				ALL,
				withChunks(
					[
						'{"client_name":"streamed","redirect_uris":["',
						`${REDIRECT}"],"token_endpoint_auth_method":`,
						'"none"}',
					].map((part) => new TextEncoder().encode(part)),
				),
			),
		},
	]),
	oc("size: a GET has no body to bound", [
		{ method: "GET", path: "/.well-known/oauth-authorization-server" },
	]),
];

// ---------------------------------------------------------------- registration

const registration: Case[] = [
	oc(
		"register: a client",
		run((_f, c) => [c.register()]),
	),
	oc(
		"register: two clients get different ids",
		run((_f, c) => [
			c.register({}, false),
			c.register({ client_name: "second" }),
		]),
	),
	oc("register: the body is not JSON", [
		{
			method: "POST",
			path: "/api/publication/register",
			headers: { "content-type": "application/json" },
			body: "{bad",
		},
	]),
	oc(
		"register: no redirect_uris",
		run((_f, c) => [c.register({ redirect_uris: null })]),
	),
	oc(
		"register: an empty redirect_uris list",
		run((_f, c) => [c.register({ redirect_uris: [] })]),
	),
	oc(
		"register: a javascript: redirect",
		run((_f, c) => [c.register({ redirect_uris: ["javascript:alert(1)"] })]),
	),
	oc(
		"register: a plain http redirect to a remote host",
		run((_f, c) => [c.register({ redirect_uris: ["http://evil.test/cb"] })]),
	),
	oc(
		"register: a localhost redirect",
		run((_f, c) => [
			c.register({ redirect_uris: ["http://localhost:8080/cb"] }),
		]),
	),
	oc(
		"register: several redirects",
		run((_f, c) => [
			c.register({
				redirect_uris: [REDIRECT, "https://claude.ai/api/mcp/auth_callback"],
			}),
		]),
	),
	oc(
		"register: a client secret method",
		run((_f, c) => [
			c.register({ token_endpoint_auth_method: "client_secret_post" }),
		]),
	),
	oc(
		"register: an unknown auth method",
		run((_f, c) => [c.register({ token_endpoint_auth_method: "magic" })]),
	),
	oc(
		"register: markup and quotes in the client name are stored as given",
		run((_f, c) => [
			c.register({ client_name: `<script>alert(1)</script> & "q" 'x'` }),
		]),
	),
	oc(
		"register: a very long client name",
		run((_f, c) => [c.register({ client_name: "n".repeat(2000) })]),
	),
	oc(
		"register: unicode client name",
		run((_f, c) => [c.register({ client_name: "café 中文 🚀" })]),
	),
	oc("register: a GET", [{ method: "GET", path: "/api/publication/register" }]),
	oc(
		"register: the KV write fails",
		run((_f, c) => [c.register({}, false)]),
		{ kv: { OAUTH_KV: { fails: ["put"] } } },
	),
	oc(
		"register: grant types given",
		run((_f, c) => [
			c.register({
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
			}),
		]),
	),
];

// ---------------------------------------------------------------- the authorize page

const authorizeCases: Case[] = [
	oc(
		"authorize: the consent page",
		run((_f, c) => [c.register(), c.authorize()]),
	),
	oc(
		"authorize: markup in the client name is escaped on the page",
		run((_f, c) => [
			c.register({ client_name: `<script>alert(1)</script> & "q" 'x'` }),
			c.authorize(),
		]),
	),
	oc(
		"authorize: a client with no name shows its id",
		run((_f, c) => [c.register({ client_name: null }), c.authorize()]),
	),
	oc(
		"authorize: one project scope",
		run((_f, c) => [
			c.register(),
			c.authorize({ scope: "publication:threadline" }),
		]),
	),
	oc(
		"authorize: the other project's scope",
		run((_f, c) => [c.register(), c.authorize({ scope: "publication:other" })]),
	),
	oc(
		"authorize: the page names the return address origin only",
		run((_f, c) => [
			c.register({
				redirect_uris: ["https://claude.ai/api/mcp/auth_callback?x=1"],
			}),
			c.authorize({
				redirect_uri: "https://claude.ai/api/mcp/auth_callback?x=1",
			}),
		]),
	),
	oc(
		"authorize: response_type token",
		run((_f, c) => [c.register(), c.authorize({ response_type: "token" })]),
	),
	oc(
		"authorize: no code_challenge",
		run((_f, c) => [c.register(), c.authorize({ code_challenge: null })]),
	),
	oc(
		"authorize: code_challenge_method plain",
		run((_f, c) => [
			c.register(),
			c.authorize({ code_challenge_method: "plain" }),
		]),
	),
	oc(
		"authorize: no code_challenge_method",
		run((_f, c) => [
			c.register(),
			c.authorize({ code_challenge_method: null }),
		]),
	),
	oc(
		"authorize: no scope",
		run((_f, c) => [c.register(), c.authorize({ scope: null })]),
	),
	oc(
		"authorize: a scope that is not a project",
		run((_f, c) => [
			c.register(),
			c.authorize({ scope: "publication:stranger" }),
		]),
	),
	oc(
		"authorize: one good scope and one stranger",
		run((_f, c) => [
			c.register(),
			c.authorize({ scope: "publication:threadline publication:stranger" }),
		]),
	),
	oc(
		"authorize: an unrelated scope",
		run((_f, c) => [c.register(), c.authorize({ scope: "openid" })]),
	),
	oc(
		"authorize: no resource",
		run((_f, c) => [c.register(), c.authorize({ resource: null })]),
	),
	oc(
		"authorize: the wrong resource",
		run((_f, c) => [
			c.register(),
			c.authorize({ resource: "https://thesuperhuman.us/api/other" }),
		]),
	),
	oc(
		"authorize: the resource with a trailing slash",
		run((_f, c) => [c.register(), c.authorize({ resource: `${RESOURCE}/` })]),
	),
	oc(
		"authorize: an unknown client id",
		run((f, _c) => [
			f.step({
				path: `/api/publication/authorize?${new URLSearchParams({ response_type: "code", client_id: "nobody", redirect_uri: REDIRECT, scope: SCOPES, resource: RESOURCE, code_challenge: CHALLENGE, code_challenge_method: "S256" })}`,
			}),
		]),
	),
	oc(
		"authorize: no client id",
		run((_f, c) => [c.register(), c.authorize({ client_id: null })]),
	),
	oc(
		"authorize: a redirect that is not registered",
		run((_f, c) => [
			c.register(),
			c.authorize({ redirect_uri: "https://evil.test/cb" }),
		]),
	),
	oc(
		"authorize: no redirect",
		run((_f, c) => [c.register(), c.authorize({ redirect_uri: null })]),
	),
	oc(
		"authorize: a state too long to fit in the cookie",
		run((_f, c) => [c.register(), c.authorize({ state: "s".repeat(3000) })]),
	),
	oc(
		"authorize: a state of 1000 characters",
		run((_f, c) => [c.register(), c.authorize({ state: "s".repeat(1000) })]),
	),
	oc(
		"authorize: the cookie key has the wrong length",
		run((_f, c) => [c.register(), c.authorize()]),
		{ env: { PUBLICATION_COOKIE_KEY: btoa("short") } },
	),
	oc(
		"authorize: the cookie key is not base64",
		run((_f, c) => [c.register(), c.authorize()]),
		{ env: { PUBLICATION_COOKIE_KEY: "***" } },
	),
	oc(
		"authorize: the client lookup fails",
		run((f, c) => {
			f.set("client", SEEDED_CLIENT);

			return [c.authorize()];
		}),
		{
			kv: {
				OAUTH_KV: {
					seed: { [`client:${SEEDED_CLIENT}`]: seededClient },
					fails: ["get"],
				},
			},
		},
	),
	oc("login: a PUT on the authorize path", [
		{ method: "PUT", path: "/api/publication/authorize", body: "x" },
	]),
	oc("login: a DELETE on the callback path", [
		{ method: "DELETE", path: "/api/publication/callback" },
	]),
	oc("login: a POST on the callback path", [
		{ method: "POST", path: "/api/publication/callback", body: "x" },
	]),
];

// ---------------------------------------------------------------- consent

const FORM_TYPE = "application/x-www-form-urlencoded";
const SITE = "https://thesuperhuman.us";

/** A consent request with this cookie and Origin; null leaves the header out. */
const consentWith = (cookie: string | null, origin: string | null = SITE) => {
	const headers = new Headers({ "content-type": FORM_TYPE });

	if (origin !== null) headers.set("origin", origin);

	if (cookie !== null) headers.set("cookie", cookie);

	return { headers: Object.fromEntries(headers) };
};

const page = (_f: Flow, c: ReturnType<typeof connection>) => [
	c.register(),
	c.authorize(),
];

const consentCases: Case[] = [
	oc(
		"consent: approve and go to GitHub",
		run((f, c) => [...page(f, c), c.consent()]),
	),
	oc(
		"consent: the same page cookie approves twice",
		run((f, c) => [...page(f, c), c.consent(), c.consent()]),
	),
	oc(
		"consent: the approved cookie cannot approve again",
		run((f, c) => [
			...page(f, c),
			c.consent(),
			c.consent(consentWith("__Host-publication-login=~approved~")),
		]),
	),
	oc(
		"consent: a foreign origin",
		run((f, c) => [
			...page(f, c),
			c.consent(
				consentWith("__Host-publication-login=~login~", "https://evil.test"),
			),
		]),
	),
	oc(
		"consent: no origin header",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("__Host-publication-login=~login~", null)),
		]),
	),
	oc(
		"consent: the origin with a trailing slash",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("__Host-publication-login=~login~", `${SITE}/`)),
		]),
	),
	oc(
		"consent: no cookie",
		run((f, c) => [...page(f, c), c.consent(consentWith(null))]),
	),
	oc(
		"consent: a garbage cookie",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("__Host-publication-login=garbage")),
		]),
	),
	oc(
		"consent: a cookie with one ciphertext character changed",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("__Host-publication-login=~loginTampered~")),
		]),
	),
	oc(
		"consent: a cookie cut after its dot",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("__Host-publication-login=~loginCut~")),
		]),
	),
	oc(
		"consent: an oversize cookie",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith(`__Host-publication-login=${"a".repeat(3601)}`)),
		]),
	),
	oc(
		"consent: the login cookie among others",
		run((f, c) => [
			...page(f, c),
			c.consent(
				consentWith("theme=dark; __Host-publication-login=~login~; other=1"),
			),
		]),
	),
	oc(
		"consent: a cookie named like the login cookie without the prefix",
		run((f, c) => [
			...page(f, c),
			c.consent(consentWith("publication-login=~login~")),
		]),
	),
	oc(
		"consent: the wrong nonce",
		run((f, c) => [
			...page(f, c),
			c.consent({ body: form({ nonce: "not-the-nonce" }) }),
		]),
	),
	oc(
		"consent: no nonce",
		run((f, c) => [...page(f, c), c.consent({ body: "" })]),
	),
	oc(
		"consent: the nonce sent as JSON",
		run((f, c) => [
			...page(f, c),
			c.consent({
				headers: {
					"content-type": "application/json",
					origin: SITE,
					cookie: "__Host-publication-login=~login~",
				},
				body: JSON.stringify({ nonce: "~nonce~" }),
			}),
		]),
	),
	oc(
		"consent: at the expiry boundary of ten minutes",
		run((f, c) => [...page(f, c), c.consent({ advanceMs: 600_000 })]),
	),
	oc(
		"consent: one millisecond after ten minutes",
		run((f, c) => [...page(f, c), c.consent({ advanceMs: 600_001 })]),
	),
	oc(
		"consent: the cookie key changed between the page and the consent",
		run((f, c) => [
			...page(f, c),
			c.consent({ env: { PUBLICATION_COOKIE_KEY: btoa("z".repeat(32)) } }),
		]),
	),
	oc(
		"consent: a GitHub client id with special characters is encoded",
		run((f, c) => [...page(f, c), c.consent()]),
		{ env: { PUBLICATION_GITHUB_CLIENT_ID: "id with space&x=1" } },
	),
];

// ---------------------------------------------------------------- GitHub callback

const callbackCases: Case[] = [
	oc(
		"callback: the owner signs in and the client gets a code",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
	),
	oc(
		"callback: the same approved cookie used twice issues two codes",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback(),
			c.callback(),
		]),
	),
	oc(
		"callback: no cookie",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ headers: {} }),
		]),
	),
	oc(
		"callback: the page cookie that was never approved",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ headers: { cookie: "__Host-publication-login=~login~" } }),
		]),
	),
	oc(
		"callback: the wrong state",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({
				path: "/api/publication/callback?code=github-code&state=wrong",
			}),
		]),
	),
	oc(
		"callback: no state",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ path: "/api/publication/callback?code=github-code" }),
		]),
	),
	oc(
		"callback: no code",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ path: "/api/publication/callback?state=~nonce~" }),
		]),
	),
	oc(
		"callback: an empty code",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ path: "/api/publication/callback?code=&state=~nonce~" }),
		]),
	),
	oc(
		"callback: a code of 512 characters is sent to GitHub",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({
				path: `/api/publication/callback?code=${"c".repeat(512)}&state=~nonce~`,
			}),
		]),
	),
	oc(
		"callback: a code of 513 characters is refused",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({
				path: `/api/publication/callback?code=${"c".repeat(513)}&state=~nonce~`,
			}),
		]),
	),
	oc(
		"callback: GitHub reports an error and no code",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({
				path: "/api/publication/callback?error=access_denied&state=~nonce~",
			}),
		]),
	),
	oc(
		"callback: GitHub answers the code exchange with an error body",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{
			fetches: github({ token: json(200, { error: "bad_verification_code" }) }),
		},
	),
	oc(
		"callback: GitHub answers the code exchange with 500",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ token: json(500, { access_token: "x" }) }) },
	),
	oc(
		"callback: GitHub answers the code exchange with no token",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ token: json(200, {}) }) },
	),
	oc(
		"callback: GitHub answers the code exchange with HTML",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ token: text(200, "<html>oops</html>") }) },
	),
	oc(
		"callback: the code exchange cannot reach GitHub",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{
			fetches: github({
				token: networkDown("getaddrinfo ENOTFOUND github.com"),
			}),
		},
	),
	oc(
		"callback: GitHub's user lookup is refused",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: json(401, { message: "Bad credentials" }) }) },
	),
	oc(
		"callback: GitHub's user lookup cannot be reached",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: networkDown() }) },
	),
	oc(
		"callback: GitHub's user lookup answers with HTML",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: text(200, "<html></html>") }) },
	),
	oc(
		"callback: a different GitHub user",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: json(200, { id: 42 }) }) },
	),
	oc(
		"callback: a user answer with no id",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: json(200, { login: "kwilson21" }) }) },
	),
	oc(
		"callback: the owner id returned as text still matches",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: json(200, { id: "10987837" }) }) },
	),
	oc(
		"callback: a user answer of null",
		run((_f, c) => [c.register(), c.authorize(), c.consent(), c.callback()]),
		{ fetches: github({ user: text(200, "null") }) },
	),
	oc(
		"callback: after the ten minute expiry",
		run((_f, c) => [
			c.register(),
			c.authorize(),
			c.consent(),
			c.callback({ advanceMs: 600_001 }),
		]),
	),
	oc(
		"callback: completing the grant fails in KV",
		run((f, c) => {
			f.set("client", SEEDED_CLIENT);

			return [c.authorize(), c.consent(), c.callback()];
		}),
		{
			kv: {
				OAUTH_KV: {
					seed: { [`client:${SEEDED_CLIENT}`]: seededClient },
					fails: ["put"],
				},
			},
		},
	),
];

const cases: Case[] = [
	...routing,
	...configuration,
	...size,
	...withKv(registration),
	...withKv(authorizeCases),
	...withKv(consentCases),
	...withKv(callbackCases),
];

defineCorpus("publication-oauth", ALL, cases);
