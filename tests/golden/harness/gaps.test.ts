import { createHash } from "node:crypto";
import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { multipartUploadGone } from "~/lib/audio-project-uploads";
import { isWholeRecording } from "./fixtures";
import {
	aiAfter,
	aiNever,
	asClient,
	generatedBody,
	asVisitor,
	byHost,
	json,
	rows,
	runCase,
	uuidFor,
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

describe("two signed-in clients", () => {
	it("each gets its own session, and the same client keeps one", async () => {
		const handler: Handler = async (context) =>
			new Response(context.request.headers.get("cookie") ?? "none");

		const got = await runCase(handler, {
			name: "two clients",
			music: {
				seed: {
					owner_requests: [
						rows.ownerRequest("r1"),
						rows.ownerRequest("r2", { email: "ada@example.test" }),
					],
				},
			},
			steps: [
				{ path: "/x", as: asClient("grace@example.test") },
				{ path: "/x", as: asClient("ada@example.test") },
				{ path: "/x", as: asClient("grace@example.test") },
			],
		});

		const bodies = got.steps.map((step) =>
			step.answer.outcome === "response" ? step.answer.body : "",
		);

		expect(bodies[0]).not.toBe(bodies[1]);
		expect(bodies[2]).toBe(bodies[0]);
	});
});

describe("hooks during sign-in", () => {
	it("an injected failure and an interleave aimed at a statement do not fire during the off-record sign-in", async () => {
		let interleaved = 0;

		const handler: Handler = async (context) => {
			await env(context)
				.MUSIC_DB?.prepare("SELECT count(*) AS n FROM owner_requests")
				.first();

			return new Response("ok");
		};

		const got = await runCase(handler, {
			name: "hooks",
			music: { seed: { owner_requests: [rows.ownerRequest("r1")] } },
			steps: [{ path: "/x", as: asClient("grace@example.test") }],
			failures: [{ on: /studio_/i, message: "boom" }],
			interleave: [
				{
					on: /studio_/i,
					label: "other request",
					run: () => {
						interleaved += 1;
					},
				},
			],
			optionalTriggers: [
				{
					trigger: "d1 failure on /studio_/i",
					reason: "the test shows the sign-in does not fire it",
				},
				{
					trigger: 'd1 interleave "other request" on /studio_/i',
					reason: "the test shows the sign-in does not fire it",
				},
			],
		});

		expect(interleaved).toBe(0);
		expect(
			got.effects.filter((effect) => effect.kind === "interleave"),
		).toEqual([]);
	});
});

describe("steps that use earlier answers", () => {
	it("a step's path, json, body and headers may be functions of the earlier records, and the resolved values are recorded", async () => {
		const handler: Handler = async (context) => {
			const url = new URL(context.request.url);

			if (url.pathname === "/make")
				return Response.json({ id: "abc", code: "1234" });

			return Response.json({
				path: url.pathname,
				body: await context.request.text(),
				header: context.request.headers.get("x-code"),
			});
		};

		const got = await runCase(handler, {
			name: "chain",
			steps: [
				{ path: "/make" },
				{
					path: (prior) => `/use/${prior.answerJson(0).id}`,
					json: (prior) => ({ code: prior.answerJson(0).code }),
					headers: (prior) => ({ "x-code": String(prior.answerJson(0).code) }),
				},
				{
					path: "/raw",
					body: (prior) => `id=${prior.answerJson(0).id}`,
					headers: { "content-type": "text/plain" },
				},
			],
		});

		expect(got.steps[1].request).toEqual({
			actor: "visitor",
			method: "POST",
			path: "/use/abc",
			body: '{"code":"1234"}',
		});

		expect(got.steps[2].request.body).toBe("id=abc");

		const second = got.steps[1].answer;
		const text = second.outcome === "response" ? String(second.body) : "";

		expect(JSON.parse(text)).toEqual({
			path: "/use/abc",
			body: '{"code":"1234"}',
			header: "1234",
		});
	});

	it("a step can read a recorded effect, such as a mail an earlier step sent", async () => {
		const handler: Handler = async (context) => {
			const url = new URL(context.request.url);

			if (url.pathname === "/mail")
				await fetch("https://api.resend.com/emails", {
					method: "POST",
					body: JSON.stringify({ text: "code 9999" }),
				});

			return new Response(url.search);
		};

		const got = await runCase(handler, {
			name: "effects",
			fetches: byHost({ resend: json(200, { id: "e1" }) }),
			steps: [
				{ path: "/mail" },
				{
					path: (prior) => {
						const sent = prior.effects.find(
							(effect) => effect.kind === "fetch",
						);

						return `/next?body=${sent?.kind === "fetch" ? sent.body : ""}`;
					},
				},
			],
		});

		expect(got.steps[1].request.path).toContain("code 9999");
	});
});

describe("binary and large request bodies", () => {
	const echo: Handler = async (context) =>
		new Response(String((await context.request.arrayBuffer()).byteLength));

	it("records a Uint8Array body as a length and SHA-256, and sends it intact", async () => {
		const bytes = new Uint8Array([0, 255, 1, 2, 3]);

		const got = await runCase(echo, {
			name: "bytes",
			steps: [{ path: "/x", body: bytes }],
		});

		expect(got.steps[0].request.body).toEqual({
			$bytes: {
				length: 5,
				sha256:
					"4be72cf29a33b5f223067ab9d5dd9567e0c14978e6ed54e2d556ddc9e2cc6038",
			},
		});

		const answer = got.steps[0].answer;

		expect(answer.outcome === "response" && answer.body).toBe("5");
	});

	it("records a generated body of a given size, and a stream, without holding text", async () => {
		const got = await runCase(echo, {
			name: "generated",
			steps: [
				{ path: "/x", body: generatedBody(200_000, (index) => index % 251) },
				{
					path: "/y",
					body: new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(10).fill(9));
							controller.enqueue(new Uint8Array(5).fill(8));
							controller.close();
						},
					}),
				},
			],
		});

		expect(got.steps[0].request.body).toMatchObject({
			$bytes: { length: 200_000 },
		});
		expect(got.steps[1].request.body).toMatchObject({ $bytes: { length: 15 } });
		expect(
			got.steps.map((step) =>
				step.answer.outcome === "response" ? step.answer.body : "",
			),
		).toEqual(["200000", "15"]);
	});

	it("records text over 64 KB as a length and SHA-256, and short text as text", async () => {
		const got = await runCase(echo, {
			name: "text",
			steps: [
				{ path: "/x", body: "a".repeat(70_000) },
				{ path: "/y", body: "short" },
				{ path: "/z", json: { big: "b".repeat(70_000) } },
			],
		});

		expect(got.steps[0].request.body).toMatchObject({
			$bytes: { length: 70_000 },
		});
		expect(got.steps[1].request.body).toBe("short");
		expect(got.steps[2].request.body).toMatchObject({
			$bytes: { length: 70_010 },
		});
	});
});

