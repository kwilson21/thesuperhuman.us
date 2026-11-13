// Records what a route answers and every outside effect it makes, for the golden corpus (tests/golden/*.test.ts).
//
// A case is a list of requests sent in order to one route handler, against fake KV namespaces and a fake fetch, with a
// fixed clock and a fixed id for crypto.randomUUID. For each request the recorder keeps the status, the response headers
// and the exact body text, or "rejected" when the handler throws (Astro then answers its own 500). It also keeps every
// KV read, write and delete and every outgoing fetch, in the order they happened.
//
// The fixture files in tests/golden/fixtures are the answers of the routes as they were before the Effect conversion.
// A test compares against them and never writes them. They are written only when UPDATE_GOLDEN=1, and a converted
// route that differs from them is wrong: change the route, not the fixture.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { APIContext } from "astro";
import { expect, vi } from "vitest";
import { double, partial } from "../helpers/doubles";
import type { JsonValue } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";

export const FIXED_TIME = "2026-11-13T12:00:00.000Z";
export const FIXED_ID = "00000000-0000-4000-8000-000000000001";

/** One request to send to the handler. */
export type Step = {
	readonly url: string;
	readonly method?: string;
	/** Header names and values. Omit a header by leaving it out. */
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
};

/** What a fake KV namespace holds: text, or bytes for a binary read. */
export type Seed = Readonly<Record<string, string | ArrayBuffer>>;

/** How a fake KV namespace fails. A failing call rejects with an Error. */
export type KvFailure = {
	readonly get?: boolean;
	readonly put?: boolean;
	readonly delete?: boolean;
};

export type KvSetup = {
	/** The namespace is not bound at all (the env has no such member). */
	readonly missing?: boolean;
	readonly seed?: Seed;
	readonly fails?: KvFailure;
};

/** What an outgoing fetch gets back, or that it throws. */
export type FetchAnswer =
	| {
			readonly kind: "json";
			readonly ok: boolean;
			readonly status?: number;
			readonly json: JsonValue;
	  }
	| { readonly kind: "unreadable"; readonly ok: boolean }
	| { readonly kind: "throws" };

/** The answer for each outgoing fetch: the n-th call to that host, counting from 0. */
export type Responder = (call: {
	host: "turnstile" | "resend" | "other";
	n: number;
}) => FetchAnswer;

/** The env members a case sets or leaves out. The two KV namespaces have their own members on a case. */
type EnvText = Pick<
	Env,
	| "RESEND_API_KEY"
	| "TURNSTILE_SECRET_KEY"
	| "CONTACT_TO_EMAIL"
	| "CONTACT_FROM_EMAIL"
>;

export type Case = {
	readonly name: string;
	readonly steps: readonly Step[];
	/** Env members to add or change on top of the defaults. */
	readonly env?: Partial<EnvText>;
	/** Env members to remove, as a deployment that never set them. */
	readonly omit?: readonly (keyof EnvText)[];
	readonly rateLimit?: KvSetup;
	readonly resumeStore?: KvSetup;
	readonly fetches?: Responder;
};

export type Effect =
	| {
			readonly step: number;
			readonly kv: string;
			readonly op: "get";
			readonly key: string;
			readonly type: string | null;
	  }
	| {
			readonly step: number;
			readonly kv: string;
			readonly op: "put";
			readonly key: string;
			readonly value: string;
			readonly options: { readonly expirationTtl: number } | null;
	  }
	| {
			readonly step: number;
			readonly kv: string;
			readonly op: "delete";
			readonly key: string;
	  }
	| {
			readonly step: number;
			readonly fetch: {
				readonly url: string;
				readonly method: string | null;
				readonly headers: Readonly<Record<string, string>> | null;
				readonly body: string | null;
				readonly hasSignal: boolean;
			};
	  };

export type Answer =
	| {
			readonly outcome: "response";
			readonly status: number;
			readonly headers: Readonly<Record<string, string>>;
			readonly body: string;
	  }
	| { readonly outcome: "rejected" };

export type Recorded = {
	readonly name: string;
	readonly answers: readonly Answer[];
	readonly effects: readonly Effect[];
};

