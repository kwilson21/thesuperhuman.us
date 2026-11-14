// A recording in-memory KV namespace. Values are text or bytes; bytes are recorded as a length and a SHA-256.
import { isText } from "~/lib/type-guards";
import { double } from "../../helpers/doubles";
import type { EffectLog } from "./log";
import { plain, viewOf, type Recorded } from "./plain";
import type { Triggers } from "./triggers";

/** A value a namespace holds before the case, optionally with a lifetime counted from the start of the case. */
export type KvSeedValue =
	| string
	| Uint8Array
	| {
			readonly value: string | Uint8Array;
			/** Seconds from the start of the case. */
			readonly expirationTtl?: number;
			/** Absolute time, in seconds since the epoch. */
			readonly expiration?: number;
	  };

/** What a namespace holds before the case: text, or bytes. */
export type KvSeed = { [key: string]: KvSeedValue };

export type KvSetup = {
	/** The namespace is not bound at all. */
	readonly missing?: boolean;
	readonly seed?: KvSeed;
	/** A listed operation rejects with an Error. */
	readonly fails?: readonly ("get" | "put" | "delete" | "list")[];
};

type Held = string | Uint8Array;

/** A value and the time (milliseconds since the epoch, on the case's clock) at which the namespace drops it. */
type Entry = { held: Held; expiresAt: number | null };

const isEntry = (
	value: KvSeedValue,
): value is Extract<KvSeedValue, { value: string | Uint8Array }> =>
	typeof value === "object" && !(value instanceof Uint8Array);

/** When a value put with these options stops being readable, as Workers KV counts it. */
function expiryOf(options: {
	expirationTtl?: number;
	expiration?: number;
}): number | null {
	if (options.expirationTtl !== undefined)
		return Date.now() + options.expirationTtl * 1000;

	if (options.expiration !== undefined) return options.expiration * 1000;

	return null;
}

/** A recording namespace, and what it holds now (keys sorted; bytes as a length and a digest). */
export type RecordedKv = { binding: KVNamespace; snapshot: () => Recorded };

export function recordingKv(
	label: string,
	setup: KvSetup,
	log: EffectLog,
	triggers: Triggers,
): RecordedKv {
	const store = new Map<string, Entry>(
		Object.entries(setup.seed ?? {}).map(([key, given]) => [
			key,
			isEntry(given)
				? { held: given.value, expiresAt: expiryOf(given) }
				: { held: given, expiresAt: null },
		]),
	);

	/** The live entry for a key: an expired one is gone, as it is for a real namespace. */
	const live = (key: string): Held | undefined => {
		const entry = store.get(key);

		if (entry === undefined) return undefined;

		if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
			store.delete(key);

			return undefined;
		}

		return entry.held;
	};

	const fails = new Set(setup.fails ?? []);

	for (const op of fails) triggers.declare(`kv ${label} fails ${op}`);

	const failIf = (op: "get" | "put" | "delete" | "list") => {
		if (!fails.has(op)) return;

		triggers.see(`kv ${label} fails ${op}`);

		throw new Error(`kv ${op} failed`);
	};

	const binding = double<KVNamespace>({
		// SAFETY: routes call get with a key and, for binary values, "arrayBuffer" or "text"; the fake answers the text or bytes the store holds, as the overload they pick returns.
		get: (async (key: string, type?: string | { type?: string }) => {
			const kind = isText(type) ? type : (type?.type ?? "text");

			log.push({
				kind: "kv",
				namespace: label,
				op: "get",
				key,
				detail: { type: kind },
			});

			failIf("get");
			const held = live(key);

			if (held === undefined) return null;

			const bytes = isText(held) ? new TextEncoder().encode(held) : held;

			const asText = () =>
				isText(held) ? held : new TextDecoder().decode(held);

			if (kind === "arrayBuffer") return bytes.slice().buffer;

			if (kind === "json") return JSON.parse(asText());

			if (kind === "stream") return new Response(bytes.slice()).body;

			return asText();
		}) as KVNamespace["get"],
		put: async (
			key: string,
			value: string | ArrayBuffer | Uint8Array,
			options?: {
				expirationTtl?: number;
				expiration?: number;
				metadata?: string;
			},
		) => {
			const held: Held = isText(value) ? value : viewOf(value);

			log.push({
				kind: "kv",
				namespace: label,
				op: "put",
				key,
				detail: {
					value: plain(held),
					options: options === undefined ? null : plain(options),
				},
			});

			failIf("put");
			store.set(key, { held, expiresAt: expiryOf(options ?? {}) });
		},
		delete: async (key: string) => {
			log.push({
				kind: "kv",
				namespace: label,
				op: "delete",
				key,
				detail: null,
			});

			failIf("delete");
			store.delete(key);
		},
		// SAFETY: routes call list with a prefix and read keys and list_complete; the fake answers those.
		list: (async (options?: { prefix?: string }) => {
			log.push({
				kind: "kv",
				namespace: label,
				op: "list",
				key: null,
				detail: { prefix: options?.prefix ?? null },
			});

			failIf("list");

			const keys = [...store.keys()]
				.filter((key) => live(key) !== undefined)
				.filter((key) => key.startsWith(options?.prefix ?? ""))
				.sort()
				.map((name) => ({ name }));

			return { keys, list_complete: true, cacheStatus: null };
		}) as KVNamespace["list"],
	});

	return {
		binding,
		snapshot: () =>
			Object.fromEntries(
				[...store.keys()]
					.sort((a, b) => a.localeCompare(b))
					.flatMap((key) => {
						const held = live(key);

						return held === undefined ? [] : [[key, plain(held)]];
					}),
			),
	};
}
