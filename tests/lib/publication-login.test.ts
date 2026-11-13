import { existsSync, readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { double, partial } from "../helpers/doubles";
import {
	publicationLogin,
	publicationResource,
	type LoginEnv,
} from "~/lib/publication/oauth-login";

const origin = "https://thesuperhuman.us";

// The site's values, read from global.css so the consent page cannot drift from them.
const globalCss = readFileSync(
	new URL("../../src/styles/global.css", import.meta.url),
	"utf8",
);

const tokenHex = (name: string) => {
	const match = globalCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));

	if (!match) throw new Error(`--${name} not found in global.css`);

	return match[1].toUpperCase();
};

const tokenValue = (name: string) => {
	const match = globalCss.match(new RegExp(`--${name}:\\s*([^;]+);`));

	if (!match) throw new Error(`--${name} not found in global.css`);

	return match[1].trim();
};

const siteButton = (() => {
	const block = /\.site-button \{([^}]*)\}/.exec(globalCss);

	if (!block) throw new Error(".site-button not found in global.css");

	const declared = (prop: string) =>
		new RegExp(`${prop}:\\s*([^;]+);`).exec(block[1])?.[1].trim();

	return {
		minHeight: declared("min-height")!,
		padding: declared("padding")!,
		lineHeight: declared("line-height")!,
	};
})();

const site = {
	paper: tokenHex("paper"),
	ink: tokenHex("ink"),
	muted: tokenHex("muted"),
	rule: tokenHex("rule"),
	accent: tokenHex("accent"),
	radius: tokenValue("radius-button"),
	serif: tokenValue("font-serif"),
	sans: tokenValue("font-sans"),
	button: siteButton,
};

const auth = {
	responseType: "code",
	clientId: "client",
	redirectUri: "https://chatgpt.com/callback",
	scope: ["publication:threadline"],
	state: "downstream-state",
	codeChallenge: "a".repeat(43),
	codeChallengeMethod: "S256",
	resource: publicationResource,
};

function fixture(overrides = {}, clientName = "<script>evil</script>") {
	const complete = vi.fn<OAuthHelpers["completeAuthorization"]>(async () => ({
		redirectTo: "https://chatgpt.com/callback?code=issued",
	}));

	const env = partial<LoginEnv>({
		PUBLICATION_PROJECTS: "threadline",
		PUBLICATION_OWNER_ID: "10987837",
		PUBLICATION_GITHUB_CLIENT_ID: "public-client",
		PUBLICATION_GITHUB_CLIENT_SECRET: "test-secret",
		PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
		OAUTH_PROVIDER: double<OAuthHelpers>({
			parseAuthRequest: vi.fn<OAuthHelpers["parseAuthRequest"]>(async () => ({
				...auth,
				...overrides,
			})),
			lookupClient: vi.fn<OAuthHelpers["lookupClient"]>(async () =>
				partial<NonNullable<Awaited<ReturnType<OAuthHelpers["lookupClient"]>>>>(
					{
						clientName,
					},
				),
			),
			completeAuthorization: complete,
		}),
	});

	return { env, complete };
}

function cookie(response: Response) {
	return response.headers.get("set-cookie")!.split(";")[0];
}

async function start(env: LoginEnv) {
	const page = await publicationLogin(
		new Request(origin + "/api/publication/authorize"),
		env,
	);

	const html = await page.text();
	const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];

	const response = await publicationLogin(
		new Request(origin + "/api/publication/authorize", {
			method: "POST",
			headers: { origin, cookie: cookie(page) },
			body: new URLSearchParams({ nonce }),
		}),
		env,
	);

	return { page, html, response, nonce };
}

afterEach(() => vi.unstubAllGlobals());

