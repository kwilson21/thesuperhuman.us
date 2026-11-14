// The world one case runs in: databases with the real schema, an R2 bucket, KV namespaces, fetch, Workers AI, rate
// limits, ctx.waitUntil, a frozen clock, and the ordered effect log they all write to. Then the runner that sends a
// case's steps through a route handler and records what came back.
import type { APIContext } from "astro";
import { createHash } from "node:crypto";
import { afterAll, describe, it, vi } from "vitest";
import { isText } from "~/lib/type-guards";
import { double, partial } from "../../helpers/doubles";
import type { JsonObject, JsonValue } from "../../helpers/json";
import type { TestRuntime } from "../../helpers/runtime";
import type { SqliteDatabase } from "../../helpers/sqlite-d1";
import { POST as studioCode } from "~/pages/api/studio/code";
import { POST as studioSession } from "~/pages/api/studio/session";
import { actorLabel, asVisitor, OWNER_EMAIL, type Actor } from "./actors";
import { dump, freshMusicDb, freshPublicationDb, seed, type Seed } from "./db";
import { Determinism } from "./determinism";
import { drive } from "./settle";
import {
	recordingD1,
	SqlHooks,
	type InjectedFailure,
	type Interleave,
} from "./d1";
import { expectRecorded, settleFixture } from "./fixtures";
import { recordingKv, type KvSetup } from "./kv";
import { EffectLog, type Effect, type EffectState } from "./log";
import {
	byHost,
	json,
	recordingAi,
	recordingFetch,
	recordingRateLimit,
	trackedResponder,
	type AiAnswer,
	type Responder,
} from "./net";
import {
	byteRecord,
	drain,
	errorText,
	type ByteRecord,
	type Recorded,
} from "./plain";
import { recordingR2, type R2Setup } from "./r2";
import { DatabaseDigester, type DatabaseDigest } from "./digest";
import { Triggers, type MustNotFire, type OptionalTrigger } from "./triggers";

export type Handler = (context: APIContext) => Response | Promise<Response>;

const ORIGIN = "https://thesuperhuman.us";

/** The code key and the other env members every case gets, unless it changes or omits them. */
export const DEFAULT_ENV: Partial<Env> = {
	RESEND_API_KEY: "re_test_key",
	TURNSTILE_SECRET_KEY: "ts_test_secret",
	CONTACT_TO_EMAIL: "kazon@example.test",
	CONTACT_FROM_EMAIL: "site@example.test",
	SITE_ORIGIN: ORIGIN,
	OWNER_EMAIL,
	MUSIC_EVENTS_ENABLED: "true",
	AUDIO_CLIENT_PORTAL_ENABLED: "true",
	AUDIO_CLIENT_CODE_KEY: "golden-corpus-studio-code-key-0123456789",
	STRIPE_PAYMENTS_ENABLED: "true",
	STRIPE_SECRET_KEY: "sk_test_golden",
	STRIPE_WEBHOOK_SECRET: "whsec_golden",
};

/** Env members that are plain text, so a case can set or drop them. */
export type EnvText = {
	[Name in keyof Env as Env[Name] extends string | undefined
		? Name
		: never]?: Env[Name];
};

export type DbSetup = {
	/** The database is not bound at all (the env has no such member). */
	readonly missing?: boolean;
	readonly seed?: Seed;
};

/** Which tables to dump, per database, to record their rows. */
export type Dump = {
	readonly music?: readonly string[];
	readonly publication?: readonly string[];
	/** Record what the R2 bucket holds. */
	readonly r2?: boolean;
	/** Record what these KV namespaces hold. */
	readonly kv?: readonly KvName[];
};

export type KvName = "RATE_LIMIT" | "RESUME_STORE" | "OAUTH_KV";

export type RateLimitName =
	| "BRIEF_SUGGEST_RATE_LIMIT"
	| "BRIEF_SUGGEST_SITE_LIMIT";

/** What a step can read of the case so far: the records of the earlier steps and the effects logged up to now. */
export type Prior = {
	readonly steps: readonly StepRecord[];
	readonly effects: readonly Effect[];
	/** The JSON body of the n-th step's answer (counting from 0). */
	answerJson(step: number): JsonObject;
};

/** A value fixed in the case table, or computed from what earlier steps recorded. The resolved value is what is recorded. */
export type Lazy<T> = T | ((prior: Prior) => T);

