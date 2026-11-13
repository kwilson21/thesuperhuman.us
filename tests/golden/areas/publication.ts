// Shared builders for the publication area: the work feed (src/pages/api/work-feed.ts), the OAuth and MCP route
// (src/pages/api/publication/[...path].ts) and the connectivity probe (src/pages/api/mcp-probe.ts).
import { createHash } from "node:crypto";
import type { APIContext } from "astro";
import { canonicalPublication } from "~/lib/publication/canonical";
import { afterEach, beforeEach, vi } from "vitest";
import { isText } from "~/lib/type-guards";
import { double, partial } from "../../helpers/doubles";
import type { JsonObject } from "../../helpers/json";
import {
	byHost,
	json,
	type Case,
	type FetchAnswer,
	type Handler,
	type SeedRow,
	type Step,
	type World,
} from "../harness";

export const TOKEN = "golden-publication-token";
export const PROJECTS = "threadline,other";
export const DAY = "2026-11-12";

/** The env every work-feed case gets: the bearer token and the project allowlist. */
export const FEED_ENV = {
	PUBLICATION_TOKEN: TOKEN,
	PUBLICATION_PROJECTS: PROJECTS,
} as const;

/**
 * publication_events.published_at defaults to SQLite's own clock, which a case cannot freeze. This trigger gives each
 * new row the time 2026-11-13 12:00:00 plus its revision in seconds, so the receipt and the table dump are identical
 * on every run. It changes no statement the route runs and no value the route reads except that column. Rows a case
 * seeds are not touched (they carry their own published_at).
 */
export function pinPublishedAt(world: World) {
	world.publication.exec(`CREATE TRIGGER golden_pin_published_at AFTER INSERT ON publication_events
    BEGIN
      UPDATE publication_events
      SET published_at = strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-13 12:00:00', '+' || NEW.revision || ' seconds')
      WHERE rowid = NEW.rowid;
    END`);
}

export const story = (over: JsonObject = {}): JsonObject => ({
	headline: "Search is faster",
	summary: "Searching a project now answers in under a second.",
	technicalDetail: "Added an index on the project column.",
	delivery: "available",
	basis: "repository-verified",
	...over,
});

/** A valid publication envelope. A member given as `undefined` is left out of the body. */
export const pub = (over: JsonObject = {}): JsonObject => ({
	version: 1,
	projectId: "threadline",
	eventId: "evt-1",
	entryId: "entry-1",
	expectedRevision: 0,
	operation: "publish",
	origin: "work",
	occurredOn: DAY,
	threadId: null,
	milestoneId: null,
	story: story(),
	...over,
});

export const withdraw = (over: JsonObject = {}): JsonObject =>
	pub({ operation: "withdraw", story: null, ...over });

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * A publication_events row as the journal would have stored it for this envelope: canonical payload, its hash and the
 * given revision. A withdrawal's payload is NULL (content erased); pass `erased: true` to erase any other row.
 */
export function event(
	envelope: JsonObject,
	revision: number,
	over: SeedRow = {},
	erased = false,
): SeedRow {
	const payload = canonicalPublication(envelope);

	return {
		project_id: String(envelope.projectId),
		event_id: String(envelope.eventId),
		entry_id: String(envelope.entryId),
		revision,
		operation: String(envelope.operation),
		origin: String(envelope.origin),
		payload_hash: sha(payload),
		payload: erased || envelope.operation === "withdraw" ? null : payload,
		published_at: `2026-11-13T11:00:${String(revision).padStart(2, "0")}.000Z`,
		...over,
	};
}

export const TABLES = ["publication_events", "publication_outbox"];

export const auth = { authorization: `Bearer ${TOKEN}` };

/** One POST to the work feed with the bearer token. */
export const post = (body: JsonObject, extra: Partial<Step> = {}): Step => ({
	path: "/api/work-feed",
	headers: auth,
	json: body,
	dump: { publication: TABLES },
	...extra,
});

/** One POST to the work feed whose body is this exact text. */
export const raw = (text: string, extra: Partial<Step> = {}): Step => ({
	path: "/api/work-feed",
	headers: auth,
	body: text,
	dump: { publication: TABLES },
	...extra,
});

