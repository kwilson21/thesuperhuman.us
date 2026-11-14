// Fakes for what a route reaches over the network or the platform: fetch (Stripe, Resend, Turnstile, others),
// Workers AI and the rate-limit bindings. Each answers from a script and records the call in the effect log.
//
// A call the script has no answer for throws, and the call is still recorded, so a missing line shows in the fixture
// and never reads as a pass.
import { isText } from "~/lib/type-guards";
import { double } from "../../helpers/doubles";
import type { JsonValue } from "../../helpers/json";
import type { EffectLog } from "./log";
import type { Triggers } from "./triggers";
import { byteRecord, plain, viewOf, type ByteRecord } from "./plain";

/** What an outgoing fetch gets back, or that it fails the way a dead network does. */
export type FetchAnswer =
	| {
			readonly kind: "response";
			readonly status: number;
			readonly text: string;
			readonly headers: { readonly [name: string]: string };
	  }
	| { readonly kind: "throws"; readonly message: string };

/** A JSON answer. */
export const json = (
	status: number,
	body: JsonValue,
	headers: { readonly [name: string]: string } = {},
): FetchAnswer => ({
	kind: "response",
	status,
	text: JSON.stringify(body),
	headers: { "content-type": "application/json", ...headers },
});

/** A text answer, for a body that is not JSON (an HTML error page, an empty 204). */
export const text = (status: number, body: string): FetchAnswer => ({
	kind: "response",
	status,
	text: body,
	headers: {},
});

/** The network is down: fetch rejects. */
export const networkDown = (message = "network down"): FetchAnswer => ({
	kind: "throws",
	message,
});

/** What a fetch asks for, as a script sees it. */
export type FetchCall = {
	/** `stripe`, `resend`, `turnstile`, or the hostname. */
	readonly host: string;
	/** How many calls to this host came before, counting from 0. */
	readonly n: number;
	readonly url: string;
	readonly method: string;
	readonly body: string | null;
};

export type Responder = (call: FetchCall) => FetchAnswer;

/**
 * A responder from answers by host. A host's value is one answer (always given) or a list (the n-th call gets the n-th;
 * the last one stays for later calls). A host with no entry throws.
 */
export function byHost(answers: {
	readonly [host: string]: FetchAnswer | readonly FetchAnswer[];
}): Responder {
	const responder: Responder = ({ host, n }) => {
		const given = answers[host];

		if (given === undefined)
			return networkDown(`golden harness: no answer scripted for ${host}`);

		if (!Array.isArray(given)) return given;

		return given[Math.min(n, given.length - 1)] ?? networkDown();
	};

	scripted.set(responder, answers);

	return responder;
}

const scripted = new WeakMap<
	Responder,
	{ readonly [host: string]: FetchAnswer | readonly FetchAnswer[] }
>();

const throwsId = (host: string, answer: FetchAnswer, index: number | null) =>
	`fetch ${host} answer${index === null ? "" : ` ${index + 1}`} throws "${answer.kind === "throws" ? answer.message : ""}"`;

/**
 * The responder, tracked: every answer a `byHost` script gives that throws is a declared outage, and counts as fired
 * when a call gets it. A responder written by hand has no declared answers to track.
 */
export function trackedResponder(
	responder: Responder,
	triggers: Triggers,
): Responder {
	const answers = scripted.get(responder);

	const isList = (
		given: FetchAnswer | readonly FetchAnswer[],
	): given is readonly FetchAnswer[] => Array.isArray(given);

	for (const [host, given] of Object.entries(answers ?? {}))
		if (isList(given))
			for (const [index, answer] of given.entries()) {
				if (answer.kind === "throws")
					triggers.declare(throwsId(host, answer, index));
			}
		else if (given.kind === "throws")
			triggers.declare(throwsId(host, given, null));

	return (call) => {
		const answer = responder(call);
		const given = answers?.[call.host];

		if (answer.kind === "throws" && given !== undefined && given === answer)
			triggers.see(throwsId(call.host, answer, null));
		else if (answer.kind === "throws" && Array.isArray(given)) {
			const index = Math.min(call.n, given.length - 1);

			if (given[index] === answer)
				triggers.see(throwsId(call.host, answer, index));
		}

		return answer;
	};
}

const PRESENT = new Set(["authorization", "stripe-signature", "cookie"]);

// The Stripe SDK names its own package version, API version and runtime, and (from a client's second request) the timing
// of the first. Those vary with the machine and with dependency upgrades, not with the route, so they are pinned; the
// header is still recorded as present.
const MACHINE = new Set([
	"user-agent",
	"x-stripe-client-user-agent",
	"x-stripe-client-telemetry",
	"stripe-version",
]);

export const REDACTED = "[redacted]";
export const MACHINE_SPECIFIC = "[machine-specific]";

function hostLabel(url: string): string {
	const { hostname } = new URL(url);

	if (hostname === "api.stripe.com") return "stripe";

	if (hostname === "api.resend.com") return "resend";

	if (hostname === "challenges.cloudflare.com") return "turnstile";

	return hostname;
}