/** A body of `size` bytes made one byte at a time, so a large upload needs no large literal. */
export type GeneratedBody = {
	readonly generated: number;
	readonly byteAt: (index: number) => number;
};

export const generatedBody = (
	size: number,
	byteAt: (index: number) => number = () => 0x61,
): GeneratedBody => ({ generated: size, byteAt });

/** A request body: text, bytes, bytes made on demand, or a stream. */
export type StepBody =
	| string
	| Uint8Array
	| GeneratedBody
	| ReadableStream<Uint8Array>;

/** One request. */
export type Step = {
	/** Who sends it. Default: an anonymous visitor. */
	readonly as?: Actor;
	/** A different handler for this step, for a sequence that crosses routes. Default: the corpus handler. */
	readonly handler?: Handler;
	/** Default POST. */
	readonly method?: string;
	/** The path and query, such as "/api/owner/requests/r1?x=1". */
	readonly path: Lazy<string>;
	/** The scheme and host of the request, such as "http://localhost:4321" or "https://audio.thesuperhuman.us". Default: the case's origin. */
	readonly origin?: string;
	/** Astro route params, such as { id: "r1" }. */
	readonly params?: { readonly [name: string]: string | undefined };
	/** A JSON body. Sets content-type to application/json unless `headers` gives one. */
	readonly json?: Lazy<JsonValue>;
	/** A raw body: text for malformed JSON and other non-JSON input, bytes, generated bytes or a stream. */
	readonly body?: Lazy<StepBody>;
	readonly headers?: Lazy<{ readonly [name: string]: string }>;
	/** Move the clock this many milliseconds before the request. */
	readonly advanceMs?: number;
	/** Runs before the request (and after the clock move), off the record except for a marker named `label`. */
	readonly before?: {
		readonly label: string;
		readonly run: (world: World) => void | Promise<void>;
	};
	/** Record these tables' rows after this step. */
	readonly dump?: Dump;
};

export type Case = {
	readonly name: string;
	readonly steps: readonly Step[];
	/** MUSIC_DB. Default: present, empty, with the full schema. */
	readonly music?: DbSetup;
	/** PUBLICATION_DB. Default: present, empty, with the full schema. */
	readonly publication?: DbSetup;
	readonly r2?: R2Setup;
	/** Namespaces by name. RATE_LIMIT and RESUME_STORE are always bound unless `missing`; the others only when listed. */
	readonly kv?: { readonly [Name in KvName]?: KvSetup };
	/** Answers for outgoing fetches. Default: every fetch throws, and the call is recorded. */
	readonly fetches?: Responder;
	/** Answers for env.AI.run, in order. Omit and AI is not bound. */
	readonly ai?: readonly AiAnswer[];
	/** Answers for rate-limit bindings, in order. A binding that is not listed is not bound. */
	readonly rateLimits?: {
		readonly [Name in RateLimitName]?: readonly boolean[];
	};
	/** The scheme and host requests come from, unless a step names its own. Default: https://thesuperhuman.us. */
	readonly origin?: string;
	/**
	 * setTimeout and clearTimeout run on the frozen clock and fire as the runner advances it, so a route's timeout is
	 * recorded without waiting. On by default when an AI answer never comes or comes late.
	 */
	readonly virtualTimers?: boolean;
	readonly env?: EnvText;
	/** Env members to remove, as a deployment that never set them. */
	readonly omit?: readonly (keyof EnvText)[];
	/** locals.runtime.ctx is absent, as in a route that reads `runtime?.ctx`. */
	readonly noContext?: boolean;
	readonly interleave?: readonly Interleave[];
	readonly failures?: readonly InjectedFailure[];
	/**
	 * Every declared trigger (a D1 failure or interleave, an R2 or KV `fails` entry, a `byHost` answer that throws, an AI
	 * answer that throws or never answers) must fire as often as declared, or the case fails and names it. List here one
	 * that may legitimately stay quiet: the text is the one the failure message prints, and the reason is required.
	 */
	readonly optionalTriggers?: readonly OptionalTrigger[];
	/**
	 * Declared triggers that must stay quiet: a control proving a statement or call is never reached. The case fails if one
	 * fires (an `nth` trigger fires when its n-th match comes).
	 */
	readonly mustNotFire?: readonly MustNotFire[];
	/** Runs once before the first step, off the record, to seed with code (raw SQL on the databases). */
	readonly setup?: (world: World) => void | Promise<void>;
	/** Record these tables' rows (and stores) after the last step. */
	readonly final?: Dump;
};

