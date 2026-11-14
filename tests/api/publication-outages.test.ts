import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { publicationOAuthRoute } from "~/lib/publication/oauth";
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