describe("the request origin", () => {
	it("a step or case can choose the scheme and host", async () => {
		const handler: Handler = async (context) =>
			new Response(`${context.url.origin}|${context.request.url}`);

		const got = await runCase(handler, {
			name: "origin",
			origin: "http://localhost:4321",
			steps: [
				{ path: "/a" },
				{ path: "/b", origin: "https://audio.thesuperhuman.us" },
			],
		});

		const bodies = got.steps.map((step) =>
			step.answer.outcome === "response" ? step.answer.body : "",
		);

		expect(bodies).toEqual([
			"http://localhost:4321|http://localhost:4321/a",
			"https://audio.thesuperhuman.us|https://audio.thesuperhuman.us/b",
		]);
	});
});

describe("console output", () => {
	it("console.error and console.warn calls are recorded in order and not printed", async () => {
		const handler: Handler = async () => {
			console.error("failed", new Error("boom"), { id: 1 });
			console.warn("careful");
			console.log("not recorded");

			return new Response("ok");
		};

		const got = await runCase(handler, one());

		expect(got.effects).toEqual([
			{
				kind: "console",
				level: "error",
				args: ["failed", "Error: boom", { id: 1 }],
				step: 0,
				phase: "request",
			},
			{
				kind: "console",
				level: "warn",
				args: ["careful"],
				step: 0,
				phase: "request",
			},
		]);
	});

	it("records work done after the answer as background", async () => {
		const handler: Handler = async (context) => {
			context.locals.runtime.ctx.waitUntil(
				new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() =>
					console.error("later"),
				),
			);

			return new Response("ok");
		};

		const got = await runCase(handler, one());

		expect(
			got.effects.filter((effect) => effect.kind === "console"),
		).toMatchObject([{ phase: "background" }]);
	});
});

