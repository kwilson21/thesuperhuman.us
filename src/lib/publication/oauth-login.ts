import type {
	AuthRequest,
	OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

export const publicationOrigin = "https://thesuperhuman.us";
export const publicationBase = "/api/publication";
export const publicationResource = publicationOrigin + publicationBase + "/mcp";

export interface LoginEnv extends Env {
	OAUTH_PROVIDER: OAuthHelpers;
	PUBLICATION_GITHUB_CLIENT_ID: string;
	PUBLICATION_GITHUB_CLIENT_SECRET: string;
	PUBLICATION_COOKIE_KEY: string;
}

interface LoginState {
	request: AuthRequest;
	nonce: string;
	verifier: string;
	expires: number;
	approved: boolean;
}

const cookieName = "__Host-publication-login";

const encode = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

function decode(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(
		atob(value.replace(/-/g, "+").replace(/_/g, "/")),
		(c) => c.charCodeAt(0),
	);
}

const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

const cookie = (value: string, age = 600) =>
	`${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

async function key(env: LoginEnv) {
	const bytes = decode(env.PUBLICATION_COOKIE_KEY);

	if (bytes.length !== 32) throw new Error("Invalid cookie key");

	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

async function seal(value: LoginState, env: LoginEnv) {
	const iv = crypto.getRandomValues(new Uint8Array(12));

	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await key(env),
		new TextEncoder().encode(JSON.stringify(value)),
	);

	const token = encode(iv) + "." + encode(new Uint8Array(encrypted));

	if (token.length > 3600) throw new Error("Authorization request too large");

	return token;
}

async function unseal(request: Request, env: LoginEnv): Promise<LoginState> {
	const value = request.headers
		.get("cookie")
		?.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(cookieName + "="))
		?.slice(cookieName.length + 1);

	if (!value || value.length > 3600) throw new Error("Missing login");
	const [iv, ciphertext] = value.split(".");

	const bytes = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: decode(iv) },
		await key(env),
		decode(ciphertext),
	);

	// SAFETY: the bytes are AES-GCM-decrypted with the server cookie key, so they are the JSON that seal wrote from a LoginState.
	const state = JSON.parse(new TextDecoder().decode(bytes)) as LoginState;

	if (!Number.isFinite(state.expires) || state.expires < Date.now())
		throw new Error("Expired login");

	return state;
}

const escape = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!,
	);

const fail = () =>
	new Response(
		"Sign-in could not be completed. Start again from your connection settings.",
		{
			status: 400,
			headers: { "Cache-Control": "no-store", "Set-Cookie": cookie("", 0) },
		},
	);

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

// The consent page's only stylesheet. Its values are the site's tokens from src/styles/global.css as literals, because this
// response carries its own CSP (default-src 'none'), not the site's. That policy admits this exact block by SHA-256 hash
// and no other inline style. Libron is loaded from the site's own font files (the same Regular and Bold faces global.css
// declares), which the policy admits with font-src 'self' only.
const consentStyle = `
@font-face { font-family: 'Libron'; src: url('/fonts/libron-v0.25/Libron-Regular.woff2') format('woff2'); font-display: swap; font-style: normal; font-weight: 400; }
@font-face { font-family: 'Libron'; src: url('/fonts/libron-v0.25/Libron-Bold.woff2') format('woff2'); font-display: swap; font-style: normal; font-weight: 700; }
html { background: #FBF8F2; color: #0E0E0E; color-scheme: light; }
body { margin: 0; min-height: 100vh; min-height: 100svh; background: #FBF8F2; color: #0E0E0E; font: 400 1rem/1.6 'Libron', 'Iowan Old Style', Georgia, serif; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
main { box-sizing: border-box; max-width: 34rem; margin: 0 auto; padding: max(3rem, 12vh) 1.5rem 3rem; overflow-wrap: anywhere; }
h1 { font: 400 clamp(2rem, 5vw, 2.5rem)/1.2 'Libron', 'Iowan Old Style', Georgia, serif; letter-spacing: -0.01em; color: #0E0E0E; margin: 0 0 1.5rem; text-wrap: balance; }
p { margin: 0 0 1rem; color: #4A4A4A; text-wrap: pretty; }
strong { color: #0E0E0E; font-weight: 700; }
.return-address { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #E8E3DA; }
form { margin: 0 0 1.5rem; }
button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; max-width: 100%; padding: .55rem 1.5rem; background: #AE5534; color: #FBF8F2; border: 1px solid #AE5534; border-radius: 999px; font: inherit; line-height: 1.4; white-space: normal; text-align: center; cursor: pointer; -webkit-tap-highlight-color: color-mix(in srgb, #AE5534 20%, transparent); }
button:active { opacity: .78; }
@media (hover: hover) and (pointer: fine) { button:hover { background: #0E0E0E; border-color: #0E0E0E; } }
:focus-visible { outline: 2px solid #AE5534; outline-offset: 2px; }
.cancel { margin: 0; font: .8125rem/1.5 system-ui, -apple-system, sans-serif; color: #4A4A4A; }
`;

async function sha256Base64(text: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);

	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** Explicit client consent precedes GitHub sign-in; no remembered blanket approval. */
export async function publicationLogin(
	request: Request,
	env: LoginEnv,
): Promise<Response> {
	const url = new URL(request.url);

	try {
		if (
			url.pathname === publicationBase + "/authorize" &&
			request.method === "GET"
		) {
			const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);

			const supported = (env.PUBLICATION_PROJECTS ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
				.map((p) => `publication:${p}`);

			if (
				auth.responseType !== "code" ||
				auth.codeChallengeMethod !== "S256" ||
				!auth.codeChallenge ||
				!auth.scope.length ||
				auth.scope.some((s) => !supported.includes(s)) ||
				(auth.resource !== publicationResource &&
					!(
						Array.isArray(auth.resource) &&
						auth.resource.length === 1 &&
						auth.resource[0] === publicationResource
					))
			)
				return fail();
			const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);

			if (!client) return fail();

			const state: LoginState = {
				request: auth,
				nonce: random(),
				verifier: random(),
				expires: Date.now() + 600000,
				approved: false,
			};

			return new Response(
				`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>Connect project publishing</title><style>${consentStyle}</style><body><main>
        <h1>Connect project publishing</h1><p><strong>${escape(client.clientName || auth.clientId)}</strong> is requesting access to ${escape(auth.scope.map((s) => s.slice(12)).join(", "))}.</p>
        <p>This connection can read progress and publish, correct, or permanently withdraw public progress on thesuperhuman.us.</p>
        <p class="return-address">Return address: ${escape(new URL(auth.redirectUri).origin)}</p>
        <form method="post" action="${publicationBase}/authorize"><input type="hidden" name="nonce" value="${state.nonce}"><button type="submit">Allow and sign in with GitHub</button></form><p class="cancel">Close this page to cancel.</p>
        </main></body></html>`,
				{
					headers: {
						"Content-Type": "text/html; charset=utf-8",
						"Cache-Control": "no-store",
						// Preserve Origin on the same-site consent POST; omit cross-site referrers.
						"Set-Cookie": cookie(await seal(state, env)),
						"Referrer-Policy": "same-origin",
						// Browsers also enforce form-action on the POST's redirect destination.
						"Content-Security-Policy": `default-src 'none'; style-src 'sha256-${await sha256Base64(consentStyle)}'; font-src 'self'; form-action 'self' https://github.com/login/oauth/authorize ${new URL(auth.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
					},
				},
			);
		}

		if (
			url.pathname === publicationBase + "/authorize" &&
			request.method === "POST"
		) {
			if (request.headers.get("origin") !== publicationOrigin) return fail();
			const state = await unseal(request, env);
			const body = new URLSearchParams(await request.text());

			if (state.approved || body.get("nonce") !== state.nonce) return fail();
			state.approved = true;
			const github = new URL("https://github.com/login/oauth/authorize");
			github.search = new URLSearchParams({
				client_id: env.PUBLICATION_GITHUB_CLIENT_ID,
				redirect_uri: publicationOrigin + publicationBase + "/callback",
				state: state.nonce,
				scope: "",
				code_challenge: encode(
					new Uint8Array(
						await crypto.subtle.digest(
							"SHA-256",
							new TextEncoder().encode(state.verifier),
						),
					),
				),
				code_challenge_method: "S256",
				allow_signup: "false",
			}).toString();

			return redirect(github.href, await seal(state, env));
		}

		if (
			url.pathname === publicationBase + "/callback" &&
			request.method === "GET"
		) {
			const state = await unseal(request, env);
			const code = url.searchParams.get("code");

			if (
				!state.approved ||
				!code ||
				code.length > 512 ||
				url.searchParams.get("state") !== state.nonce
			)
				return fail();

			const response = await fetch(
				"https://github.com/login/oauth/access_token",
				{
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: new URLSearchParams({
						client_id: env.PUBLICATION_GITHUB_CLIENT_ID,
						client_secret: env.PUBLICATION_GITHUB_CLIENT_SECRET,
						code,
						redirect_uri: publicationOrigin + publicationBase + "/callback",
						code_verifier: state.verifier,
					}),
					signal: AbortSignal.timeout(10000),
				},
			);

			// SAFETY: only access_token and error are read, and the fail() check below tests both before access_token is used.
			const token = (await response.json()) as {
				access_token?: string;
				error?: string;
			};

			if (!response.ok || token.error || !token.access_token) return fail();

			const userResponse = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${token.access_token}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "superhuman-publication",
				},
				signal: AbortSignal.timeout(10000),
			});

			// SAFETY: only id is read, then stringified and compared with the configured owner ID, so a missing id becomes "undefined" and cannot match; the body is GitHub's API response over TLS.
			const user = (await userResponse.json()) as { id?: number };

			if (
				!userResponse.ok ||
				!env.PUBLICATION_OWNER_ID ||
				String(user.id) !== env.PUBLICATION_OWNER_ID
			)
				return fail();

			const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
				request: state.request,
				userId: String(user.id),
				scope: state.request.scope,
				metadata: {},
				props: { ownerId: String(user.id), scopes: state.request.scope },
			});

			return redirect(redirectTo, "", 0);
		}

		return new Response("Not found", { status: 404 });
	} catch {
		return fail();
	}
}
