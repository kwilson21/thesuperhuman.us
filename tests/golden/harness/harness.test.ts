import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhook, stripeClient } from "~/lib/stripe-invoicing";
import { POST as ownerRequest } from "~/pages/api/owner/requests/[id]";
import {
	aiThrows,
	aiValue,
	asClient,
	asFixture,
	asOwner,
	asVisitor,
	byHost,
	dump,
	freshMusicDb,
	freshPublicationDb,
	json,
	rows,
	runCase,
	sameRecord,
	seed,
	signStripeWebhook,
	text,
	uuidFor,
	type Case,
	type CaseRecord,
	type Handler,
} from "./index";

// The checks on the harness itself: it is deterministic, it records what the fakes see, and a corpus built on it fails
// when the route's behaviour changes in any way a fixture holds.

const env = (context: APIContext) => context.locals.runtime.env;

/** A case with one request to `path`, sent to whatever handler the test passes to runCase. */
const one = (extra: Partial<Case> = {}, path = "/api/x"): Case => ({
	name: "case",
	steps: [{ path, method: "POST", as: asVisitor() }],
	...extra,
});

const record = (handler: Handler, c: Case) => runCase(handler, c);

describe("determinism", () => {
	const reviewing: Case = {
		name: "review then withdraw, with a client sign-in",
		music: {
			seed: {
				owner_requests: [rows.ownerRequest("r1", { status: "new" })],
			},
		},
		steps: [
			{
				as: asClient("grace@example.test"),
				path: "/api/owner/requests/r1",
				params: { id: "r1" },
				json: { action: "review" },
			},
			{
				as: asOwner(),
				path: "/api/owner/requests/r1",
				params: { id: "r1" },
				json: { action: "review" },
			},
			{
				as: asOwner(),
				path: "/api/owner/requests/r1",
				params: { id: "r1" },
				json: { action: "withdraw" },
				advanceMs: 1000,
				dump: { music: ["owner_requests", "owner_request_audit"] },
			},
		],
	};

	it("two runs of a corpus in one process give identical records", async () => {
		const first = await record(ownerRequest, reviewing);
		const second = await record(ownerRequest, reviewing);

		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it("draws UUIDs, random bytes and Math.random from a per-case sequence", async () => {
		const seen: string[] = [];

		const handler: Handler = async () => {
			seen.push(
				crypto.randomUUID(),
				crypto.randomUUID(),
				Array.from(crypto.getRandomValues(new Uint8Array(4))).join(","),
				String(Math.random()),
				String(Date.now()),
				String(new Date().getTime()),
				String(performance.now()),
			);

			return new Response("ok");
		};

		await record(handler, one());
		const first = [...seen];
		seen.length = 0;
		await record(handler, one());

		expect(seen).toEqual(first);
		expect(first[0]).toBe(uuidFor(1));
		expect(first[1]).toBe(uuidFor(2));
		expect(first[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(first[4]).toBe(String(Date.parse("2026-11-13T12:00:00.000Z")));
		expect(first[4]).toBe(first[5]);
	});

	it("moves the clock only on advance, and records the move", async () => {
		const times: string[] = [];

		const handler: Handler = async () => {
			times.push(new Date().toISOString());

			return new Response("ok");
		};

		const got = await record(handler, {
			name: "case",
			steps: [
				{ path: "/a" },
				{ path: "/b", advanceMs: 90_000 },
				{ path: "/c" },
			],
		});

		expect(times).toEqual([
			"2026-11-13T12:00:00.000Z",
			"2026-11-13T12:01:30.000Z",
			"2026-11-13T12:01:30.000Z",
		]);

		expect(got.effects).toEqual([
			{ kind: "advance", ms: 90_000, step: 1, phase: "request" },
		]);
	});
});

describe("what is recorded", () => {
	it("records D1 statements with SQL, arguments, how they ran, batch order and result shape", async () => {
		const handler: Handler = async (context) => {
			const db = env(context).MUSIC_DB!;

			await db
				.prepare(
					"INSERT INTO owner_campaigns(id,name,created_at) VALUES (?,?,?)",
				)
				.bind("c1", "Launch", "2026-11-13T12:00:00.000Z")
				.run()
				.catch(() => null);

			await db.prepare("SELECT 1 AS one WHERE ?=?").bind(1, 1).first();
			await db
				.prepare("SELECT ? AS blob")
				.bind(new Uint8Array([1, 2, 3]))
				.all();

			await db.batch([
				db.prepare("SELECT ? AS a").bind(null),
				db
					.prepare("UPDATE owner_requests SET summary=? WHERE id=?")
					.bind("s", "r1"),
			]);

			return new Response("ok");
		};

		const got = await record(handler, {
			...one(),
			music: { seed: { owner_requests: [rows.ownerRequest("r1")] } },
		});

		const kinds = got.effects.map((effect) =>
			effect.kind === "d1"
				? `${effect.via}:${effect.sql.slice(0, 18)}`
				: effect.kind === "d1-batch"
					? `batch:${effect.result}:${effect.statements.length}`
					: effect.kind,
		);

		expect(kinds).toEqual([
			"run:INSERT INTO owner_",
			"first:SELECT 1 AS one WH",
			"all:SELECT ? AS blob",
			"batch:committed:2",
		]);

		const bind = got.effects[2];

		expect(bind.kind === "d1" && bind.args).toEqual([
			{
				$bytes: { length: 3, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
			},
		]);

		const batch = got.effects[3];

		expect(batch.kind === "d1-batch" && batch.statements[1].outcome).toEqual({
			rows: 0,
			changes: 1,
		});
	});

	it("records R2 operations by byte length and digest, including multipart", async () => {
		const handler: Handler = async (context) => {
			const bucket = env(context).AUDIO;

			await bucket.put("a.txt", "hello", {
				httpMetadata: { contentType: "text/plain" },
				customMetadata: { who: "me" },
			});

			const object = await bucket.get("a.txt", {
				range: { offset: 1, length: 3 },
			});

			const sliced = await object?.text();
			await bucket.head("missing");

			const upload = await bucket.createMultipartUpload("big.bin", {
				httpMetadata: { contentType: "audio/wav" },
			});

			const part = await upload.uploadPart(1, new Uint8Array([9, 9]));
			const done = await upload.complete([part]);
			const listed = await bucket.list({ prefix: "" });
			await bucket.delete("a.txt");

			return new Response(
				`${sliced} ${done.size} ${listed.objects.map((item) => item.key).join(",")}`,
			);
		};

		const got = await record(handler, one());
		const answer = got.steps[0].answer;

		expect(answer.outcome === "response" && answer.body).toBe(
			"ell 2 a.txt,big.bin",
		);

		expect(
			got.effects.map((effect) =>
				effect.kind === "r2" ? effect.op : effect.kind,
			),
		).toEqual([
			"put",
			"get",
			"head",
			"createMultipartUpload",
			"uploadPart",
			"complete",
			"list",
			"delete",
		]);

		expect(JSON.stringify(got.effects)).not.toContain("hello");
	});

	it("records KV reads and writes", async () => {
		const handler: Handler = async (context) => {
			const kv = env(context).RATE_LIMIT;
			await kv.get("k");
			await kv.put("k", "v", { expirationTtl: 60 });

			return new Response(await kv.get("k"));
		};

		const got = await record(handler, one());

		expect(
			got.effects.map((effect) => effect.kind === "kv" && effect.op),
		).toEqual(["get", "put", "get"]);
	});

	it("records fetches with the secret headers redacted but present, and the exact body", async () => {
		const handler: Handler = async () => {
			await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					Authorization: "Bearer secret",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ to: ["a@b.test"] }),
				signal: AbortSignal.timeout(1000),
			});

			await fetch("https://example.test/x").catch(() => null);

			return new Response("ok");
		};

		const got = await record(handler, {
			...one(),
			fetches: byHost({ resend: json(200, { id: "em_1" }) }),
		});

		expect(got.effects[0]).toEqual({
			kind: "fetch",
			host: "resend",
			url: "https://api.resend.com/emails",
			method: "POST",
			headers: {
				authorization: "[redacted]",
				"content-type": "application/json",
			},
			body: '{"to":["a@b.test"]}',
			hasSignal: true,
			answered: "200",
			step: 0,
			phase: "request",
			state: expect.any(Object),
		});

		expect(JSON.stringify(got.effects)).not.toContain("secret");
		expect(got.effects[1]).toMatchObject({
			host: "example.test",
			answered: expect.stringContaining("throws"),
		});
	});

	it("runs the Stripe SDK through the fake fetch and records form body, idempotency key and redacted headers", async () => {
		const handler: Handler = async (context) => {
			const customer = await stripeClient(env(context)).customers.create(
				{ email: "a@b.test", metadata: { audio_request_id: "r1" } },
				{ idempotencyKey: "audio-request:r1:customer" },
			);

			return Response.json({ id: customer.id });
		};

		const got = await record(handler, {
			...one(),
			fetches: byHost({
				stripe: json(200, { id: "cus_1", object: "customer" }),
			}),
		});

		expect(got.steps[0].answer).toMatchObject({
			status: 200,
			body: '{"id":"cus_1"}',
		});

		const call = got.effects[0];

		expect(call).toMatchObject({
			kind: "fetch",
			host: "stripe",
			url: "https://api.stripe.com/v1/customers",
			method: "POST",
			body: "email=a%40b.test&metadata[audio_request_id]=r1",
		});

		expect(call.kind === "fetch" && call.headers).toMatchObject({
			authorization: "[redacted]",
			"idempotency-key": "audio-request:r1:customer",
			"stripe-version": "[machine-specific]",
			"user-agent": "[machine-specific]",
			"x-stripe-client-user-agent": "[machine-specific]",
		});
	});

	it("verifies a webhook signed by signStripeWebhook, and refuses a changed payload", async () => {
		const payload = JSON.stringify({
			id: "evt_1",
			object: "event",
			type: "invoice.paid",
		});

		const handler: Handler = async (context) => {
			const header = signStripeWebhook(payload, "whsec_golden");

			const good = await verifyStripeWebhook(env(context), payload, header);

			const bad = await verifyStripeWebhook(
				env(context),
				`${payload} `,
				header,
			).then(
				() => "accepted",
				() => "refused",
			);

			return new Response(`${good.id} ${bad}`);
		};

		const got = await record(handler, one());

		expect(got.steps[0].answer).toMatchObject({ body: "evt_1 refused" });
	});

	it("answers env.AI.run from the script, and records model and input", async () => {
		const handler: Handler = async (context) => {
			const ai = env(context).AI!;

			const first = await ai.run("@cf/meta/llama-3.2-1b-instruct", {
				prompt: "hi",
			});

			const second = await ai
				.run("@cf/meta/llama-3.2-1b-instruct", { prompt: "again" })
				.catch(() => "threw");

			const third = await ai
				.run("@cf/meta/llama-3.2-1b-instruct", { prompt: "third" })
				.catch(() => "unscripted");

			return Response.json([first, second, third]);
		};

		const got = await record(handler, {
			...one(),
			ai: [aiValue({ response: "hello" }), aiThrows("model down")],
		});

		expect(got.steps[0].answer).toMatchObject({
			body: '[{"response":"hello"},"threw","unscripted"]',
		});

		expect(got.effects[0]).toMatchObject({
			kind: "ai",
			model: "@cf/meta/llama-3.2-1b-instruct",
			input: { prompt: "hi" },
		});
	});

	it("collects ctx.waitUntil work, marks its effects as background, and records settlement", async () => {
		const handler: Handler = async (context) => {
			const { ctx } = context.locals.runtime;

			ctx.waitUntil(
				(async () => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					await env(context).RATE_LIMIT.put("bg", "1");
				})(),
			);

			ctx.waitUntil(Promise.reject(new Error("background failed")));
			await env(context).RATE_LIMIT.put("fg", "1");

			return new Response("ok");
		};

		const got = await record(handler, one());

		expect(
			got.effects.map((effect) => `${effect.kind}:${effect.phase}`),
		).toEqual([
			"waitUntil:request",
			"waitUntil:request",
			"kv:request",
			"kv:background",
			"waitUntil-settled:background",
			"waitUntil-settled:background",
		]);

		expect(got.effects[5]).toMatchObject({
			outcome: "rejected",
			error: "Error: background failed",
		});
	});

	it("records every set-cookie value, all other headers sorted, text bodies in full and binary bodies as a digest", async () => {
		const handler: Handler = async (context) => {
			const url = new URL(context.request.url);

			if (url.pathname === "/bin")
				return new Response(new Uint8Array([0, 255, 1]), {
					headers: { "content-type": "application/octet-stream" },
				});

			const headers = new Headers({
				"x-b": "2",
				"x-a": "1",
				"content-type": "text/html",
			});

			headers.append("set-cookie", "a=1; Path=/; HttpOnly");
			headers.append("set-cookie", "b=2; Path=/");

			return new Response("<p>é</p>", { status: 201, headers });
		};

		const got = await record(handler, {
			name: "case",
			steps: [{ path: "/text" }, { path: "/bin" }],
		});

		expect(got.steps[0].answer).toEqual({
			outcome: "response",
			status: 201,
			headers: { "content-type": "text/html", "x-a": "1", "x-b": "2" },
			setCookies: ["a=1; Path=/; HttpOnly", "b=2; Path=/"],
			body: "<p>é</p>",
		});

		expect(got.steps[1].answer).toMatchObject({
			body: {
				$bytes: { length: 3, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
			},
		});
	});

	it("reads a streamed body in full, and records a handler that throws as rejected", async () => {
		const handler: Handler = async (context) => {
			if (new URL(context.request.url).pathname === "/boom")
				throw new Error("boom");

			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("one "));
						controller.enqueue(new TextEncoder().encode("two"));
						controller.close();
					},
				}),
				{ headers: { "content-type": "text/plain" } },
			);
		};

		const got = await record(handler, {
			name: "case",
			steps: [{ path: "/s" }, { path: "/boom" }],
		});

		expect(got.steps[0].answer).toMatchObject({ body: "one two" });
		expect(got.steps[1].answer).toEqual({ outcome: "rejected" });
	});

	it("signs a client in through the real flow and sends the session cookie", async () => {
		const handler: Handler = async (context) =>
			new Response(context.request.headers.get("cookie") ?? "none");

		const got = await record(handler, {
			name: "case",
			music: { seed: { owner_requests: [rows.ownerRequest("r1")] } },
			steps: [{ path: "/x", as: asClient("grace@example.test") }],
		});

		const answer = got.steps[0].answer;

		expect(answer.outcome === "response" && answer.body).toMatch(
			/^studio_session=[0-9a-f-]{72}$/,
		);
		expect(got.effects).toEqual([]);
	});

	it("builds the real schemas, seeds rows and dumps tables in a stable order", () => {
		const music = freshMusicDb();
		seed(music, {
			owner_requests: [rows.ownerRequest("b"), rows.ownerRequest("a")],
		});

		expect(dump(music, ["owner_requests"]).owner_requests).toMatchObject([
			{ id: "b" },
			{ id: "a" },
		]);

		const publication = freshPublicationDb();

		expect(
			dump(publication, ["publication_outbox"]).publication_outbox,
		).toEqual([]);
		expect(() => dump(music, ["no_such_table"])).toThrow("no table");
		expect(() =>
			seed(music, { "owner_requests; DROP": [{ id: "x" }] }),
		).toThrow("bad name");
	});
});