describe("publication consent and GitHub identity", () => {
	it("permits the validated client return origin without copying callback paths or query values into CSP", async () => {
		for (const redirectUri of [
			"http://127.0.0.1:54321/callback?marker=private",
			"https://chatgpt.com/callback?marker=private",
		]) {
			const { env } = fixture({ redirectUri });

			const page = await publicationLogin(
				new Request(origin + "/api/publication/authorize"),
				env,
			);

			const policy = page.headers.get("content-security-policy")!;
			expect(policy).toContain(
				`form-action 'self' https://github.com/login/oauth/authorize ${new URL(redirectUri).origin};`,
			);
			expect(policy).not.toContain("marker");
		}
	});
	it("escapes client names, binds browser consent, and uses upstream PKCE without repository scopes", async () => {
		const { env } = fixture();
		const { html, response, page } = await start(env);
		expect(html).not.toContain("<script>evil");
		expect(html).toContain("&lt;script&gt;");
		expect(page.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'none'",
		);
		expect(page.headers.get("content-security-policy")).toContain(
			"form-action 'self' https://github.com/login/oauth/authorize https://chatgpt.com;",
		);
		expect(page.headers.get("referrer-policy")).toBe("same-origin");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		const github = new URL(response.headers.get("location")!);
		expect(github.origin).toBe("https://github.com");
		expect(github.pathname).toBe("/login/oauth/authorize");
		expect(github.searchParams.get("scope")).toBe("");
		expect(github.searchParams.get("code_challenge_method")).toBe("S256");
		expect(github.searchParams.get("code_challenge")).toHaveLength(43);
		expect(response.headers.get("set-cookie")).toContain(
			"HttpOnly; Secure; SameSite=Lax",
		);
	});
	it("rejects foreign resources, unknown project scopes, and absent downstream PKCE", async () => {
		for (const overrides of [
			{ resource: "https://evil.example/mcp" },
			{ scope: ["publication:private"] },
			{ codeChallengeMethod: "plain" },
		]) {
			const { env } = fixture(overrides);
			expect(
				(
					await publicationLogin(
						new Request(origin + "/api/publication/authorize"),
						env,
					)
				).status,
			).toBe(400);
		}
	});
	it("rejects cross-site consent and callback state tampering before upstream calls", async () => {
		const { env, complete } = fixture();
		const { response, nonce } = await start(env);
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);

		const post = await publicationLogin(
			new Request(origin + "/api/publication/authorize", {
				method: "POST",
				headers: { origin: "https://evil.example", cookie: cookie(response) },
				body: new URLSearchParams({ nonce }),
			}),
			env,
		);

		expect(post.status).toBe(400);
		expect(
			(
				await publicationLogin(
					new Request(origin + "/api/publication/callback?code=x&state=wrong", {
						headers: { cookie: cookie(response) },
					}),
					env,
				)
			).status,
		).toBe(400);
		expect(fetcher).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	});
	it("grants only the verified owner and discards the upstream access token", async () => {
		const { env, complete } = fixture();
		const { response, nonce } = await start(env);

		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ access_token: "upstream-secret" }))
			.mockResolvedValueOnce(Response.json({ id: 10987837 }));

		vi.stubGlobal("fetch", fetcher);

		const result = await publicationLogin(
			new Request(origin + "/api/publication/callback?code=x&state=" + nonce, {
				headers: { cookie: cookie(response) },
			}),
			env,
		);

		expect(result.status).toBe(302);

		const grant = complete.mock.calls[0];

		expect(grant[0].props).toEqual({
			ownerId: "10987837",
			scopes: ["publication:threadline"],
		});
		expect(JSON.stringify(grant)).not.toContain("upstream-secret");
		expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(
			new URLSearchParams(fetcher.mock.calls[0][1].body).get("code_verifier"),
		).toHaveLength(43);
	});
	it("denies another GitHub account and expired browser state", async () => {
		const { env, complete } = fixture();
		const { response, nonce } = await start(env);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ access_token: "token" }))
				.mockResolvedValueOnce(Response.json({ id: 123 })),
		);

		const req = () =>
			new Request(origin + "/api/publication/callback?code=x&state=" + nonce, {
				headers: { cookie: cookie(response) },
			});

		expect((await publicationLogin(req(), env)).status).toBe(400);
		const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 700000);
		expect((await publicationLogin(req(), env)).status).toBe(400);
		clock.mockRestore();
		expect(complete).not.toHaveBeenCalled();
	});
});

async function consentPage(clientName?: string) {
	const { env } =
		clientName === undefined ? fixture() : fixture({}, clientName);

	const page = await publicationLogin(
		new Request(origin + "/api/publication/authorize"),
		env,
	);

	return {
		html: await page.text(),
		policy: page.headers.get("content-security-policy")!,
	};
}

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];