export const read = (project: string, extra: Partial<Step> = {}): Step => ({
	method: "GET",
	path: `/api/work-feed?project=${project}`,
	...extra,
});

/** A work-feed case: the env and the published_at pin every one of them needs. */
export function feedCase(c: Case): Case {
	return {
		...c,
		env: { ...FEED_ENV, ...c.env },
		setup: async (world) => {
			pinPublishedAt(world);
			await c.setup?.(world);
		},
	};
}

/** A handler that sends the route a different request than the step describes (another origin, raw bytes, a stream). */
export function via(
	route: Handler,
	rewrite: (request: Request) => Request,
): Handler {
	return (context) =>
		route(
			partial<APIContext>({ ...context, request: rewrite(context.request) }),
		);
}

/** The same request at another origin. */
export const atOrigin = (origin: string) => (request: Request) => {
	const url = new URL(request.url);

	return new Request(new URL(url.pathname + url.search, origin), request);
};

/** The same request with the body replaced by these bytes (an invalid UTF-8 body a string cannot carry). */
export const withBytes =
	(bytes: Uint8Array<ArrayBuffer>) => (request: Request) =>
		new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bytes,
		});

/** The same request with the body replaced by a stream of chunks and no Content-Length. */
export const withChunks =
	(chunks: readonly Uint8Array<ArrayBuffer>[]) => (request: Request) => {
		const init = {
			method: request.method,
			headers: request.headers,
			body: new ReadableStream<Uint8Array<ArrayBuffer>>({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(chunk);

					controller.close();
				},
			}),
			// A streamed request body needs this in Node's fetch; the Workers RequestInit type does not list it.
			duplex: "half",
		};

		return new Request(request.url, init);
	};

// ------------------------------------------------------------------ OAuth and MCP

export const OWNER_GITHUB_ID = "10987837";
export const REDIRECT = "https://chatgpt.com/callback";
export const RESOURCE = "https://thesuperhuman.us/api/publication/mcp";
export const SCOPES = "publication:threadline publication:other";
export const VERIFIER = "v".repeat(43);

export const CHALLENGE = createHash("sha256")
	.update(VERIFIER)
	.digest("base64url");

/** The six settings the OAuth route needs (OAUTH_KV is a binding, set through `kv`), plus the project allowlist. */
export const OAUTH_ENV = {
	PUBLICATION_OWNER_ID: OWNER_GITHUB_ID,
	PUBLICATION_PROJECTS: PROJECTS,
	PUBLICATION_GITHUB_CLIENT_ID: "gh-client-id",
	PUBLICATION_GITHUB_CLIENT_SECRET: "gh-client-secret",
	PUBLICATION_COOKIE_KEY: btoa("k".repeat(32)),
} as const;

type KvGet = (
	key: string,
	type?: string | { type?: string },
) => Promise<string | null>;

/**
 * The harness KV answers `get(key, { type: "json" })` with the stored text, not the parsed value (a harness gap: see the
 * report). The OAuth library reads every record that way. This adapter calls the harness namespace with exactly the
 * arguments the library passed, so the recorded `get` keeps `type: "json"`, and parses the text it gets back, as real
 * KV does. put, delete and list pass through unchanged.
 */
function jsonKv(kv: KVNamespace): KVNamespace {
	// SAFETY: the harness namespace's get takes a key and an optional type (a string or an options object) and answers the stored text or null; the overloads of KVNamespace["get"] describe that same function for each type.
	const read = kv.get.bind(kv) as KvGet;

	return double<KVNamespace>({
		// SAFETY: the library calls get(key) for text and get(key, { type: "json" }) for records; the adapter answers a string or the parsed JSON, as the overload it picked returns.
		get: (async (key: string, type?: string | { type?: string }) => {
			const held = await read(key, type);
			const kind = isText(type) ? type : type?.type;

			return kind === "json" && isText(held) ? JSON.parse(held) : held;
		}) as KVNamespace["get"],
		put: (key: string, value: string, options?: KVNamespacePutOptions) =>
			kv.put(key, value, options),
		delete: (key: string) => kv.delete(key),
		list: (options?: KVNamespaceListOptions) => kv.list(options),
	});
}

type Capture = (response: Response) => Promise<string>;

