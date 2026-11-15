import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export const publicationOrigin = "https://thesuperhuman.us";
export const publicationBase = "/api/publication";
export const publicationResource = publicationOrigin + publicationBase + "/mcp";

export interface LoginEnv extends Env {
	OAUTH_PROVIDER: OAuthHelpers;
	PUBLICATION_GITHUB_CLIENT_ID: string;
	PUBLICATION_GITHUB_CLIENT_SECRET: string;
	PUBLICATION_COOKIE_KEY: string;
}

/** The login cookie's name (it carries the sealed state of one sign-in, nothing else). */
export const cookieName = "__Host-publication-login";

const escape = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!,
	);

// The consent page's only stylesheet. Its values are the site's tokens from src/styles/global.css as literals, because this
// response carries its own CSP (default-src 'none'), not the site's. That policy admits this exact block by SHA-256 hash
// and no other inline style. Libron is loaded from the site's own font files (the same Regular and Bold faces global.css
// declares), which the policy admits with font-src 'self' only.
export const consentStyle = `
@font-face { font-family: 'Libron'; src: url('/fonts/libron-v0.25/Libron-Regular.woff2') format('woff2'); font-display: swap; font-style: normal; font-weight: 400; }
@font-face { font-family: 'Libron'; src: url('/fonts/libron-v0.25/Libron-Bold.woff2') format('woff2'); font-display: swap; font-style: normal; font-weight: 700; }
html { background: #FBF8F2; color: #0E0E0E; color-scheme: light; }
body { margin: 0; min-height: 100vh; min-height: 100svh; background: #FBF8F2; color: #0E0E0E; font: 400 1rem/1.6 'Libron', 'Iowan Old Style', Georgia, serif; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
main { box-sizing: border-box; max-width: 34rem; margin: 0 auto; padding: max(3rem, 12vh) 1.5rem 3rem; overflow-wrap: break-word; }
h1 { font: 400 clamp(1.25rem, 8.2vw, 2.5rem)/1.2 'Libron', 'Iowan Old Style', Georgia, serif; letter-spacing: -0.01em; color: #0E0E0E; margin: 0 0 1.5rem; text-wrap: balance; }
p { margin: 0 0 1rem; color: #4A4A4A; text-wrap: pretty; }
strong { color: #0E0E0E; font-weight: 700; }
.return-address { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #E8E3DA; }
form { margin: 0 0 1.5rem; }
button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; max-width: 100%; padding: .55rem 1.5rem; background: #AE5534; color: #FBF8F2; border: 1px solid #AE5534; border-radius: 999px; font: inherit; line-height: 1.4; white-space: normal; text-align: center; cursor: pointer; -webkit-tap-highlight-color: color-mix(in srgb, #AE5534 20%, transparent); }
button:active { background: #0E0E0E; border-color: #0E0E0E; }
@media (hover: hover) and (pointer: fine) { button:hover { background: #0E0E0E; border-color: #0E0E0E; } }
:focus-visible { outline: 2px solid #AE5534; outline-offset: 2px; }
.cancel { margin: 0; font: .8125rem/1.5 system-ui, -apple-system, sans-serif; color: #4A4A4A; }
`;

/** The consent page: who asks, for what, where the visitor returns to, and the one form that carries the nonce. */
export function consentHtml(
	clientName: string,
	projects: readonly string[],
	returnOrigin: string,
	nonce: string,
) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>Connect project publishing</title><style>${consentStyle}</style><body><main>
        <h1>Connect project publishing</h1><p><strong>${escape(clientName)}</strong> is requesting access to ${escape(projects.join(", "))}.</p>
        <p>This connection can read progress and publish, correct, or permanently withdraw public progress on thesuperhuman.us.</p>
        <p class="return-address">Return address: ${escape(returnOrigin)}</p>
        <form method="post" action="${publicationBase}/authorize"><input type="hidden" name="nonce" value="${nonce}"><button type="submit">Allow and sign in with GitHub</button></form><p class="cancel">Close this page to cancel.</p>
        </main></body></html>`;
}

/** The consent page's own policy: its one inline style by hash, the site's fonts, and where the form may go. */
export const consentPolicy = (styleHash: string, returnOrigin: string) =>
	`default-src 'none'; style-src 'sha256-${styleHash}'; font-src 'self'; form-action 'self' https://github.com/login/oauth/authorize ${returnOrigin}; frame-ancestors 'none'; base-uri 'none'`;