function headerRecord(given: HeadersInit | undefined): {
	[name: string]: string;
} {
	const headers = new Headers(given);

	return Object.fromEntries(
		[...headers.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, value]) => [
				name,
				PRESENT.has(name)
					? REDACTED
					: MACHINE.has(name)
						? MACHINE_SPECIFIC
						: value,
			]),
	);
}

async function bodyRecord(
	body: BodyInit | null | undefined,
): Promise<string | ByteRecord | null> {
	if (body === undefined || body === null) return null;

	if (isText(body)) return body;

	if (body instanceof URLSearchParams) return body.toString();

	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
		return byteRecord(
			ArrayBuffer.isView(body)
				? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
				: viewOf(body),
		);

	if (body instanceof Blob)
		return byteRecord(new Uint8Array(await body.arrayBuffer()));

	throw new Error("golden harness: this fetch body type is not recorded.");
}

/** A fetch that answers from `responder` and records the request. */
export function recordingFetch(
	responder: Responder,
	log: EffectLog,
): typeof fetch {
	const counts = new Map<string, number>();

	return async (input, init) => {
		const at = await log.start();
		const request = input instanceof Request ? input : undefined;
		const url = request?.url ?? String(input);
		const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
		const headers = headerRecord(init?.headers ?? request?.headers);

		const body = await bodyRecord(
			init?.body ?? (request ? await request.clone().text() : null),
		);

		const host = hostLabel(url);
		const n = counts.get(host) ?? 0;
		counts.set(host, n + 1);

		const answer = responder({
			host,
			n,
			url,
			method,
			body: isText(body) ? body : null,
		});

		const signal = init?.signal ?? request?.signal;

		log.push(
			{
				kind: "fetch",
				host,
				url,
				method,
				headers,
				body,
				hasSignal: signal !== undefined && signal !== null,
				answered:
					answer.kind === "throws"
						? `throws ${answer.message}`
						: String(answer.status),
			},
			at,
		);

		if (answer.kind === "throws") throw new Error(answer.message);

		const empty = [101, 204, 205, 304].includes(answer.status);

		return new Response(empty ? null : answer.text, {
			status: answer.status,
			headers: answer.headers,
		});
	};
}

/** What Workers AI gives back, or that it fails. */
export type AiAnswer =
	| { readonly kind: "value"; readonly value: JsonValue }
	| { readonly kind: "throws"; readonly message: string }
	/** The run never settles, so only a timeout of the route's own ends the wait. */
	| { readonly kind: "never" }
	/** The run answers `ms` milliseconds after it was called, on the case's virtual timers. */
	| { readonly kind: "after"; readonly ms: number; readonly value: JsonValue };

export const aiNever = (): AiAnswer => ({ kind: "never" });

export const aiAfter = (ms: number, value: JsonValue): AiAnswer => ({
	kind: "after",
	ms,
	value,
});

export const aiValue = (value: JsonValue): AiAnswer => ({
	kind: "value",
	value,
});

export const aiThrows = (message = "ai failed"): AiAnswer => ({
	kind: "throws",
	message,
});

/** An AI binding whose n-th run answers with the n-th item of the script. */
export function recordingAi(
	script: readonly AiAnswer[],
	log: EffectLog,
	triggers: Triggers,
): Ai {
	let n = 0;

	const idOf = (answer: AiAnswer, index: number) =>
		answer.kind === "throws"
			? `ai answer ${index + 1} throws "${answer.message}"`
			: `ai answer ${index + 1} never answers`;

	for (const [index, answer] of script.entries())
		if (answer.kind === "throws" || answer.kind === "never")
			triggers.declare(idOf(answer, index));

	return double<Ai>({
		// SAFETY: routes call run(model, input, options) and read the answer as the model's output; the fake answers the scripted JSON, which is what a test of that route supplies for that model.
		run: (async (
			model: string,
			input: { [key: string]: JsonValue | undefined },
			options?: { [key: string]: JsonValue | undefined },
		) => {
			const at = await log.start();

			log.push(
				{
					kind: "ai",
					model,
					input: plain(input),
					options: options === undefined ? null : plain(options),
				},
				at,
			);

			const index = n++;
			const answer = script[index];

			if (!answer) throw new Error("golden harness: no AI answer scripted");

			if (answer.kind === "throws" || answer.kind === "never")
				triggers.see(idOf(answer, index));

			if (answer.kind === "throws") throw new Error(answer.message);

			if (answer.kind === "never") return new Promise(() => {});

			if (answer.kind === "after")
				return new Promise((resolve) =>
					setTimeout(() => resolve(answer.value), answer.ms),
				);

			return answer.value;
		}) as Ai["run"],
	});
}

/** A rate-limit binding whose n-th limit() answers with the n-th boolean of the script. */
export function recordingRateLimit(
	binding: string,
	script: readonly boolean[],
	log: EffectLog,
): RateLimit {
	let n = 0;

	return double<RateLimit>({
		limit: async (options: { key: string }) => {
			const at = await log.start();
			const success = script[n++];
			if (success === undefined) {
				const message = "golden harness: no rate-limit answer scripted";

				log.push(
					{ kind: "rate-limit", binding, key: options.key, threw: message },
					at,
				);

				throw new Error(message);
			}

			log.push(
				{ kind: "rate-limit", binding, key: options.key, success },
				at,
			);

			return { success };
		},
	});
}