export const ok = (json: JsonValue = {}): FetchAnswer => ({
	kind: "json",
	ok: true,
	json,
});

export const status = (code: number, json: JsonValue = {}): FetchAnswer => ({
	kind: "json",
	ok: false,
	status: code,
	json,
});

export const throws = (): FetchAnswer => ({ kind: "throws" });

export const unreadable = (isOk = true): FetchAnswer => ({
	kind: "unreadable",
	ok: isOk,
});

/** Turnstile passes and Resend sends. */
export const allGood: Responder = ({ host }) =>
	host === "turnstile" ? ok({ success: true }) : ok({ id: "em_1" });

const DEFAULT_ENV: EnvText = {
	RESEND_API_KEY: "re_test_key",
	TURNSTILE_SECRET_KEY: "ts_test_secret",
	CONTACT_TO_EMAIL: "owner@example.test",
	CONTACT_FROM_EMAIL: "site@example.test",
};

type Log = Effect[];

function fakeNamespace(
	label: string,
	setup: KvSetup,
	log: Log,
	step: () => number,
	store: Map<string, string | ArrayBuffer>,
) {
	const fails = setup.fails ?? {};

	return double<KVNamespace>({
		// SAFETY: the routes call get with a key and, for the PDF, the "arrayBuffer" type; the fake answers the string or the bytes the store holds, which is what the overload they pick returns.
		get: (async (key: string, type?: string) => {
			log.push({ step: step(), kv: label, op: "get", key, type: type ?? null });

			if (fails.get) throw new Error("kv get failed");
			const held = store.get(key);

			if (held === undefined) return null;

			if (type === "arrayBuffer")
				return held instanceof ArrayBuffer ? held : null;

			return held instanceof ArrayBuffer ? null : held;
		}) as KVNamespace["get"],
		put: async (
			key: string,
			value: string | ArrayBuffer,
			options?: { expirationTtl: number },
		) => {
			log.push({
				step: step(),
				kv: label,
				op: "put",
				key,
				value: value instanceof ArrayBuffer ? "<bytes>" : value,
				options: options ?? null,
			});

			if (fails.put) throw new Error("kv put failed");
			store.set(key, value);
		},
		delete: async (key: string) => {
			log.push({ step: step(), kv: label, op: "delete", key });

			if (fails.delete) throw new Error("kv delete failed");
			store.delete(key);
		},
	});
}

function hostOf(url: string): "turnstile" | "resend" | "other" {
	if (url.includes("challenges.cloudflare.com")) return "turnstile";

	return url.includes("api.resend.com") ? "resend" : "other";
}

function headersOf(
	init: RequestInit | undefined,
): Record<string, string> | null {
	const given = init?.headers;

	if (!given) return null;

	return Object.fromEntries(new Headers(given).entries());
}

function bodyOf(init: RequestInit | undefined): string | null {
	const body = init?.body;

	if (body === undefined || body === null) return null;

	return String(body);
}

function fakeFetch(responder: Responder, log: Log, step: () => number) {
	const counts = { turnstile: 0, resend: 0, other: 0 };

	return vi.fn<typeof fetch>(async (input, init) => {
		const url = String(input);
		const host = hostOf(url);

		log.push({
			step: step(),
			fetch: {
				url,
				method: init?.method ?? null,
				headers: headersOf(init),
				body: bodyOf(init),
				hasSignal: init?.signal !== undefined && init.signal !== null,
			},
		});

		const answer = responder({ host, n: counts[host]++ });

		if (answer.kind === "throws") throw new Error("network down");

		if (answer.kind === "unreadable") {
			return double<Response>({
				ok: answer.ok,
				json: async () => {
					throw new SyntaxError("Unexpected token");
				},
			});
		}

		return double<Response>({
			ok: answer.ok,
			status: answer.status ?? (answer.ok ? 200 : 400),
			json: async () => answer.json,
		});
	});
}

