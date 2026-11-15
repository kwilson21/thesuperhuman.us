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

describe("the work feed over a stored text that is not valid JSON", () => {
	const withdrawal: JsonObject = {
		...envelope,
		eventId: "evt-2",
		expectedRevision: 1,
		operation: "withdraw",
		story: null,
	};

	it("answers a shown entry's corrupt text with 500 and the fixed sentence", async () => {
		const { db, sql } = world();

		expect((await POST(feed("POST", db, envelope))).status).toBe(200);
		sql.exec("UPDATE publication_events SET payload='not json {'");
		const response = await GET(feed("GET", db));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Updates unavailable." });
	});

	it("does not read the corrupt text of an entry that was withdrawn", async () => {
		const { db, sql } = world();

		expect((await POST(feed("POST", db, envelope))).status).toBe(200);
		expect((await POST(feed("POST", db, withdrawal))).status).toBe(200);
		// The withdrawal erased the text; a corrupt one left behind on the publish event is never read.
		sql.exec(
			"UPDATE publication_events SET payload='not json {' WHERE revision=1",
		);
		const response = await GET(feed("GET", db));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ current: null, history: [] });
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
	/**
	 * A namespace that holds what is put in it and refuses a key over 512 bytes as Cloudflare's does, on every operation.
	 * `keys` lists the key of every operation that reached it, so a test can show that none was too long.
	 */
	const strictKv = () => {
		const store = new Map<string, string>();
		const keys: string[] = [];

		const checked = (key: string, operation: string) => {
			keys.push(key);

			if (new TextEncoder().encode(key).length > 512)
				throw new Error(`KV ${operation} failed: 414 UriTooLong`);
		};

		const kv = fakeKv({
			get: async (key: string, options?: string) => {
				checked(key, "GET");
				const held = store.get(key);

				if (held === undefined) return null;

				return options === undefined ? held : JSON.parse(held);
			},
			put: async (key: string, value: string) => {
				checked(key, "PUT");
				store.set(key, value);
			},
			delete: async (key: string) => {
				checked(key, "DELETE");
				store.delete(key);
			},
			list: async (options: { prefix?: string }) => {
				checked(options.prefix ?? "", "LIST");

				return {
					keys: [...store.keys()].flatMap((name) =>
						name.startsWith(options.prefix ?? "") ? [{ name }] : [],
					),
					list_complete: true,
				};
			},
		});

		return { kv, keys };
	};

	const setup = () => {
		const { kv, keys } = strictKv();

		const call = (path: string, init?: RequestInit) =>
			publicationOAuthRoute(
				partial<APIContext>({
					request: new Request("https://thesuperhuman.us" + path, init),
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

		return { call, keys };
	};

	type Setup = ReturnType<typeof setup>;

	/** A public client registered through the route, so the token endpoint has a client to find. */
	async function registered(call: Setup["call"]): Promise<string> {
		const response = await call("/api/publication/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				redirect_uris: ["https://chatgpt.com/callback"],
				client_name: "Chat",
				token_endpoint_auth_method: "none",
			}),
		});

		const body = await response.json<{ client_id: string }>();

		return body.client_id;
	}

	/** What a visitor sees: the status, the body and the challenge. */
	async function seen(response: Response) {
		return {
			status: response.status,
			body: await response.text(),
			challenge: response.headers.get("www-authenticate"),
		};
	}

	const tooLong = (keys: string[]) =>
		keys.filter((key) => new TextEncoder().encode(key).length > 512);

	const long = "a".repeat(600);

	const form = (
		fields: Iterable<[string, string]>,
		headers: { [name: string]: string } = {},
	) => ({
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			...headers,
		},
		body: new URLSearchParams([...fields]),
	});

	const authorize = (clientId: string) =>
		`/api/publication/authorize?${new URLSearchParams({
			response_type: "code",
			client_id: clientId,
			redirect_uri: "https://chatgpt.com/callback",
			scope: "publication:threadline",
		})}`;

	/** Each path the library reads a key from, with the long value and the short unknown value it must answer as. */
	it("answers a client id too long for a key on /authorize as it answers an unknown client", async () => {
		const { call, keys } = setup();

		const unknown = await seen(await call(authorize("nobody")));
		const answer = await seen(await call(authorize(long)));

		expect(answer).toEqual(unknown);
		expect(answer.status).toBe(400);
		expect(tooLong(keys)).toEqual([]);
	});

	it("answers a code, a client id and a refresh token too long for a key as the library refuses any invalid one", async () => {
		const { call, keys } = setup();
		const client = await registered(call);

		const cases: {
			long: [string, string][];
			short: [string, string][];
			status: number;
		}[] = [
			{
				long: [
					["grant_type", "authorization_code"],
					["code", `${long}:2:3`],
					["client_id", client],
				],
				short: [
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", client],
				],
				status: 400,
			},
			{
				long: [
					["grant_type", "refresh_token"],
					["refresh_token", `${long}:2:3`],
					["client_id", client],
				],
				short: [
					["grant_type", "refresh_token"],
					["refresh_token", "1:2:3"],
					["client_id", client],
				],
				status: 400,
			},
			{
				long: [
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", long],
				],
				short: [
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", "nobody"],
				],
				status: 401,
			},
		];

		for (const { long: sent, short, status } of cases) {
			const answer = await seen(
				await call("/api/publication/token", form(sent)),
			);

			expect(answer).toEqual(
				await seen(await call("/api/publication/token", form(short))),
			);
			expect(answer.status).toBe(status);
		}

		expect(tooLong(keys)).toEqual([]);
	});

	it("answers a client id too long for a key in a Basic header, whatever its length, scheme spelling or separator", async () => {
		const { call, keys } = setup();

		for (const scheme of ["Basic ", "basic ", "Basic\t", "BASIC "])
			for (const size of [700, 2000]) {
				const header = (id: string) => `${scheme}${btoa(`${id}:secret`)}`;

				const unknown = await seen(
					await call(
						"/api/publication/token",
						form(
							[
								["grant_type", "authorization_code"],
								["code", "1:2:3"],
							],
							{
								authorization: header("nobody"),
							},
						),
					),
				);

				const answer = await seen(
					await call(
						"/api/publication/token",
						form(
							[
								["grant_type", "authorization_code"],
								["code", "1:2:3"],
							],
							{
								authorization: header("a".repeat(size)),
							},
						),
					),
				);

				expect(answer).toEqual(unknown);
				expect(answer.status).toBe(401);
			}

		expect(tooLong(keys)).toEqual([]);
	});

	it("answers a client assertion whose issuer is too long for a key as one from an unknown client", async () => {
		const { call, keys } = setup();

		const part = (value: { [name: string]: string }) =>
			btoa(JSON.stringify(value)).replaceAll("=", "");

		const assertion = (issuer: string) =>
			[
				part({ alg: "RS256", typ: "JWT" }),
				part({ iss: issuer, sub: issuer }),
				"c2ln",
			].join(".");

		const assert = (issuer: string) =>
			call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					[
						"client_assertion_type",
						"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
					],
					["client_assertion", assertion(issuer)],
				]),
			);

		const unknown = await seen(await assert("nobody"));
		const answer = await seen(await assert(long));

		expect(answer).toEqual(unknown);
		expect(answer.status).toBe(401);
		expect(answer.body).toContain("Client not found");
		expect(tooLong(keys)).toEqual([]);
	});

	it("answers a revocation of a token too long for a key as it answers any unknown token", async () => {
		const { call, keys } = setup();
		const client = await registered(call);

		const revoke = (token: string) =>
			call(
				"/api/publication/token",
				form([
					["token", token],
					["client_id", client],
				]),
			);

		const unknown = await seen(await revoke("1:2:3"));
		const answer = await seen(await revoke(`${long}:2:3`));

		expect(answer).toEqual(unknown);
		expect(answer.status).toBe(200);
		expect(tooLong(keys)).toEqual([]);
	});

	it("answers a bearer token whose user part is too long for a key as it answers any unknown token", async () => {
		const { call, keys } = setup();

		const bearer = (token: string) =>
			call("/api/publication/mcp", {
				method: "POST",
				headers: { authorization: `Bearer ${token}` },
			});

		const unknown = await seen(await bearer("1:2:3"));
		const answer = await seen(await bearer(`${long}:2:3`));

		expect(answer).toEqual(unknown);
		expect(answer.status).toBe(401);
		expect(tooLong(keys)).toEqual([]);
	});

	it("leaves repeated and empty parameters to the library", async () => {
		const { call, keys } = setup();
		const client = await registered(call);

		const repeated = await seen(
			await call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "a"],
					["code", "b"],
					["client_id", client],
				]),
			),
		);

		expect(repeated.status).toBe(400);
		expect(repeated.body).toContain(
			'Request parameter \\"code\\" must not be repeated',
		);

		const once = await seen(
			await call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", client],
				]),
			),
		);

		const emptyFirst = await seen(
			await call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", ""],
					["client_id", client],
				]),
			),
		);

		expect(emptyFirst).toEqual(once);
		expect(emptyFirst.status).toBe(400);

		const unknown = await seen(
			await call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", "nobody"],
				]),
			),
		);

		const emptyThenLong = await seen(
			await call(
				"/api/publication/token",
				form([
					["grant_type", "authorization_code"],
					["code", "1:2:3"],
					["client_id", ""],
					["client_id", long],
				]),
			),
		);

		expect(emptyThenLong).toEqual(unknown);
		expect(tooLong(keys)).toEqual([]);
	});
});
