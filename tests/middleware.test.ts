import type { APIContext, MiddlewareNext } from "astro";
import { describe, it, expect, vi } from "vitest";
import { onRequest } from "~/middleware";
import { verifyOwnerAccess } from "~/lib/owner-access";
import { securityHeaders } from "~/lib/security-headers";
import { double } from "./helpers/doubles";
import { fakeLocals } from "./helpers/runtime";

vi.mock("~/lib/owner-access", () => ({
	verifyOwnerAccess: vi.fn(async () => null),
}));

function makeContext(url: string, hostHeader?: string) {
	const u = new URL(url);
	const headers = new Headers();

	if (hostHeader) headers.set("host", hostHeader);

	return double<APIContext>({
		url: u,
		request: new Request(url, { headers }),
		locals: fakeLocals({ SITE_ORIGIN: "https://thesuperhuman.us" }),
		rewrite: vi.fn<APIContext["rewrite"]>(async (target) => {
			const rewritten = new URL(
				target instanceof Request ? target.url : target,
				u,
			);

			return new Response("rewritten:" + rewritten.pathname, { status: 200 });
		}),
	});
}

/** The response a middleware call returns. The handler returns a Response on every path these tests reach. */
function responseOf(value: Response | void): Response {
	if (value instanceof Response) return value;

	throw new Error("middleware returned no response");
}

/** onRequest with its response narrowed to a Response. */
async function run(
	context: APIContext,
	next: MiddlewareNext,
): Promise<Response> {
	return responseOf(await onRequest(context, next));
}

function expectSecurityHeaders(
	response: Response,
	overrides: Record<string, string> = {},
) {
	for (const [name, value] of Object.entries({
		...securityHeaders,
		...overrides,
	}))
		expect(response.headers.get(name)).toBe(value);
}