const buttonRule = (css: string) =>
	/(?:^|\n)button\s*\{([^}]*)\}/.exec(css)![1];

describe("publication consent style matches the site's global.css", () => {
	it("uses only the site's colour tokens, as literals", async () => {
		const css = styleOf((await consentPage()).html);

		const allowed = new Set([
			site.paper,
			site.ink,
			site.muted,
			site.rule,
			site.accent,
		]);

		const used = (css.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) =>
			h.toUpperCase(),
		);

		expect(used.length).toBeGreaterThan(0);

		for (const colour of used) expect(allowed.has(colour)).toBe(true);
	});

	it("gives the button the site's size, padding, line height and radius", async () => {
		const button = buttonRule(styleOf((await consentPage()).html));

		expect(button).toContain(`min-height: ${site.button.minHeight}`);
		expect(button).toContain(`padding: ${site.button.padding}`);
		expect(button).toContain(`line-height: ${site.button.lineHeight}`);
		expect(button).toContain(`border-radius: ${site.radius}`);
	});

	it("sets the site's tap highlight on the button", async () => {
		const highlight = /-webkit-tap-highlight-color:\s*([^;]+);/
			.exec(globalCss)![1]
			.replace(/var\(--accent\)/g, site.accent);

		expect(buttonRule(styleOf((await consentPage()).html))).toContain(
			`-webkit-tap-highlight-color: ${highlight}`,
		);
	});

	it("draws the rule, the button outline and the hover fill from the site's tokens", async () => {
		const css = styleOf((await consentPage()).html);

		expect(css).toMatch(
			new RegExp(
				`\\.return-address\\s*\\{[^}]*border-top:\\s*1px solid ${site.rule}`,
				"i",
			),
		);
		expect(buttonRule(css)).toMatch(
			new RegExp(`border:\\s*1px solid ${site.accent}`, "i"),
		);
		expect(css).toMatch(
			new RegExp(`button:hover\\s*\\{[^}]*background:\\s*${site.ink}`, "i"),
		);
	});

	it("uses the site's serif stack, and the site's sans stack without Inter, which this page cannot load", async () => {
		const css = styleOf((await consentPage()).html);
		// Inter is not self-hosted and this policy admits no font host, so the cancel note keeps the system part of --font-sans.
		const sans = site.sans.replace(/^'Inter',\s*/, "");

		expect(css).toContain(site.serif);
		expect(css).toContain(`font: .8125rem/1.5 ${sans}`);
	});
});