function contextFor(
	c: Case,
	step: Step,
	namespaces: Record<"RATE_LIMIT" | "RESUME_STORE", KVNamespace | undefined>,
) {
	const env: Partial<Env> = {
		...DEFAULT_ENV,
		...c.env,
	};

	for (const name of c.omit ?? []) delete env[name];

	if (namespaces.RATE_LIMIT) env.RATE_LIMIT = namespaces.RATE_LIMIT;

	if (namespaces.RESUME_STORE) env.RESUME_STORE = namespaces.RESUME_STORE;

	return partial<APIContext>({
		request: new Request(step.url, {
			method: step.method ?? "POST",
			headers: step.headers,
			body: step.body,
		}),
		url: new URL(step.url),
		locals: partial<APIContext["locals"]>({
			runtime: partial<TestRuntime>({ env: partial<TestRuntime["env"]>(env) }),
		}),
	});
}

/** Fixes the clock and the id the routes generate. Call from beforeEach, and `thaw` from afterEach. */
export function freeze() {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(FIXED_TIME));
	vi.spyOn(crypto, "randomUUID").mockReturnValue(FIXED_ID);
}

export function thaw() {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
}

/** Sends every step of the case to the handler, in order, and records what it answered and did. */
export async function record(
	handler: (context: APIContext) => Response | Promise<Response>,
	c: Case,
): Promise<Recorded> {
	const log: Log = [];
	let current = 0;

	const step = () => current;

	const rateStore = new Map<string, string | ArrayBuffer>(
		Object.entries(c.rateLimit?.seed ?? {}),
	);

	const resumeStore = new Map<string, string | ArrayBuffer>(
		Object.entries(c.resumeStore?.seed ?? {}),
	);

	const namespaces = {
		RATE_LIMIT: c.rateLimit?.missing
			? undefined
			: fakeNamespace("RATE_LIMIT", c.rateLimit ?? {}, log, step, rateStore),
		RESUME_STORE: c.resumeStore?.missing
			? undefined
			: fakeNamespace(
					"RESUME_STORE",
					c.resumeStore ?? {},
					log,
					step,
					resumeStore,
				),
	};

	vi.stubGlobal("fetch", fakeFetch(c.fetches ?? allGood, log, step));

	const answers: Answer[] = [];

	for (const [index, request] of c.steps.entries()) {
		current = index;

		try {
			const response = await handler(contextFor(c, request, namespaces));

			answers.push({
				outcome: "response",
				status: response.status,
				headers: Object.fromEntries(
					[...response.headers.entries()].sort(([a], [b]) =>
						a.localeCompare(b),
					),
				),
				body: await response.text(),
			});
		} catch {
			answers.push({ outcome: "rejected" });
		}
	}

	return { name: c.name, answers, effects: log };
}

const UPDATING = process.env.UPDATE_GOLDEN === "1";

function fixturePath(area: string) {
	return new URL(`./fixtures/${area}.json`, import.meta.url);
}

function readFixture(area: string): Recorded[] {
	const path = fixturePath(area);

	if (!existsSync(path)) return [];

	// SAFETY: this file is written only by `writeFixture` below, as a JSON array of Recorded.
	return JSON.parse(readFileSync(path, "utf8")) as Recorded[];
}

const written = new Map<string, Recorded[]>();

/** Compares one recorded case with the fixture (or, with UPDATE_GOLDEN=1, keeps it to be written). */
export function expectRecorded(area: string, got: Recorded) {
	if (UPDATING) {
		written.set(area, [...(written.get(area) ?? []), got]);

		return;
	}

	const want = readFixture(area).find((entry) => entry.name === got.name);

	expect(want, `no recorded answer for "${got.name}"`).toBeDefined();
	expect(got).toEqual(want);
}

/** With UPDATE_GOLDEN=1, writes the fixture for the area. Otherwise checks it records exactly these case names. */
export function settleFixture(area: string, names: readonly string[]) {
	if (UPDATING) {
		writeFileSync(
			fixturePath(area),
			`${JSON.stringify(written.get(area) ?? [], null, "\t")}\n`,
		);

		return;
	}

	expect(readFixture(area).map((entry) => entry.name)).toEqual([...names]);
}