describe("R2 multipart uploads and vanishing objects", () => {
	const etag = (text: string) =>
		createHash("sha256").update(text).digest("hex").slice(0, 32);

	it("an upload seeded with uploaded parts can be completed from those parts", async () => {
		const handler: Handler = async (context) => {
			const upload = env(context).AUDIO.resumeMultipartUpload("a/b.wav", "u1");

			const object = await upload.complete([
				{ partNumber: 1, etag: etag("one") },
				{ partNumber: 2, etag: etag("two") },
			]);

			return new Response(String(object.size));
		};

		const got = await runCase(
			handler,
			one({
				r2: {
					uploads: { u1: { key: "a/b.wav", parts: { 1: "one", 2: "two" } } },
				},
				final: { r2: true },
			}),
		);

		const answer = got.steps[0].answer;

		expect(answer.outcome === "response" && answer.body).toBe("6");
		expect(got.final).toMatchObject({ r2: { "a/b.wav": { size: 6 } } });
	});

	it("an upload given only as an id and a key still works, with no parts", async () => {
		const handler: Handler = async (context) => {
			const upload = env(context).AUDIO.resumeMultipartUpload("k", "u1");

			await upload.abort();

			return new Response("aborted");
		};

		const got = await runCase(handler, one({ r2: { uploads: { u1: "k" } } }));

		expect(got.steps[0].answer).toMatchObject({ body: "aborted" });
	});

	it("an upload that no longer exists fails with the error R2 gives, which the source recognises as gone", async () => {
		const messages: string[] = [];

		const handler: Handler = async (context) => {
			const bucket = env(context).AUDIO;
			const gone = bucket.resumeMultipartUpload("k", "nobody");

			for (const attempt of [
				() => gone.abort(),
				() => gone.uploadPart(1, "x"),
				() => gone.complete([]),
			])
				try {
					await attempt();
				} catch (error) {
					messages.push(multipartUploadGone(error) ? "gone" : String(error));
				}

			const made = await bucket.createMultipartUpload("k2");
			await made.abort();

			try {
				await made.abort();
			} catch (error) {
				messages.push(multipartUploadGone(error) ? "gone" : String(error));
			}

			return new Response("ok");
		};

		await runCase(handler, one());

		expect(messages).toEqual(["gone", "gone", "gone", "gone"]);
	});

	it("an object can vanish between head and get", async () => {
		const handler: Handler = async (context) => {
			const bucket = env(context).AUDIO;
			const head = await bucket.head("o");
			const body = await bucket.get("o");

			return new Response(
				`${head ? "head" : "nohead"}|${body ? "get" : "noget"}`,
			);
		};

		const got = await runCase(
			handler,
			one({
				r2: { seed: { o: { body: "x" } }, vanishAfterHead: ["o"] },
				final: { r2: true },
			}),
		);

		expect(got.steps[0].answer).toMatchObject({ body: "head|noget" });
		expect(got.final).toEqual({ r2: {} });
		expect(
			got.effects.map((effect) => effect.kind === "r2" && effect.op),
		).toEqual(["head", "vanish", "get"]);
	});
});

describe("Workers AI that does not answer", () => {
	it("an answer that never comes lets a route's own timeout win, on virtual time that advances the frozen clock", async () => {
		const handler: Handler = async (context) => {
			let timer: ReturnType<typeof setTimeout> | undefined;

			const result = await Promise.race([
				context.locals.runtime.env.AI?.run("@cf/model", { prompt: "x" }),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), 1200);
				}),
			]);

			clearTimeout(timer);

			return new Response(result === null ? "timed out" : "answered");
		};

		const started = Date.now();
		const got = await runCase(handler, one({ ai: [aiNever()] }));

		expect(got.steps[0].answer).toMatchObject({ body: "timed out" });
		expect(got.effects).toContainEqual({
			kind: "advance",
			ms: 1200,
			step: 0,
			phase: "request",
		});
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it("an answer after a delay beats a longer timeout and loses to a shorter one", async () => {
		const handler: Handler = async (context) => {
			const wait = Number(
				new URL(context.request.url).searchParams.get("wait"),
			);

			const result = await Promise.race([
				context.locals.runtime.env.AI?.run("@cf/model", { prompt: "x" }),
				new Promise<string>((resolve) =>
					setTimeout(() => resolve("timeout"), wait),
				),
			]);

			return new Response(JSON.stringify(result));
		};

		const got = await runCase(handler, {
			name: "delay",
			ai: [aiAfter(500, "late"), aiAfter(500, "late")],
			steps: [{ path: "/x?wait=2000" }, { path: "/x?wait=100" }],
		});

		expect(
			got.steps.map((step) =>
				step.answer.outcome === "response" ? step.answer.body : "",
			),
		).toEqual(['"late"', '"timeout"']);
	});
});