async function sha256Base64(text: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);

	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe("publication consent page styling", () => {
	it("keeps the consent copy, the form, its action and the hidden nonce", async () => {
		const { html } = await consentPage();

		expect(html).toContain("<h1>Connect project publishing</h1>");
		expect(html).toContain("</strong> is requesting access to threadline.");
		expect(html).toContain(
			"This connection can read progress and publish, correct, or permanently withdraw public progress on thesuperhuman.us.",
		);
		expect(html).toContain("Return address: https://chatgpt.com");
		expect(html).toContain(
			'<form method="post" action="/api/publication/authorize"><input type="hidden" name="nonce" value="',
		);
		expect(html).toMatch(
			/name="nonce" value="[A-Za-z0-9_-]{43}"><button type="submit">Allow and sign in with GitHub<\/button><\/form>/,
		);
		expect(html).toContain("Close this page to cancel.");
	});

	it("styles the sign-in button as the site's primary pill", async () => {
		const css = styleOf((await consentPage()).html);

		expect(css).toMatch(
			new RegExp(`button\\s*\\{[^}]*border-radius:\\s*${site.radius}`),
		);
		expect(css).toMatch(
			new RegExp(`button\\s*\\{[^}]*min-height:\\s*${site.button.minHeight}`),
		);
		expect(css).toMatch(
			new RegExp(`button\\s*\\{[^}]*background:\\s*${site.accent}`, "i"),
		);
		expect(css).toMatch(
			new RegExp(`button\\s*\\{[^}]*color:\\s*${site.paper}`, "i"),
		);
	});

	it("lets the button label wrap at any text size, centred, with no width breakpoint", async () => {
		const css = styleOf((await consentPage()).html);
		const button = /(?:^|\n)button\s*\{([^}]*)\}/.exec(css)![1];

		expect(button).not.toContain("nowrap");
		expect(button).toMatch(/white-space:\s*normal/);
		expect(button).toMatch(/text-align:\s*center/);
		expect(css).not.toContain("max-width: 380px");
	});

	it("keeps a visible keyboard focus ring", async () => {
		const css = styleOf((await consentPage()).html);

		expect(css).toMatch(
			new RegExp(
				`:focus-visible\\s*\\{[^}]*outline:\\s*2px solid ${site.accent}`,
				"i",
			),
		);
	});

	it("loads no external script, stylesheet, image or frame, and only the site's own font files", async () => {
		const { html } = await consentPage();
		const css = styleOf(html);

		expect(html).not.toMatch(/<(script|link|img|iframe|object)\b/i);
		expect(html).not.toContain("@import");
		const urls = css.match(/url\([^)]*\)/g) ?? [];
		expect(urls.length).toBeGreaterThan(0);

		for (const url of urls)
			expect(url).toMatch(
				/^url\('\/fonts\/libron-v0\.25\/Libron-(Regular|Bold)\.woff2'\)$/,
			);
	});

	it("loads Libron, the site's serif, from its own font files with the site's descriptors", async () => {
		const css = styleOf((await consentPage()).html);

		const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
			(m) => m[1],
		);

		expect(faces).toHaveLength(2);

		for (const face of faces) {
			expect(face).toMatch(/font-family:\s*'Libron'/);
			expect(face).toMatch(/font-display:\s*swap/);
			expect(face).toMatch(/font-style:\s*normal/);
			const src = /url\('([^']+)'\)/.exec(face)![1];
			expect(src).toMatch(
				/^\/fonts\/libron-v0\.25\/Libron-(Regular|Bold)\.woff2$/,
			);
			expect(existsSync(new URL("../../public" + src, import.meta.url))).toBe(
				true,
			);
		}

		expect(faces.some((f) => /font-weight:\s*400/.test(f))).toBe(true);
		expect(faces.some((f) => /font-weight:\s*700/.test(f))).toBe(true);
	});

	it("sets Libron first in the serif stack and uses the real bold face for strong", async () => {
		const css = styleOf((await consentPage()).html);

		expect(css).toMatch(
			/body\s*\{[^}]*font:\s*400 1rem\/1\.6 'Libron', 'Iowan Old Style', Georgia, serif/,
		);
		expect(css).toMatch(
			/h1\s*\{[^}]*font:\s*400 clamp\(1\.25rem, 8\.2vw, 2\.5rem\)\/1\.2 'Libron', 'Iowan Old Style', Georgia, serif/,
		);
		expect(css).toMatch(/strong\s*\{[^}]*font-weight:\s*700/);
		expect(css).not.toMatch(/font-weight:\s*600/);
	});

	it("breaks a word only when it cannot fit on a line, so the title never splits inside a word", async () => {
		const css = styleOf((await consentPage()).html);

		expect(css).not.toContain("overflow-wrap: anywhere");
		expect(css).toMatch(/main\s*\{[^}]*overflow-wrap: break-word/);
	});

	it("allows exactly its own inline style and the site's font files under CSP, with no unsafe-inline", async () => {
		const { policy, html } = await consentPage();
		const hash = await sha256Base64(styleOf(html));

		expect(policy).toContain(`style-src 'sha256-${hash}';`);
		expect(policy).not.toContain("unsafe-inline");
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
	});

	it("admits fonts from the site's own origin only, once, before form-action", async () => {
		const { policy } = await consentPage();
		const directives = policy.split(";").map((d) => d.trim());

		expect(directives.filter((d) => d.startsWith("font-src"))).toEqual([
			"font-src 'self'",
		]);
		expect(directives.indexOf("font-src 'self'")).toBeLessThan(
			directives.findIndex((d) => d.startsWith("form-action")),
		);
		expect(policy).not.toMatch(/unsafe-inline|data:/);
	});

	it("keeps a client name that tries to close the style block as escaped text", async () => {
		const { html } = await consentPage("</style><script>alert(1)</script>");

		expect(html).not.toContain("</style><script>");
		expect(html.split("</style>")).toHaveLength(2);
		expect(html).toContain(
			"&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
		);
	});
});
