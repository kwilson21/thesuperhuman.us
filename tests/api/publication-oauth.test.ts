import type { APIContext } from "astro";
import { it, expect, vi } from "vitest";
import { publicationOAuthRoute } from "~/lib/publication/oauth";
import { double, partial, fakeKv } from "../helpers/doubles";
import { readJson } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";

/** A KV read names its value type either as a string or as an options object with a type member. */
function isJsonOptions(
	type: string | { type: string } | undefined,
): type is { type: string } {
	return typeof type === "object";
}

it("serves discovery, registers clients, and rejects missing/invalid bearer tokens using the real OAuth library", async () => {
	const values = new Map<string, string>();

	const kv = fakeKv({
		put: async (key: string, value: string) => {
			values.set(key, value);
		},
		get: async (key: string, type?: string | { type: string }) => {
			const value = values.get(key) ?? null;

			return value &&
				(type === "json" || (isJsonOptions(type) && type.type === "json"))
				? JSON.parse(value)
				: value;
		},
		delete: async (key: string) => {
			values.delete(key);
		},
		list: async () => ({ keys: [], list_complete: true }),
	});

	const env: Partial<TestRuntime["env"]> = {
		OAUTH_KV: kv,
		PUBLICATION_DB: double<D1Database>({}),
		PUBLICATION_OWNER_ID: "10987837",
		PUBLICATION_PROJECTS: "threadline,other",
		PUBLICATION_GITHUB_CLIENT_ID: "test-client",
		PUBLICATION_GITHUB_CLIENT_SECRET: "test-secret",
		PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
	};

	const call = (path: string, init?: RequestInit) =>
		publicationOAuthRoute(
			partial<APIContext>({
				request: new Request("https://thesuperhuman.us" + path, init),
				locals: {
					runtime: partial<TestRuntime>({
						env: partial<TestRuntime["env"]>(env),
						ctx: double<ExecutionContext>({ waitUntil() {} }),
					}),
				},
			}),
		);

	const meta = await call(
		"/.well-known/oauth-protected-resource/api/publication/mcp",
	);

	expect(meta.status).toBe(200);
	expect((await readJson<{ resource: string }>(meta)).resource).toBe(
		"https://thesuperhuman.us/api/publication/mcp",
	);
	const server = await call("/.well-known/oauth-authorization-server");
	expect(
		(await readJson<{ code_challenge_methods_supported: string[] }>(server))
			.code_challenge_methods_supported,
	).toContain("S256");

	const registration = await call("/api/publication/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_name: "test-chat",
			redirect_uris: ["https://chatgpt.com/callback"],
			token_endpoint_auth_method: "none",
		}),
	});

	expect(registration.status).toBe(201);

	const clientId = (await readJson<{ client_id: string }>(registration))
		.client_id;

	expect(clientId).toBeTruthy();

	for (const authorization of ["", "Bearer invalid"]) {
		const denied = await call("/api/publication/mcp", {
			method: "POST",
			headers: {
				authorization,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: "{}",
		});

		expect(denied.status).toBe(401);
		expect(denied.headers.get("www-authenticate")).toContain(
			"oauth-protected-resource",
		);
	}

	expect(
		(
			await call("/api/publication/register", {
				method: "POST",
				body: "x".repeat(32769),
			})
		).status,
	).toBe(413);
	const verifier = "v".repeat(43);

	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: "https://chatgpt.com/callback",
		scope: "publication:threadline publication:other",
		resource: "https://thesuperhuman.us/api/publication/mcp",
		state: "client-state",
		code_challenge: challenge,
		code_challenge_method: "S256",
	});

	const page = await call("/api/publication/authorize?" + params);
	expect(page.status).toBe(200);
	const nonce = /name="nonce" value="([^"]+)"/.exec(await page.text())![1];

	const consent = await call("/api/publication/authorize", {
		method: "POST",
		headers: {
			origin: "https://thesuperhuman.us",
			cookie: page.headers.get("set-cookie")!.split(";")[0],
		},
		body: new URLSearchParams({ nonce }),
	});

	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ access_token: "upstream" }))
		.mockResolvedValueOnce(Response.json({ id: 10987837 }));

	vi.stubGlobal("fetch", fetcher);
	let callback: Response;

	try {
		callback = await call(
			"/api/publication/callback?code=github-code&state=" + nonce,
			{ headers: { cookie: consent.headers.get("set-cookie")!.split(";")[0] } },
		);
	} finally {
		vi.unstubAllGlobals();
	}

	expect(callback!.status).toBe(302);

	const code = new URL(callback!.headers.get("location")!).searchParams.get(
		"code",
	)!;

	const tokens = await call("/api/publication/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			code_verifier: verifier,
			redirect_uri: "https://chatgpt.com/callback",
			resource: "https://thesuperhuman.us/api/publication/mcp",
		}),
	});

	expect(tokens.status).toBe(200);
	const token = await readJson<{ refresh_token: string }>(tokens);

	const refresh = await call("/api/publication/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: token.refresh_token,
			scope: "publication:threadline",
			resource: "https://thesuperhuman.us/api/publication/mcp",
		}),
	});

	expect(refresh.status).toBe(200);
	const narrowed = await readJson<{ access_token: string }>(refresh);

	const denied = await call("/api/publication/mcp", {
		method: "POST",
		headers: {
			Authorization: "Bearer " + narrowed.access_token,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "get_project_progress",
				arguments: { projectId: "other" },
			},
		}),
	});

	expect(denied.status).toBe(200);
	expect(
		(await readJson<{ result: { content: { text: string }[] } }>(denied)).result
			.content[0].text,
	).toContain("forbidden");
});

it.each([
	"OAUTH_KV",
	"PUBLICATION_DB",
	"PUBLICATION_OWNER_ID",
	"PUBLICATION_GITHUB_CLIENT_ID",
	"PUBLICATION_GITHUB_CLIENT_SECRET",
	"PUBLICATION_COOKIE_KEY",
] as const)("answers 503 when %s is not configured", async (missing) => {
	const env: Partial<TestRuntime["env"]> = {
		OAUTH_KV: fakeKv({ get: async () => null }),
		PUBLICATION_DB: double<D1Database>({}),
		PUBLICATION_OWNER_ID: "10987837",
		PUBLICATION_GITHUB_CLIENT_ID: "test-client",
		PUBLICATION_GITHUB_CLIENT_SECRET: "test-secret",
		PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
	};

	delete env[missing];

	const response = await publicationOAuthRoute(
		partial<APIContext>({
			request: new Request(
				"https://thesuperhuman.us/.well-known/oauth-authorization-server",
			),
			locals: {
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>(env),
					ctx: double<ExecutionContext>({ waitUntil() {} }),
				}),
			},
		}),
	);

	expect(response.status).toBe(503);
	expect(await response.text()).toBe(
		"Publication connection is not configured.",
	);
});