/** What a step of a flow reads from the answer and keeps for later steps. */
export const fromJson =
	(field: string): Capture =>
	async (response) => {
		const body: { [name: string]: string | number } = JSON.parse(
			await response.text(),
		);

		return String(body[field]);
	};

export const fromBody =
	(pattern: RegExp): Capture =>
	async (response) =>
		pattern.exec(await response.text())?.[1] ?? "NOT-FOUND";

export const fromLoginCookie: Capture = async (response) =>
	/__Host-publication-login=([^;]*)/.exec(
		response.headers.getSetCookie().join("\n"),
	)?.[1] ?? "NOT-FOUND";

export const fromLocation =
	(name: string): Capture =>
	async (response) =>
		new URL(
			response.headers.get("location") ?? "https://none.test",
		).searchParams.get(name) ?? "NOT-FOUND";

/** A captured cookie with one character of its ciphertext changed, so its authentication tag no longer matches. */
export const tampered =
	(capture: Capture): Capture =>
	async (response) => {
		const value = await capture(response);
		const at = value.indexOf(".") + 5;

		return `${value.slice(0, at)}${value[at] === "A" ? "B" : "A"}${value.slice(at + 1)}`;
	};

/** A captured cookie cut after its dot. */
export const withoutCiphertext =
	(capture: Capture): Capture =>
	async (response) =>
		(await capture(response)).split(".")[0];

export type FlowStep = {
	readonly path: string;
	readonly method?: string;
	readonly headers?: { readonly [name: string]: string };
	/** A raw text body. */
	readonly body?: string;
	readonly advanceMs?: number;
	readonly dump?: Step["dump"];
	readonly capture?: { readonly [name: string]: Capture };
	/** Replace the request's URL origin, for a request that is not at the site's own origin. */
	readonly origin?: string;
	/** Env text members to set (or, with undefined, remove) just before this request, as a redeploy between two requests. */
	readonly env?: { readonly [name: string]: string | undefined };
};

/**
 * A run of requests where a later one needs a value an earlier answer made (a client id, a cookie, a code, a token).
 * Write `~name~` in a path, header value or body and it is replaced, before the request is sent, with the value an
 * earlier step captured under that name. The fixture keeps the request as written (with the marker) and records the
 * answers and every outside effect with the real values; every value is deterministic because the harness seeds
 * crypto.getRandomValues and freezes the clock. One Flow belongs to one case.
 */
export class Flow {
	private readonly vars = new Map<string, string>();
	private readonly adapted = new WeakSet<KVNamespace>();

	constructor(private readonly route: Handler) {}

	/** Gives a name a value without a request (a client a case seeded into KV). */
	set(name: string, value: string) {
		this.vars.set(name, value);
	}

	private fill(text: string): string {
		return text.replace(/(?:~|%7E)(\w+)(?:~|%7E)/gi, (_, name: string) => {
			const value = this.vars.get(name);

			if (value === undefined)
				throw new Error(`golden flow: no value was captured for ~${name}~`);

			return value;
		});
	}

	step(spec: FlowStep): Step {
		return {
			method: spec.method ?? "GET",
			path: spec.path,
			headers: spec.headers,
			body: spec.body,
			advanceMs: spec.advanceMs,
			dump: spec.dump,
			handler: async (context) => {
				const method = context.request.method;
				const headers = new Headers();

				for (const [name, value] of context.request.headers)
					headers.set(name, this.fill(value));

				const text =
					method === "GET" || method === "HEAD"
						? undefined
						: this.fill(await context.request.text());

				const filled = new URL(this.fill(context.request.url));

				const url = spec.origin
					? new URL(filled.pathname + filled.search, spec.origin)
					: filled;

				const env = context.locals.runtime.env;

				for (const [name, value] of Object.entries(spec.env ?? {}))
					if (value === undefined) Reflect.deleteProperty(env, name);
					else Reflect.set(env, name, value);

				const original = env.OAUTH_KV;

				if (original && !this.adapted.has(original)) {
					const adapter = jsonKv(original);
					this.adapted.add(adapter);
					env.OAUTH_KV = adapter;
				}

				const response = await this.route(
					partial<APIContext>({
						...context,
						request: new Request(url, { method, headers, body: text }),
					}),
				);

				for (const [name, capture] of Object.entries(spec.capture ?? {}))
					this.vars.set(name, await capture(response.clone()));

				return response;
			},
		};
	}
}