/** The digest of every database, R2 and KV after a step (see digest.ts): a write to any table shows here. */
export type StateDigest = {
	music: string;
	publication: string;
	r2: string;
	kv: string;
	/** The databases, and the tables written so far, when the response had been read, before any background work ran. */
	atResponse: EffectState;
};

/** The state at the end of a case: per-table digests of both databases, and the whole of R2 and KV. */
export type FinalState = {
	music: DatabaseDigest;
	publication: DatabaseDigest;
	r2: Recorded;
	kv: { [name: string]: Recorded };
};

export type StepRecord = {
	request: {
		actor: string;
		method: string;
		path: string;
		body: string | ByteRecord | null;
	};
	answer:
		| {
				outcome: "response";
				status: number;
				headers: { [name: string]: string };
				setCookies: string[];
				body: string | Recorded;
		  }
		| { outcome: "rejected" };
	state: Recorded | null;
	digest: StateDigest;
};

export type CaseRecord = {
	name: string;
	/** Fixture format. 4 added the digests (per database at every outside effect, at the response, after the step and per table at the end), `finalState`, the `trigger-hit` entries and the real `changes` of every D1 statement. 5 changes what `phase` and the digest at the response mean: whether the response waited for the effect, not when it happened to start (settle.ts). */
	format: 5;
	steps: StepRecord[];
	effects: Effect[];
	final: Recorded | null;
	finalState: FinalState;
};

/** What a case can reach while it runs, in `setup`, `before` and `interleave` hooks. */
export type World = {
	readonly music: SqliteDatabase;
	readonly publication: SqliteDatabase;
	readonly log: EffectLog;
	/** Move the clock. Recorded. */
	advance(ms: number): void;
};

/** The time limit of every generated case: the slowest PDF cases take about 2 seconds alone, so 20 seconds tolerates a loaded machine without letting a hung case run for long. */
export const CASE_TIMEOUT_MS = 20_000;

type Pending = { id: number; promise: Promise<void> };

const TEXTUAL =
	/^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]*\+(json|xml))/i;

/** Text over this many bytes is recorded as a length and a digest, not in full. */
const TEXT_LIMIT = 64 * 1024;

type Sent = {
	/** What the fixture holds for the body. */
	record: string | ByteRecord | null;
	/** What the request carries. */
	send: string | Uint8Array<ArrayBuffer> | undefined;
	contentType: string | null;
};

function textBody(text: string, contentType: string | null): Sent {
	const bytes = new TextEncoder().encode(text);

	return {
		record: bytes.length > TEXT_LIMIT ? byteRecord(bytes) : text,
		send: text,
		contentType,
	};
}

const isLazy = <T>(value: Lazy<T>): value is (prior: Prior) => T =>
	value instanceof Function;

/** A step member as the case wrote it, or as the function the case gave computes it from the earlier records. */
const resolved = <T>(value: Lazy<T>, prior: Prior): T =>
	isLazy(value) ? value(prior) : value;

async function bodyOf(step: Step, prior: Prior): Promise<Sent> {
	const wanted = resolved(step.json, prior);

	if (wanted !== undefined)
		return textBody(JSON.stringify(wanted), "application/json");

	const given = resolved(step.body, prior);

	if (given === undefined)
		return { record: null, send: undefined, contentType: null };

	if (isText(given)) return textBody(given, null);

	const bytes: Uint8Array<ArrayBuffer> =
		given instanceof Uint8Array
			? given.slice()
			: given instanceof ReadableStream
				? await drain(given)
				: Uint8Array.from({ length: given.generated }, (_, index) =>
						given.byteAt(index),
					);

	return { record: byteRecord(bytes), send: bytes, contentType: null };
}

async function readAnswer(response: Response): Promise<StepRecord["answer"]> {
	const contentType = response.headers.get("content-type") ?? "";
	const bytes = new Uint8Array(await response.arrayBuffer());

	const headers = Object.fromEntries(
		[...response.headers.entries()]
			.filter(([name]) => name !== "set-cookie")
			.sort(([a], [b]) => a.localeCompare(b)),
	);

	return {
		outcome: "response",
		status: response.status,
		headers,
		setCookies: response.headers.getSetCookie(),
		body:
			bytes.length === 0 || TEXTUAL.test(contentType)
				? new TextDecoder().decode(bytes)
				: byteRecord(bytes),
	};
}