describe("middleware.onRequest", () => {
	it("fails the build when an owner route is accidentally prerendered", async () => {
		const ctx = makeContext("https://thesuperhuman.us/owner");
		ctx.isPrerendered = true;
		await expect(onRequest(ctx, vi.fn())).rejects.toThrow(
			"Owner routes must be server-rendered",
		);
	});
	it("fails the build when a studio route is accidentally prerendered", async () => {
		const ctx = makeContext(
			"https://thesuperhuman.us/studio/projects/request-1",
		);

		ctx.isPrerendered = true;
		await expect(onRequest(ctx, vi.fn())).rejects.toThrow(
			"Studio routes must be server-rendered",
		);
	});
	it("rejects unauthenticated owner routes without exposing a cacheable response", async () => {
		vi.mocked(verifyOwnerAccess).mockResolvedValueOnce(null);
		const ctx = makeContext("https://thesuperhuman.us/owner/requests");
		const next = vi.fn(async () => new Response("private content"));
		const response = await run(ctx, next);
		expect(response.status).toBe(403);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		expect(next).not.toHaveBeenCalled();
	});

	it("passes verified owner identity to routes and marks their responses private", async () => {
		vi.mocked(verifyOwnerAccess).mockResolvedValueOnce({
			email: "owner@example.com",
		});
		const ctx = makeContext("https://thesuperhuman.us/owner");
		const next = vi.fn(async () => new Response("private content"));
		const response = await run(ctx, next);
		expect(ctx.locals.owner).toEqual({ email: "owner@example.com" });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
	});

	it("protects owner mutation APIs with the same verified identity", async () => {
		vi.mocked(verifyOwnerAccess).mockResolvedValueOnce({
			email: "owner@example.com",
		});
		const ctx = makeContext("https://thesuperhuman.us/api/owner/audience");
		ctx.request = new Request(ctx.url, {
			method: "POST",
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json",
			},
			body: "{}",
		});

		const next = vi.fn(
			async () => new Response(ctx.locals.owner?.email ?? "missing"),
		);

		const response = await run(ctx, next);
		expect(await response.text()).toBe("owner@example.com");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});

	it("rejects cross-site JSON owner mutations while leaving Stripe webhook paths public", async () => {
		vi.mocked(verifyOwnerAccess).mockResolvedValueOnce({
			email: "owner@example.com",
		});

		const owner = makeContext(
			"https://thesuperhuman.us/api/owner/requests/request-1/payment",
		);

		owner.request = new Request(owner.url, {
			method: "POST",
			headers: {
				origin: "https://evil.example",
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect((await run(owner, async () => new Response("next"))).status).toBe(
			403,
		);

		const webhook = makeContext("https://thesuperhuman.us/api/stripe/webhook");
		webhook.request = new Request(webhook.url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		const next = vi.fn(async () => new Response("webhook"));
		expect(await (await run(webhook, next)).text()).toBe("webhook");
		expect(next).toHaveBeenCalled();
	});

	it("protects future owner APIs by namespace", async () => {
		vi.mocked(verifyOwnerAccess).mockResolvedValueOnce(null);
		const ctx = makeContext("https://thesuperhuman.us/api/owner/campaigns");
		const next = vi.fn(async () => new Response("private content"));
		expect((await run(ctx, next)).status).toBe(403);
		expect(next).not.toHaveBeenCalled();
	});

	it("keeps studio pages private and rejects cross-site studio mutations", async () => {
		const page = makeContext(
			"https://thesuperhuman.us/studio/projects/request-1",
		);

		const pageResponse = await run(
			page,
			async () => new Response("private project"),
		);

		expect(pageResponse.headers.get("cache-control")).toBe("private, no-store");
		expect(pageResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");

		const api = makeContext("https://thesuperhuman.us/api/studio/session");
		api.request = new Request(api.url, {
			method: "POST",
			headers: {
				origin: "https://evil.example",
				"content-type": "application/json",
			},
			body: "{}",
		});
		const next = vi.fn(async () => new Response("accepted"));
		expect((await run(api, next)).status).toBe(403);
		expect(next).not.toHaveBeenCalled();
	});

	it("allows only originless, cookieless native OAuth form exchanges through the form guard", async () => {
		const attempt = async (
			path: string,
			headers: Record<string, string> = {},
			method = "POST",
			origin = "https://thesuperhuman.us",
		) => {
			const ctx = makeContext(origin + path);
			ctx.request = new Request(ctx.url, {
				method,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...headers,
				},
			});

			return await run(ctx, async () => new Response("next"));
		};

		expect((await attempt("/api/publication/token")).status).toBe(200);

		const rejectedHeaders: Record<string, string>[] = [
			{ origin: "https://evil.example" },
			{ origin: "null" },
			{ cookie: "session=x" },
			{ "sec-fetch-site": "cross-site" },
		];

		for (const headers of rejectedHeaders) {
			expect((await attempt("/api/publication/token", headers)).status).toBe(
				403,
			);
		}

		expect((await attempt("/api/publication/token", {}, "PUT")).status).toBe(
			403,
		);
		expect(
			(
				await attempt(
					"/api/publication/token",
					{},
					"POST",
					"https://audio.thesuperhuman.us",
				)
			).status,
		).toBe(403);

		for (const path of [
			"/api/publication/authorize",
			"/api/contact",
			"/api/publication/token/",
		]) {
			expect((await attempt(path)).status).toBe(403);
			expect(
				(await attempt(path, { origin: "https://thesuperhuman.us" })).status,
			).toBe(200);
		}
	});

	it("passes through for the software host", async () => {
		const ctx = makeContext("https://thesuperhuman.us/", "thesuperhuman.us");
		const next = vi.fn(async () => new Response("next", { status: 200 }));
		const res = await run(ctx, next);
		expect(next).toHaveBeenCalled();
		expect(ctx.rewrite).not.toHaveBeenCalled();
		expect(await res.text()).toBe("next");
	});

	it("rewrites root on the audio host", async () => {
		const ctx = makeContext(
			"https://audio.thesuperhuman.us/",
			"audio.thesuperhuman.us",
		);

		const next = vi.fn(async () => new Response("next", { status: 200 }));
		await onRequest(ctx, next);
		expect(ctx.rewrite).toHaveBeenCalledWith("/audio/");
		expect(next).not.toHaveBeenCalled();
	});

	it("rewrites /about on the audio host", async () => {
		const ctx = makeContext(
			"https://audio.thesuperhuman.us/about",
			"audio.thesuperhuman.us",
		);

		const next = vi.fn(async () => new Response("next", { status: 200 }));
		await onRequest(ctx, next);
		expect(ctx.rewrite).toHaveBeenCalledWith("/audio/about");
	});

	it("does not rewrite /api/* on the audio host", async () => {
		const ctx = makeContext(
			"https://audio.thesuperhuman.us/api/audio-inquiry",
			"audio.thesuperhuman.us",
		);

		const next = vi.fn(async () => new Response("next", { status: 200 }));
		await onRequest(ctx, next);
		expect(ctx.rewrite).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalled();
	});

	it("falls back to URL.host when the Host header is missing", async () => {
		const ctx = makeContext("https://audio.thesuperhuman.us/", undefined);
		const next = vi.fn(async () => new Response("next", { status: 200 }));
		await onRequest(ctx, next);
		expect(ctx.rewrite).toHaveBeenCalledWith("/audio/");
	});
});

it("keeps dynamic Worker previews out of search results", async () => {
	const ctx = makeContext("https://preview.example.workers.dev/audio/start");

	const response = await run(ctx, async () => new Response("preview"));

	expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");

	const production = await run(
		makeContext("https://thesuperhuman.us/audio/start"),
		async () => new Response("live"),
	);

	expect(production.headers.has("x-robots-tag")).toBe(false);
});

it("marks offers unavailable or available private and redirects the audio host to the main host", async () => {
	const response = await run(
		makeContext("https://thesuperhuman.us/offer/opaque"),
		async () => new Response("unavailable", { status: 404 }),
	);

	expect(response.status).toBe(404);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
	const next = vi.fn();

	const audio = await run(
		makeContext("https://audio.thesuperhuman.us/offer/opaque"),
		next,
	);

	expect(audio.status).toBe(302);
	expect(audio.headers.get("location")).toBe(
		"https://thesuperhuman.us/offer/opaque",
	);
	expect(next).not.toHaveBeenCalled();
});

it("keeps isolated preview offer paths on their local origin", async () => {
	const next = vi.fn(async () => new Response("offer"));

	const response = await run(
		makeContext("https://preview.example.workers.dev/offer/opaque"),
		next,
	);

	expect(response.status).toBe(200);
	expect(next).toHaveBeenCalledOnce();
	expect(response.headers.has("location")).toBe(false);
});

it.each([
	"/studio/software/example",
	"/api/studio/software/example/updates/update/visual",
])(
	"keeps software route %s private on success and unavailability",
	async (path) => {
		for (const status of [200, 404]) {
			const response = await run(
				makeContext("https://thesuperhuman.us" + path),
				async () => new Response("private", { status }),
			);

			expect(response.headers.get("cache-control")).toBe("private, no-store");
			expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		}
	},
);

it("keeps archive one-time link landing private and uncacheable", async () => {
	const response = await run(
		makeContext("https://thesuperhuman.us/agreements/verify?key=synthetic"),
		async () => new Response("expired"),
	);

	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
});

it.each([
	"/api/agreements/link",
	"/api/agreements/packet/file",
	"/api/offer/token/link",
	"/api/offer/token/sign",
])(
	"refuses noncanonical hosts before agreement handlers for %s",
	async (path) => {
		for (const [origin, host] of [
			["https://preview.example", undefined],
			["https://thesuperhuman.us", "foreign.example"],
		] as const) {
			const ctx = makeContext(origin + path, host),
				next = vi.fn();

			expect((await run(ctx, next)).status).toBe(404);
			expect(next).not.toHaveBeenCalled();
		}
	},
);

it.each(["/api/offer/token/link", "/api/agreements/link"])(
	"uses the effective canonical origin for %s",
	async (path) => {
		for (const origin of [undefined, "http://127.0.0.1:4321"]) {
			for (const host of [
				"https://thesuperhuman.us",
				"http://127.0.0.1:4321",
				"https://foreign.example",
			]) {
				const ctx = makeContext(host + path);
				ctx.locals.runtime.env.SITE_ORIGIN = origin;
				const next = vi.fn(async () => new Response("next"));
				const response = await run(ctx, next);
				expect(response.status).toBe(
					host === (origin ?? "https://thesuperhuman.us") ? 200 : 404,
				);
			}
		}
	},
);

it("adds the _headers security headers to HTML pages", async () => {
	const next = vi.fn(
		async () =>
			new Response("<!doctype html>", {
				headers: { "content-type": "text/html" },
			}),
	);

	expectSecurityHeaders(
		await run(makeContext("https://thesuperhuman.us/"), next),
	);
});

it("adds the _headers security headers to API JSON", async () => {
	const response = await run(
		makeContext("https://thesuperhuman.us/api/work-feed"),
		async () => Response.json({ ok: true }),
	);

	expectSecurityHeaders(response);
});

it("keeps owner 403 responses private and adds the _headers security headers", async () => {
	vi.mocked(verifyOwnerAccess).mockResolvedValueOnce(null);

	const response = await run(
		makeContext("https://thesuperhuman.us/owner/requests"),
		vi.fn(),
	);

	expect(response.status).toBe(403);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
	expectSecurityHeaders(response);
});

it("keeps studio pages on no-referrer and adds the other _headers security headers", async () => {
	const response = await run(
		makeContext("https://thesuperhuman.us/studio/projects/request-1"),
		async () => new Response("private project"),
	);

	expectSecurityHeaders(response, { "referrer-policy": "no-referrer" });
});

it("keeps the agreement no-referrer policy on early noncanonical host 404s", async () => {
	const response = await run(
		makeContext(
			"https://thesuperhuman.us/api/agreements/link",
			"foreign.example",
		),
		vi.fn(),
	);

	expect(response.status).toBe(404);
	expectSecurityHeaders(response, { "referrer-policy": "no-referrer" });
});

it("keeps a referrer policy that a route set on purpose", async () => {
	const next = vi.fn(
		async () =>
			new Response("consent", {
				headers: { "Referrer-Policy": "same-origin" },
			}),
	);

	const response = await run(
		makeContext("https://thesuperhuman.us/api/publication/authorize"),
		next,
	);

	expectSecurityHeaders(response, { "referrer-policy": "same-origin" });
});

it("adds the _headers security headers to audio host rewrites", async () => {
	const response = await run(
		makeContext(
			"https://audio.thesuperhuman.us/about",
			"audio.thesuperhuman.us",
		),
		vi.fn(),
	);

	expect(await response.text()).toBe("rewritten:/audio/about");
	expectSecurityHeaders(response);
});

it("adds the _headers security headers to audio host offer redirects", async () => {
	const response = await run(
		makeContext("https://audio.thesuperhuman.us/offer/opaque"),
		vi.fn(),
	);

	expect(response.status).toBe(302);
	expectSecurityHeaders(response);
});

it("adds the _headers security headers to redirects returned by routes", async () => {
	const response = await run(
		makeContext("https://thesuperhuman.us/"),
		async () => Response.redirect("https://thesuperhuman.us/next", 302),
	);

	expect(response.status).toBe(302);
	expect(response.headers.get("location")).toBe(
		"https://thesuperhuman.us/next",
	);
	expectSecurityHeaders(response);
});
