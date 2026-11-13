import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import {
	asClient,
	asVisitor,
	byHost,
	json,
	rows,
	runCase,
	type Case,
	type Handler,
} from "./index";

// Checks on the harness features added after the first corpora: KV reads of every type and lifetimes, deterministic
// generated keys, distinct sign-ins, steps that use earlier answers, binary and large bodies, the request origin,
// console capture, R2 multipart seeding and errors, and answers that never come.

const env = (context: APIContext) => context.locals.runtime.env;

const one = (extra: Partial<Case> = {}, path = "/api/x"): Case => ({
	name: "case",
	steps: [{ path, method: "POST", as: asVisitor() }],
	...extra,
});

describe("KV reads", () => {
	it("get with type json parses the stored text, text and arrayBuffer and stream read it as Workers KV does", async () => {
		const seen: unknown[] = [];

		const handler: Handler = async (context) => {
			const kv = env(context).RESUME_STORE;
			seen.push(await kv.get("doc", { type: "json" }));
			seen.push(await kv.get("doc", "json"));
			seen.push(await kv.get("doc", "text"));
			seen.push(await kv.get("doc"));
			seen.push(
				new TextDecoder().decode(
					(await kv.get("doc", "arrayBuffer")) ?? undefined,
				),
			);
			seen.push(await new Response(await kv.get("doc", "stream")).text());
			seen.push(await kv.get("missing", "json"));

			return new Response("ok");
		};

		await runCase(
			handler,
			one({ kv: { RESUME_STORE: { seed: { doc: '{"a":[1,2]}' } } } }),
		);

		expect(seen).toEqual([
			{ a: [1, 2] },
			{ a: [1, 2] },
			'{"a":[1,2]}',
			'{"a":[1,2]}',
			'{"a":[1,2]}',
			'{"a":[1,2]}',
			null,
		]);
	});

	it("get with type json rejects on text that is not JSON, as the platform does", async () => {
		let failure = "";

		const handler: Handler = async (context) => {
			try {
				await env(context).RESUME_STORE.get("doc", "json");
			} catch (error) {
				failure = error instanceof SyntaxError ? "SyntaxError" : String(error);
			}

			return new Response("ok");
		};

		await runCase(
			handler,
			one({ kv: { RESUME_STORE: { seed: { doc: "not json" } } } }),
		);

		expect(failure).toBe("SyntaxError");
	});
});

describe("KV lifetimes", () => {
	it("a value put with expirationTtl reads as absent once the frozen clock passes it, and leaves list and the snapshot", async () => {
		const seen: unknown[] = [];

		const handler: Handler = async (context) => {
			const kv = env(context).RESUME_STORE;
			const url = new URL(context.request.url);

			if (url.pathname === "/put") {
				await kv.put("ttl", "v", { expirationTtl: 60 });
				await kv.put("at", "w", {
					expiration: Math.floor(Date.now() / 1000) + 120,
				});
				await kv.put("forever", "x");
			} else {
				seen.push(
					await kv.get("ttl"),
					await kv.get("at"),
					(await kv.list()).keys.map((key) => key.name),
				);
			}

			return new Response("ok");
		};

		const record = await runCase(handler, {
			name: "lifetimes",
			steps: [
				{ path: "/put" },
				{ path: "/read", advanceMs: 59_000 },
				{ path: "/read", advanceMs: 2_000 },
				{ path: "/read", advanceMs: 60_000 },
			],
			final: { kv: ["RESUME_STORE"] },
		});

		expect(seen).toEqual([
			"v",
			"w",
			["at", "forever", "ttl"],
			null,
			"w",
			["at", "forever"],
			null,
			null,
			["forever"],
		]);

		expect(record.final).toEqual({ kv: { RESUME_STORE: { forever: "x" } } });
	});

	it("a seeded value can carry a lifetime", async () => {
		const seen: unknown[] = [];

		const handler: Handler = async (context) => {
			seen.push(await env(context).RESUME_STORE.get("short"));

			return new Response("ok");
		};

		await runCase(handler, {
			name: "seeded lifetime",
			steps: [{ path: "/a" }, { path: "/b", advanceMs: 30_000 }],
			kv: {
				RESUME_STORE: {
					seed: { short: { value: "v", expirationTtl: 20 }, long: "w" },
				},
			},
		});

		expect(seen).toEqual(["v", null]);
	});
});

describe("generated keys", () => {
	const exported = async (): Promise<string[]> => {
		const out: string[] = [];

		const handler: Handler = async () => {
			for (const algorithm of [
				{ name: "AES-GCM", length: 256 },
				{ name: "AES-GCM", length: 128 },
				{ name: "HMAC", hash: "SHA-256" },
			]) {
				const key = await crypto.subtle.generateKey(algorithm, true, [
					algorithm.name === "HMAC" ? "sign" : "encrypt",
				]);

				if (key instanceof CryptoKey)
					out.push(
						Buffer.from(await crypto.subtle.exportKey("raw", key)).toString(
							"hex",
						),
					);
			}

			return new Response("ok");
		};

		await runCase(handler, one());

		return out;
	};

	it("crypto.subtle.generateKey gives the same key in every run, of the length asked for", async () => {
		const first = await exported();
		const second = await exported();

		expect(second).toEqual(first);
		expect(first.map((hex) => hex.length / 2)).toEqual([32, 16, 64]);
	});

	it("refuses a key type it cannot make deterministic, naming it", async () => {
		let failure = "";

		const handler: Handler = async () => {
			try {
				await crypto.subtle.generateKey(
					{ name: "ECDSA", namedCurve: "P-256" },
					true,
					["sign"],
				);
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}

			return new Response("ok");
		};

		await runCase(handler, one());

		expect(failure).toMatch(/ECDSA/);
	});

	it("restores the real generateKey after the case", async () => {
		await exported();

		const key = await crypto.subtle.generateKey(
			{ name: "AES-GCM", length: 256 },
			true,
			["encrypt"],
		);

		const again = await crypto.subtle.generateKey(
			{ name: "AES-GCM", length: 256 },
			true,
			["encrypt"],
		);

		if (key instanceof CryptoKey && again instanceof CryptoKey)
			expect(
				Buffer.from(await crypto.subtle.exportKey("raw", key)).toString("hex"),
			).not.toBe(
				Buffer.from(await crypto.subtle.exportKey("raw", again)).toString(
					"hex",
				),
			);
	});
});