describe("failed R2 multipart calls are recorded", () => {
	const ops = (got: Awaited<ReturnType<typeof runCase>>) =>
		got.effects.flatMap((effect) =>
			effect.kind === "r2" ? [`${effect.op}:${effect.key}`] : [],
		);

	it("a part upload that fails, or that targets an upload that is gone, still leaves a record", async () => {
		const handler: Handler = async (context) => {
			const bucket = env(context).AUDIO;
			const made = await bucket.createMultipartUpload("k");
			const gone = bucket.resumeMultipartUpload("k2", "nobody");

			for (const attempt of [
				() => made.uploadPart(1, "x"),
				() => made.uploadPart(1, "x"),
				() => gone.uploadPart(2, "yy"),
				() => gone.abort(),
				() => gone.complete([{ partNumber: 1, etag: "e" }]),
			])
				await attempt().catch(() => undefined);

			return new Response("ok");
		};

		const got = await runCase(handler, one({ r2: { fails: ["uploadPart"] } }));

		expect(ops(got)).toEqual([
			"createMultipartUpload:k",
			"resumeMultipartUpload:k2",
			"uploadPart:k",
			"uploadPart:k",
			"uploadPart:k2",
			"abort:k2",
			"complete:k2",
		]);
	});
});

describe("the case databases are closed", () => {
	const grab = () => {
		const seen: { open: () => boolean }[] = [];

		return {
			seen,
			setup: (world: {
				music: { isOpen: boolean };
				publication: { isOpen: boolean };
			}) => {
				seen.push(
					{ open: () => world.music.isOpen },
					{ open: () => world.publication.isOpen },
				);
			},
		};
	};

	it("both are closed after a case that finishes", async () => {
		const { seen, setup } = grab();

		await runCase(async () => new Response("ok"), one({ setup }));

		expect(seen.map((db) => db.open())).toEqual([false, false]);
	});

	it("both are closed when a handler throws, and when setup throws", async () => {
		const first = grab();

		await runCase(
			async () => {
				throw new Error("boom");
			},
			one({ setup: first.setup }),
		);

		expect(first.seen.map((db) => db.open())).toEqual([false, false]);

		const second = grab();

		await expect(
			runCase(
				async () => new Response("ok"),
				one({
					setup: (world) => {
						second.setup(world);
						throw new Error("setup failed");
					},
				}),
			),
		).rejects.toThrow("setup failed");

		expect(second.seen.map((db) => db.open())).toEqual([false, false]);
	});
});

describe("a re-recording is written only when whole", () => {
	it("every expected case, in order, is a whole recording; fewer, others or a different order are not", () => {
		const got = (...names: string[]) => names.map((name) => ({ name }));

		expect(isWholeRecording(got("a", "b"), ["a", "b"])).toBe(true);
		expect(isWholeRecording(got("a"), ["a", "b"])).toBe(false);
		expect(isWholeRecording(got(), ["a"])).toBe(false);
		expect(isWholeRecording(got("b", "a"), ["a", "b"])).toBe(false);
		expect(isWholeRecording(got("a", "b", "c"), ["a", "b"])).toBe(false);
	});
});