const FORM = { "content-type": "application/x-www-form-urlencoded" };
const SITE = "https://thesuperhuman.us";

const login = (cookie: string) => ({
	cookie: `__Host-publication-login=~${cookie}~`,
});

export const form = (fields: { readonly [name: string]: string }) =>
	new URLSearchParams(fields).toString();

/** Form fields with these changes: a value replaces the field, null removes it. */
function formWith(
	fields: { readonly [name: string]: string },
	over: { readonly [name: string]: string | null },
) {
	const merged = new URLSearchParams(fields);

	for (const [name, value] of Object.entries(over))
		if (value === null) merged.delete(name);
		else merged.set(name, value);

	return merged.toString();
}

/** The steps that connect a chat client, one by one, so a case can change or repeat any of them. */
export function connection(f: Flow) {
	const authorizeUrl = (
		over: { readonly [name: string]: string | null } = {},
	) => {
		const params = new URLSearchParams({
			response_type: "code",
			client_id: "~client~",
			redirect_uri: REDIRECT,
			scope: SCOPES,
			resource: RESOURCE,
			state: "client-state",
			code_challenge: CHALLENGE,
			code_challenge_method: "S256",
		});

		for (const [name, value] of Object.entries(over))
			if (value === null) params.delete(name);
			else params.set(name, value);

		return `/api/publication/authorize?${params}`;
	};

	return {
		register: (
			over: { readonly [name: string]: string | string[] | null } = {},
			capture = true,
		) => {
			const fields = Object.fromEntries(
				Object.entries({
					client_name: "test-chat",
					redirect_uris: [REDIRECT],
					token_endpoint_auth_method: "none",
					...over,
				}).filter(([, value]) => value !== null),
			);

			return f.step({
				method: "POST",
				path: "/api/publication/register",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(fields),
				capture: capture ? { client: fromJson("client_id") } : {},
			});
		},
		authorize: (over: { readonly [name: string]: string | null } = {}) =>
			f.step({
				path: authorizeUrl(over),
				capture: {
					login: fromLoginCookie,
					loginTampered: tampered(fromLoginCookie),
					loginCut: withoutCiphertext(fromLoginCookie),
					nonce: fromBody(/name="nonce" value="([^"]+)"/),
				},
			}),
		consent: (extra: Partial<FlowStep> = {}) =>
			f.step({
				method: "POST",
				path: "/api/publication/authorize",
				headers: { ...FORM, origin: SITE, ...login("login") },
				body: form({ nonce: "~nonce~" }),
				capture: { approved: fromLoginCookie },
				...extra,
			}),
		callback: (extra: Partial<FlowStep> = {}) =>
			f.step({
				path: "/api/publication/callback?code=github-code&state=~nonce~",
				headers: login("approved"),
				capture: { code: fromLocation("code") },
				...extra,
			}),
		token: (
			over: { readonly [name: string]: string | null } = {},
			extra: Partial<FlowStep> = {},
		) =>
			f.step({
				method: "POST",
				path: "/api/publication/token",
				headers: FORM,
				body: formWith(
					{
						grant_type: "authorization_code",
						client_id: "~client~",
						code: "~code~",
						code_verifier: VERIFIER,
						redirect_uri: REDIRECT,
						resource: RESOURCE,
					},
					over,
				),
				capture: {
					access: fromJson("access_token"),
					refresh: fromJson("refresh_token"),
				},
				...extra,
			}),
		refresh: (
			over: { readonly [name: string]: string | null } = {},
			extra: Partial<FlowStep> = {},
		) =>
			f.step({
				method: "POST",
				path: "/api/publication/token",
				headers: FORM,
				body: formWith(
					{
						grant_type: "refresh_token",
						client_id: "~client~",
						refresh_token: "~refresh~",
						resource: RESOURCE,
					},
					over,
				),
				capture: {
					access2: fromJson("access_token"),
					refresh2: fromJson("refresh_token"),
				},
				...extra,
			}),
	};
}

