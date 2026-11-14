import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { publicationOAuthRoute } from "~/server/publication-oauth";
import { GET, POST } from "~/pages/api/work-feed";
import { boundStatement } from "../helpers/d1";
import { double, fakeKv, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import { testRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// How the publication routes answer when storage fails. The owner's decisions (2026-11-14): an unexpected database or
// KV failure answers 500 with the route's fixed sentence and never the error's own text; a lost race stays 409; a
// missing binding is a deliberate 503. Real SQLite with the publication migrations; nothing is mocked.

const TOKEN = "feed-token";

const envelope: JsonObject = {
	version: 1,
	projectId: "threadline",
	eventId: "evt-1",
	entryId: "entry-1",
	expectedRevision: 0,
	operation: "publish",
	origin: "work",
	occurredOn: "2026-11-12",
	threadId: null,
	milestoneId: null,
	story: {
		headline: "Search is faster",
		summary: "Searching a project now answers in under a second.",
		technicalDetail: null,
		delivery: "available",
		basis: "repository-verified",
	},
};

function world(failOn?: RegExp) {
	const sql = new DatabaseSync(":memory:");

	for (const file of [
		"0001_publication_journal.sql",
		"0002_publication_outbox.sql",
	])
		sql.exec(
			readFileSync(
				new URL(`../../migrations/publication/${file}`, import.meta.url),
				"utf8",
			),
		);
	const real = sqliteD1(sql);

	const db = double<D1Database>({
		prepare: (query: string) => real.prepare(query),
		batch: async <T>(items: D1PreparedStatement[]) => {
			if (
				failOn &&
				items.some((item) => failOn.test(boundStatement(item).query))
			)
				throw new Error("private database details for threadline");

			return real.batch<T>(items);
		},
	});

	return { sql, db };
}

function feed(
	method: "GET" | "POST",
	db: D1Database | undefined,
	body?: JsonObject,
) {
	return partial<APIContext>({
		request: new Request(
			"https://thesuperhuman.us/api/work-feed?project=threadline",
			{
				method,
				headers: { authorization: `Bearer ${TOKEN}` },
				body: body ? JSON.stringify(body) : undefined,
			},
		),
		url: new URL("https://thesuperhuman.us/api/work-feed?project=threadline"),
		locals: partial<APIContext["locals"]>({
			runtime: testRuntime({
				PUBLICATION_DB: db,
				PUBLICATION_PROJECTS: "threadline",
				PUBLICATION_TOKEN: TOKEN,
			}),
		}),
	});
}

describe("the work feed when the database fails", () => {
	it("answers a failed read with 500 and the fixed sentence, not the error's text", async () => {
		const { db } = world(/publication_events/);
		const response = await GET(feed("GET", db));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Updates unavailable." });
	});

	it("answers a failed delivery with 500 and the fixed sentence, not the error's text", async () => {
		const { db, sql } = world(/INSERT INTO publication_events/);
		const response = await POST(feed("POST", db, envelope));

		expect(response.status).toBe(500);
		expect(await response.text()).toBe(
			JSON.stringify({ error: "Delivery pending. Retry the same event." }),
		);
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM publication_events").get(),
		).toEqual({ n: 0 });
	});

	it("still answers 503 when the database is not bound", async () => {
		expect((await GET(feed("GET", undefined))).status).toBe(503);
		expect((await POST(feed("POST", undefined, envelope))).status).toBe(503);
	});
});

describe("the OAuth route when its KV namespace fails", () => {
	it("answers 500 with the fixed sentence and never the failure's text", async () => {
		const kv = fakeKv({
			get: async () => {
				throw new Error("private kv details");
			},
			put: async () => {
				throw new Error("private kv details");
			},
		});

		const response = await publicationOAuthRoute(
			partial<APIContext>({
				request: new Request(
					"https://thesuperhuman.us/api/publication/register",
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							redirect_uris: ["https://chatgpt.com/callback"],
							client_name: "Chat",
							token_endpoint_auth_method: "none",
						}),
					},
				),
				locals: partial<APIContext["locals"]>({
					runtime: partial<APIContext["locals"]["runtime"]>({
						env: partial<APIContext["locals"]["runtime"]["env"]>({
							OAUTH_KV: kv,
							PUBLICATION_DB: double<D1Database>({}),
							PUBLICATION_OWNER_ID: "10987837",
							PUBLICATION_PROJECTS: "threadline",
							PUBLICATION_GITHUB_CLIENT_ID: "client",
							PUBLICATION_GITHUB_CLIENT_SECRET: "secret",
							PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
						}),
						ctx: double<ExecutionContext>({ waitUntil() {} }),
					}),
				}),
			}),
		);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("Publication connection unavailable.");
	});
});

describe("values a visitor sends that would become part of a KV key", () => {
	/** A KV namespace that refuses a key over 512 bytes, as Cloudflare's does, and holds nothing else. */
	const strictKv = () =>
		fakeKv({
			get: async (key: string) => {
				if (new TextEncoder().encode(key).length > 512)
					throw new Error("KV GET failed: 414 UriTooLong");

				return null;
			},
			put: async (key: string) => {
				if (new TextEncoder().encode(key).length > 512)
					throw new Error("KV PUT failed: 414 UriTooLong");
			},
		});

	const call = (path: string, init?: RequestInit) =>
		publicationOAuthRoute(
			partial<APIContext>({
				request: new Request("https://thesuperhuman.us" + path, init),
				locals: partial<APIContext["locals"]>({
					runtime: partial<APIContext["locals"]["runtime"]>({
						env: partial<APIContext["locals"]["runtime"]["env"]>({
							OAUTH_KV: strictKv(),
							PUBLICATION_DB: double<D1Database>({}),
							PUBLICATION_OWNER_ID: "10987837",
							PUBLICATION_PROJECTS: "threadline",
							PUBLICATION_GITHUB_CLIENT_ID: "client",
							PUBLICATION_GITHUB_CLIENT_SECRET: "secret",
							PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
						}),
						ctx: double<ExecutionContext>({ waitUntil() {} }),
					}),
				}),
			}),
		);

	const long = "a".repeat(600);

	const form = (fields: { [name: string]: string }) => ({
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields),
	});

	it("answers a client id too long for a key as a refused request, not a server fault", async () => {
		const query = new URLSearchParams({
			response_type: "code",
			client_id: long,
			redirect_uri: "https://chatgpt.com/callback",
			scope: "publication:threadline",
		});

		const response = await call(`/api/publication/authorize?${query}`);

		expect(response.status).toBe(400);
	});

	it("answers a token request whose code, refresh token or client id is too long with a 4xx", async () => {
		const cases: { [name: string]: string }[] = [
			{ grant_type: "authorization_code", code: `1:2:${long}`, client_id: "c" },
			{
				grant_type: "refresh_token",
				refresh_token: `1:2:${long}`,
				client_id: "c",
			},
			{ grant_type: "authorization_code", code: "1:2:3", client_id: long },
		];

		for (const fields of cases) {
			const response = await call("/api/publication/token", form(fields));

			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(response.status).toBeLessThan(500);
		}
	});

	it("answers a bearer token too long for a key with a 4xx", async () => {
		const response = await call("/api/publication/mcp", {
			method: "POST",
			headers: { authorization: `Bearer 1:2:${long}` },
		});

		expect(response.status).toBe(401);
	});
});