describe("an injected D1 failure records the method that was called", () => {
	it("first, all and run each appear as themselves", async () => {
		const handler: Handler = async (context) => {
			const db = env(context).MUSIC_DB!;

			for (const call of [
				() => db.prepare("SELECT 1 AS first_one").first(),
				() => db.prepare("SELECT 2 AS all_two").all(),
				() => db.prepare("SELECT 3 AS run_three").run(),
			])
				await call().catch(() => null);

			return new Response("ok");
		};

		const got = await runCase(
			handler,
			one({
				failures: [
					{ on: /first_one/, message: "one" },
					{ on: /all_two/, message: "two" },
					{ on: /run_three/, message: "three" },
				],
			}),
		);

		expect(
			got.effects.flatMap((effect) =>
				effect.kind === "d1" ? [effect.via] : [],
			),
		).toEqual(["first", "all", "run"]);
	});
});

describe("sign-in in the middle of a case", () => {
	it("a client who signs in after earlier requests does not make later requests draw an id again", async () => {
		const handler: Handler = async () => new Response(crypto.randomUUID());

		const got = await runCase(handler, {
			name: "late sign-in",
			music: {
				seed: {
					owner_requests: [
						rows.ownerRequest("r1"),
						rows.ownerRequest("r2", { email: "ada@example.test" }),
					],
				},
			},
			steps: [
				{ path: "/x", as: asClient("grace@example.test") },
				{ path: "/x", as: asClient("grace@example.test") },
				{ path: "/x", as: asClient("ada@example.test") },
				{ path: "/x", as: asClient("ada@example.test") },
			],
		});

		const ids = got.steps.map((step) =>
			step.answer.outcome === "response" ? step.answer.body : "",
		);

		expect(new Set(ids).size).toBe(4);
		expect(ids).toEqual([uuidFor(1), uuidFor(2), uuidFor(3), uuidFor(4)]);
	});
});

describe("a rate limit with no scripted answer", () => {
	it("is recorded as thrown, not as a refusal", async () => {
		const handler: Handler = async (context) => {
			const limit = context.locals.runtime.env.BRIEF_SUGGEST_RATE_LIMIT!;
			const seen: string[] = [];

			for (const key of ["a", "b"])
				seen.push(
					await limit.limit({ key }).then(
						(result) => String(result.success),
						(error: Error) => error.message,
					),
				);

			return new Response(seen.join("|"));
		};

		const got = await runCase(
			handler,
			one({ rateLimits: { BRIEF_SUGGEST_RATE_LIMIT: [false] } }),
		);

		expect(got.effects).toEqual([
			{
				kind: "rate-limit",
				binding: "BRIEF_SUGGEST_RATE_LIMIT",
				key: "a",
				success: false,
				step: 0,
				phase: "request",
			},
			{
				kind: "rate-limit",
				binding: "BRIEF_SUGGEST_RATE_LIMIT",
				key: "b",
				threw: "golden harness: no rate-limit answer scripted",
				step: 0,
				phase: "request",
			},
		]);
	});
});

describe("advancing the clock on virtual timers", () => {
	it("fires the timers that become due, in the step that advances, and not before", async () => {
		const fired: string[] = [];

		const handler: Handler = async (context) => {
			const step = new URL(context.request.url).pathname;

			if (step === "/set") setTimeout(() => fired.push("late"), 5_000);
			else fired.push(`seen ${fired.length}`);

			return new Response("ok");
		};

		await runCase(handler, {
			name: "timers",
			virtualTimers: true,
			steps: [
				{ path: "/set" },
				{ path: "/check", advanceMs: 4_000 },
				{ path: "/check", advanceMs: 1_000 },
			],
		});

		expect(fired).toEqual(["seen 0", "late", "seen 2"]);
	});
});

describe("injected failures", () => {
	it("count every matching call per trigger, so a second trigger with nth 2 fires on the second call", async () => {
		const outcomes: string[] = [];

		const handler: Handler = async (context) => {
			const db = env(context).MUSIC_DB;

			if (!db) throw new Error("the harness did not provide MUSIC_DB");

			for (let call = 1; call <= 3; call += 1) {
				try {
					await db.prepare("SELECT 1").first();
					outcomes.push("ran");
				} catch {
					outcomes.push("threw");
				}
			}

			return new Response("ok");
		};

		await runCase(
			handler,
			one({
				failures: [
					{ on: /^SELECT 1/, message: "first" },
					{ on: /^SELECT 1/, nth: 2, message: "second" },
				],
			}),
		);

		expect(outcomes).toEqual(["threw", "threw", "ran"]);
	});
});