/** A JSON-RPC call to the MCP endpoint with a bearer token captured under `token` (default `access`). */
export function rpc(
	f: Flow,
	method: string,
	params: JsonObject = {},
	extra: Partial<FlowStep> & { readonly token?: string | null } = {},
) {
	const { token = "~access~", ...rest } = extra;

	const given = new Headers({
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
	});

	if (token !== null) given.set("authorization", `Bearer ${token}`);

	const headers = Object.fromEntries(given);

	return f.step({
		method: "POST",
		path: "/api/publication/mcp",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		...rest,
	});
}

export const toolCall = (
	f: Flow,
	name: string,
	args: JsonObject,
	extra: Partial<FlowStep> & { readonly token?: string | null } = {},
) => rpc(f, "tools/call", { name, arguments: args }, extra);

/** GitHub's two answers: the token exchange and the signed-in user. */
export const github = (answers: {
	readonly token?: FetchAnswer;
	readonly user?: FetchAnswer;
}) =>
	byHost({
		"github.com": answers.token ?? json(200, { access_token: "gh-upstream" }),
		"api.github.com":
			answers.user ?? json(200, { id: Number(OWNER_GITHUB_ID) }),
	});

/** A client record as registration stores it, for a case that starts with a client already registered. */
export const SEEDED_CLIENT = "seeded-client";

export const seededClient = JSON.stringify({
	clientId: SEEDED_CLIENT,
	redirectUris: [REDIRECT],
	clientName: "test-chat",
	grantTypes: ["authorization_code"],
	responseTypes: ["code"],
	registrationDate: 1794571200,
	tokenEndpointAuthMethod: "none",
	authMethodExplicit: true,
	registrationExpiresAt: 1802347200,
});

/** An OAuth case: the six settings, a bound OAUTH_KV, the published_at pin and a GitHub that answers as the owner. */
export function oauthCase(c: Case): Case {
	return {
		...c,
		env: { ...OAUTH_ENV, ...c.env },
		kv: { OAUTH_KV: {}, ...c.kv },
		fetches: c.fetches ?? github({}),
		setup: async (world) => {
			pinPublishedAt(world);
			await c.setup?.(world);
		},
	};
}

/**
 * The OAuth library makes a new AES key with crypto.subtle.generateKey for every grant and token, and keeps it,
 * wrapped, in the KV records. WebCrypto draws that key from its own source, which the harness cannot seed, so without
 * this the KV records differ on every run. This makes generateKey answer one fixed key (32 bytes of 7). Only the key
 * is fixed: the library's own calls, their order and every other value are unchanged. Call it before each case and
 * restore the returned spy after.
 */
export function pinGeneratedKeys() {
	return vi
		.spyOn(crypto.subtle, "generateKey")
		.mockImplementation(() =>
			crypto.subtle.importKey(
				"raw",
				new Uint8Array(32).fill(7),
				"AES-GCM",
				true,
				["encrypt", "decrypt"],
			),
		);
}

/** Everything an OAuth case file shares: the case builders and the per-case pin of generated keys. */
export function oauthKit(route: Handler) {
	let restoreKeys = () => {};

	beforeEach(() => {
		const spy = pinGeneratedKeys();
		restoreKeys = () => spy.mockRestore();
	});

	afterEach(() => restoreKeys());

	const run = (
		build: (f: Flow, c: ReturnType<typeof connection>) => Step[],
	): Step[] => {
		const f = new Flow(route);

		return build(f, connection(f));
	};

	const oc = (name: string, steps: Step[], c: Partial<Case> = {}): Case =>
		oauthCase({ name, steps, ...c });

	/** Register, authorize, consent, GitHub callback and token: a connected client with an access token. */
	const connect = (
		f: Flow,
		c: ReturnType<typeof connection>,
		scope = SCOPES,
	) => [
		c.register(),
		c.authorize({ scope }),
		c.consent(),
		c.callback(),
		c.token(),
	];

	/** Records what OAUTH_KV holds at the end of a case. */
	const withKv = (list: Case[]): Case[] =>
		list.map((c) => ({ ...c, final: { kv: ["OAUTH_KV"] } }));

	return { run, oc, connect, withKv };
}
