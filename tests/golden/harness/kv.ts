// A recording in-memory KV namespace. Values are text or bytes; bytes are recorded as a length and a SHA-256.
import { isText } from "~/lib/type-guards";
import { double } from "../../helpers/doubles";
import type { EffectLog } from "./log";
import { plain, viewOf, type Recorded } from "./plain";

/** What a namespace holds before the case: text, or bytes. */
export type KvSeed = { [key: string]: string | Uint8Array };

export type KvSetup = {
	/** The namespace is not bound at all. */
	readonly missing?: boolean;
	readonly seed?: KvSeed;
	/** A listed operation rejects with an Error. */
	readonly fails?: readonly ("get" | "put" | "delete" | "list")[];
};

type Held = string | Uint8Array;

/** A recording namespace, and what it holds now (keys sorted; bytes as a length and a digest). */
export type RecordedKv = { binding: KVNamespace; snapshot: () => Recorded };

export function recordingKv(
	label: string,
	setup: KvSetup,
	log: EffectLog,
): RecordedKv {
	const store = new Map<string, Held>(Object.entries(setup.seed ?? {}));
	const fails = new Set(setup.fails ?? []);

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

			if (fails.has("get")) throw new Error("kv get failed");
			const held = store.get(key);

			if (held === undefined) return null;

			if (kind === "arrayBuffer")
				return isText(held)
					? new TextEncoder().encode(held).buffer
					: held.slice().buffer;

			return isText(held) ? held : new TextDecoder().decode(held);
		}) as KVNamespace["get"],
		put: async (
			key: string,
			value: string | ArrayBuffer | Uint8Array,
			options?: { expirationTtl?: number; metadata?: string },
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

			if (fails.has("put")) throw new Error("kv put failed");
			store.set(key, held);
		},
		delete: async (key: string) => {
			log.push({
				kind: "kv",
				namespace: label,
				op: "delete",
				key,
				detail: null,
			});

			if (fails.has("delete")) throw new Error("kv delete failed");
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

			if (fails.has("list")) throw new Error("kv list failed");

			const keys = [...store.keys()]
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
				[...store.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, value]) => [key, plain(value)]),
			),
	};
}