describe("the comparison fails when a recorded behaviour changes", () => {
	const base: Case = {
		name: "base",
		music: { seed: { owner_requests: [rows.ownerRequest("r1")] } },
		steps: [{ path: "/x" }],
	};

	const handler =
		(
			change:
				| "none"
				| "header"
				| "body"
				| "extra-sql"
				| "status"
				| "swap"
				| "arg"
				| "sql"
				| "fewer"
				| "cookie",
		): Handler =>
		async (context) => {
			const db = env(context).MUSIC_DB!;

			const first = () =>
				db
					.prepare("SELECT id FROM owner_requests WHERE id=?")
					.bind(change === "arg" ? "r2" : "r1")
					.first();

			const second = () =>
				db
					.prepare(
						change === "sql"
							? "SELECT id  FROM owner_campaigns"
							: "SELECT id FROM owner_campaigns",
					)
					.all();

			if (change === "swap") {
				await second();
				await first();
			} else {
				await first();

				if (change !== "fewer") await second();
			}

			if (change === "extra-sql") await db.prepare("SELECT 1").first();

			const headers = new Headers({
				"content-type": "text/plain",
				"x-version": change === "header" ? "2" : "1",
			});

			if (change === "cookie") headers.append("set-cookie", "a=1");

			return new Response(change === "body" ? "ok!" : "ok", {
				status: change === "status" ? 202 : 200,
				headers,
			});
		};

	let baseline: CaseRecord;

	it("passes for an identical run", async () => {
		baseline = await record(handler("none"), base);
		sameRecord(asFixture(baseline), await record(handler("none"), base));
	});

	for (const change of [
		"header",
		"body",
		"extra-sql",
		"status",
		"swap",
		"arg",
		"sql",
		"fewer",
		"cookie",
	] as const)
		it(`fails when the route changes: ${change}`, async () => {
			const got = await record(handler(change), base);

			expect(() => sameRecord(asFixture(baseline), got)).toThrow();
		});

	it("fails when a recorded effect is reordered, dropped, or changed, or a body byte differs", async () => {
		const got = await record(handler("none"), base);
		const want = asFixture(got);
		const copy = (): CaseRecord => asFixture(got);

		const reordered = copy();
		reordered.effects.reverse();
		const dropped = copy();
		dropped.effects.pop();
		const sql = copy();
		const sqlEffect = sql.effects[0];

		if (sqlEffect.kind === "d1") sqlEffect.sql += " ";
		const arg = copy();
		const argEffect = arg.effects[0];

		if (argEffect.kind === "d1") argEffect.args = ["r2"];
		const body = copy();
		const answer = body.steps[0].answer;

		if (answer.outcome === "response") answer.body = "oK";
		const header = copy();
		const headerAnswer = header.steps[0].answer;

		if (headerAnswer.outcome === "response")
			headerAnswer.headers["x-version"] = "2";

		for (const mutated of [reordered, dropped, sql, arg, body, header])
			expect(() => sameRecord(want, mutated)).toThrow();

		expect(() => sameRecord(want, copy())).not.toThrow();
	});

	it("fails on a field that disappeared, which toEqual would skip", () => {
		const want = { name: "x", value: 1, gone: null };
		const got = { name: "x", value: 1, gone: undefined };

		expect(() => sameRecord(want, got)).toThrow();
	});
});

describe("a case with no script", () => {
	it("makes an unscripted fetch fail loudly, and records it", async () => {
		const handler: Handler = async () => {
			const result = await fetch("https://api.resend.com/emails").then(
				() => "sent",
				(error: Error) => error.message,
			);

			return new Response(result);
		};

		const got = await record(handler, one());

		expect(got.steps[0].answer).toMatchObject({
			body: "golden harness: no fetch scripted",
		});
		expect(got.effects[0]).toMatchObject({ kind: "fetch", host: "resend" });
	});

	it("serves a text answer and an empty 204", async () => {
		const handler: Handler = async () => {
			const a = await fetch("https://api.resend.com/a");
			const b = await fetch("https://api.resend.com/b");

			return new Response(
				`${a.status}:${await a.text()}|${b.status}:${(await b.text()).length}`,
			);
		};

		const got = await record(handler, {
			...one(),
			fetches: byHost({ resend: [text(500, "bad"), text(204, "")] }),
		});

		expect(got.steps[0].answer).toMatchObject({ body: "500:bad|204:0" });
	});
});