/** Sends every step of the case to its handler, in order, and records what they answered and did. */
export async function runCase(handler: Handler, c: Case): Promise<CaseRecord> {
	const log = new EffectLog();
	const clock = new Determinism(log);

	clock.virtualTimers =
		c.virtualTimers ??
		c.ai?.some(
			(answer) => answer.kind === "never" || answer.kind === "after",
		) ??
		false;

	clock.install();

	try {
		return await runInstalled(handler, c, log, clock);
	} finally {
		clock.restore();
		vi.unstubAllGlobals();
	}
}

/** Opens the case's two databases, and closes both however the case ends. */
async function runInstalled(
	handler: Handler,
	c: Case,
	log: EffectLog,
	clock: Determinism,
): Promise<CaseRecord> {
	let music: SqliteDatabase | undefined;
	let publication: SqliteDatabase | undefined;

	try {
		music = freshMusicDb();
		publication = freshPublicationDb();

		return await runOn(handler, c, log, clock, music, publication);
	} finally {
		music?.close();
		publication?.close();
	}
}

async function runOn(
	handler: Handler,
	c: Case,
	log: EffectLog,
	clock: Determinism,
	music: SqliteDatabase,
	publication: SqliteDatabase,
): Promise<CaseRecord> {
	if (c.music?.seed) seed(music, c.music.seed);

	if (c.publication?.seed) seed(publication, c.publication.seed);

	const triggers = new Triggers(() => log.recording);
	const hooks = new SqlHooks(c.interleave ?? [], c.failures ?? [], triggers);
	const musicDigest = new DatabaseDigester(music);
	const publicationDigest = new DatabaseDigester(publication);

	const r2 = recordingR2(
		"AUDIO",
		c.r2 ?? {},
		log,
		clock.now,
		clock.nextFakeId,
		triggers,
	);

	const kvNames: KvName[] = ["RATE_LIMIT", "RESUME_STORE", "OAUTH_KV"];

	const bound = (name: KvName) =>
		(name === "RATE_LIMIT" || name === "RESUME_STORE" || c.kv?.[name]) &&
		!c.kv?.[name]?.missing;

	const kvs = Object.fromEntries(
		kvNames.flatMap((name) =>
			bound(name)
				? [[name, recordingKv(name, c.kv?.[name] ?? {}, log, triggers)]]
				: [],
		),
	);

	const env: Partial<Env> = { ...DEFAULT_ENV, ...c.env };

	for (const name of c.omit ?? []) delete env[name];

	if (!c.music?.missing)
		env.MUSIC_DB = recordingD1("MUSIC_DB", music, log, hooks, musicDigest);

	if (!c.publication?.missing)
		env.PUBLICATION_DB = recordingD1(
			"PUBLICATION_DB",
			publication,
			log,
			hooks,
			publicationDigest,
		);

	if (!c.r2?.missing) env.AUDIO = r2.binding;

	if (kvs.RATE_LIMIT) env.RATE_LIMIT = kvs.RATE_LIMIT.binding;

	if (kvs.RESUME_STORE) env.RESUME_STORE = kvs.RESUME_STORE.binding;

	if (kvs.OAUTH_KV) env.OAUTH_KV = kvs.OAUTH_KV.binding;

	if (c.ai) env.AI = recordingAi(c.ai, log, triggers);

	for (const name of [
		"BRIEF_SUGGEST_RATE_LIMIT",
		"BRIEF_SUGGEST_SITE_LIMIT",
	] as const) {
		const script = c.rateLimits?.[name];

		if (script) env[name] = recordingRateLimit(name, script, log);
	}

	let responder: Responder = trackedResponder(
		c.fetches ??
			(() => ({
				kind: "throws",
				message: "golden harness: no fetch scripted",
			})),
		triggers,
	);

	vi.stubGlobal(
		"fetch",
		recordingFetch((call) => responder(call), log),
	);

	const pending: Pending[] = [];
	let nextWaitId = 0;
	let drained = 0;

	const ctx = double<ExecutionContext>({
		waitUntil: (promise: Promise<void>) => {
			const id = ++nextWaitId;
			log.push({ kind: "waitUntil", id });
			pending.push({ id, promise });
			// Like the platform, a rejection here is not an unhandled one: the settlement is recorded by the drain.
			promise.then(undefined, () => {});
		},
		passThroughOnException: () => {},
	});

	const drain = async () => {
		while (drained < pending.length) {
			const batch = pending.slice(drained);
			drained = pending.length;

			const settled = await Promise.allSettled(
				batch.map((item) => item.promise),
			);

			for (const [index, result] of settled.entries())
				log.push({
					kind: "waitUntil-settled",
					id: batch[index].id,
					outcome: result.status,
					error:
						result.status === "rejected" && result.reason instanceof Error
							? errorText(result.reason)
							: null,
				});
		}
	};

	const world: World = {
		music,
		publication,
		log,
		advance: (ms) => clock.advance(ms),
	};

	const runtime = (owner?: { email: string }) => {
		const fields = partial<TestRuntime>({
			env: partial<TestRuntime["env"]>(env),
		});

		if (!c.noContext) fields.ctx = ctx;

		return partial<App.Locals>({ owner, runtime: fields });
	};

	const tokens = new Map<string, string>();

	const signIn = async (email: string): Promise<string> => {
		const known = tokens.get(email);

		if (known) return known;

		const position = clock.idPosition();

		// Each distinct client draws its sign-in values from a sequence of its own, so two clients never share a session.
		if (tokens.size > 0) clock.startIds(tokens.size * 1_000_000);

		const token = await hooks.quietly(() =>
			log.unrecorded(async () => {
				let mailText = "";
				const before = responder;

				responder = (call) => {
					if (call.host === "resend") mailText = call.body ?? "";

					return byHost({
						turnstile: json(200, { success: true }),
						resend: json(200, { id: "em_signin" }),
					})(call);
				};

				const send = async (path: string, body: JsonValue) => {
					const request = new Request(`${ORIGIN}${path}`, {
						method: "POST",
						headers: { "content-type": "application/json", origin: ORIGIN },
						body: JSON.stringify(body),
					});

					return (path === "/api/studio/code" ? studioCode : studioSession)(
						partial<APIContext>({
							request,
							url: new URL(request.url),
							params: {},
							locals: runtime(),
						}),
					);
				};

				const issued = await send("/api/studio/code", {
					email,
					turnstileToken: "golden",
				});

				await drain();
				responder = before;

				// The email shows the code as "1234 5678".
				const spaced = /\b(\d{4}) (\d{4})\b/.exec(
					JSON.parse(mailText || "{}").text ?? "",
				);

				const code = spaced ? `${spaced[1]}${spaced[2]}` : undefined;

				if (!code)
					throw new Error(
						`golden harness: no sign-in code was issued for ${email} (the code route answered ${issued.status}). Seed an active project for that email.`,
					);

				const response = await send("/api/studio/session", { email, code });

				const cookie = response.headers
					.getSetCookie()[0]
					?.match(/studio_session=([^;]+)/)?.[1];

				if (!cookie)
					throw new Error(
						`golden harness: sign-in did not set a session for ${email}.`,
					);

				return cookie;
			}),
		);

		// Back to where the case's own requests were, so they never draw an id the sign-in or an earlier request drew.
		clock.startIds(position);
		tokens.set(email, token);

		return token;
	};

	if (c.setup) await log.unrecorded(async () => c.setup?.(world));

	const stores = (dumping: Dump | undefined): Recorded | null => {
		if (!dumping) return null;

		const out: { [name: string]: Recorded } = {};

		if (dumping.music) out.music = dump(music, dumping.music);

		if (dumping.publication)
			out.publication = dump(publication, dumping.publication);

		if (dumping.r2) out.r2 = r2.snapshot();

		if (dumping.kv)
			out.kv = Object.fromEntries(
				dumping.kv.map((name) => [name, kvs[name]?.snapshot() ?? null]),
			);

		return out;
	};

	const sha = (value: Recorded) =>
		createHash("sha256").update(JSON.stringify(value)).digest("hex");

	const kvStates = () =>
		Object.fromEntries(
			kvNames.map((name) => [name, kvs[name]?.state() ?? null]),
		);

	const databases = () => ({
		music: musicDigest.current().sha256,
		publication: publicationDigest.current().sha256,
	});

	log.probe = databases;

	const digest = (atResponse: StateDigest["atResponse"]): StateDigest => ({
		...databases(),
		r2: sha(r2.snapshot()),
		kv: sha(kvStates()),
		atResponse,
	});

	const records: StepRecord[] = [];

	const prior: Prior = {
		steps: records,
		effects: log.entries,
		answerJson: (index) => {
			const answer = records[index]?.answer;

			if (answer?.outcome !== "response" || !isText(answer.body))
				throw new Error(
					`golden harness: step ${index} has no text answer to read as JSON.`,
				);

			return JSON.parse(answer.body);
		},
	};

	for (const [index, step] of c.steps.entries()) {
		log.step = index;
		log.phase = "request";

		if (step.advanceMs) clock.advance(step.advanceMs);

		if (step.before) {
			log.push({ kind: "interleave", label: step.before.label });
			await log.unrecorded(async () => step.before?.run(world));
		}

		const actor = step.as ?? asVisitor();
		const method = (step.method ?? "POST").toUpperCase();
		const { record, send, contentType } = await bodyOf(step, prior);
		const path = resolved(step.path, prior);
		const headers = new Headers();

		if (contentType) headers.set("content-type", contentType);

		if (actor.kind === "visitor") {
			if (actor.ip) headers.set("cf-connecting-ip", actor.ip);

			for (const [name, value] of Object.entries(actor.headers))
				headers.set(name, value);
		}

		if (actor.kind === "client")
			headers.set("cookie", `studio_session=${await signIn(actor.email)}`);

		if (actor.kind === "client-cookie")
			headers.set("cookie", `studio_session=${actor.token}`);

		const extra = resolved(step.headers, prior);

		for (const [name, value] of Object.entries(extra ?? {}))
			headers.set(name, value);

		const request = new Request(`${step.origin ?? c.origin ?? ORIGIN}${path}`, {
			method,
			headers,
			body: method === "GET" || method === "HEAD" ? undefined : send,
		});

		if (actor.kind === "visitor" && actor.cf)
			Object.defineProperty(request, "cf", { value: actor.cf });

		const context = partial<APIContext>({
			request,
			url: new URL(request.url),
			params: step.params ?? {},
			locals: runtime(
				actor.kind === "owner" ? { email: actor.email } : undefined,
			),
		});

		let answer: StepRecord["answer"];

		log.gating = true;

		try {
			// The handler and the reading of its answer are driven together (settle.ts): what they start waits at the log's
			// gate and is released as "request" while they have not finished, so the order of background work against the
			// answer never depends on how many promise turns a route takes.
			const run = step.handler ?? handler;

			answer = await drive(
				log,
				clock,
				(async () => readAnswer(await run(context)))(),
				{ phase: "request", flush: false, timers: clock.virtualTimers },
			);
		} catch {
			answer = { outcome: "rejected" };
		}

		log.phase = "background";
		const atResponse = { ...databases(), touched: log.touched() };

		// What is still at the gate was never waited for: ctx.waitUntil work, and anything a route left floating.
		await drive(log, clock, drain(), {
			phase: "background",
			flush: true,
			timers: false,
		});

		log.gating = false;
		log.phase = "request";

		records.push({
			request: { actor: actorLabel(actor), method, path, body: record },
			answer,
			state: stores(step.dump),
			digest: digest(atResponse),
		});
	}

	const unfired = triggers.problems(c.optionalTriggers, c.mustNotFire);

	if (unfired.length > 0)
		throw new Error(
			`golden harness: case "${c.name}" declared triggers that did not fire, so it would record the happy path under a name that claims otherwise. ${unfired.join("; ")}.`,
		);

	return {
		name: c.name,
		format: 5,
		steps: records,
		effects: log.entries,
		final: stores(c.final),
		finalState: {
			music: musicDigest.current(),
			publication: publicationDigest.current(),
			r2: r2.snapshot(),
			kv: kvStates(),
		},
	};
}

/** Defines one test per case of a corpus, and the check that the fixture holds exactly these cases. */
export function defineCorpus(
	area: string,
	handler: Handler,
	cases: readonly Case[],
) {
	const names = cases.map((c) => c.name);

	describe(`golden corpus: ${area}`, () => {
		it("has unique case names", () => {
			if (new Set(names).size !== names.length)
				throw new Error(`duplicate case names in ${area}`);
		});

		for (const c of cases)
			it(
				c.name,
				async () => {
					expectRecorded(area, await runCase(handler, c));
				},
				CASE_TIMEOUT_MS,
			);

		afterAll(() => settleFixture(area, names));
	});
}
