import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import { POST } from "~/pages/api/contact";
import { double, partial, fakeKv } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { readJson, type JsonObject } from "../helpers/json";

type ContactBody = {
	ok: boolean;
	errors?: Record<string, string>;
	error?: string;
};

const validBody = {
	name: "Jane",
	email: "jane@example.com",
	company: "",
	description: "Hello!",
	turnstileToken: "tok",
};

function makeKv() {
	const store = new Map<string, string>();

	return {
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		put: vi.fn(async (k: string, v: string) => {
			store.set(k, v);
		}),
	};
}

function makeContext(
	body: JsonObject,
	ip = "1.2.3.4",
	origin = "https://thesuperhuman.us",
) {
	const kv = makeKv();

	return partial<APIContext>({
		request: new Request("https://thesuperhuman.us/api/contact", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"cf-connecting-ip": ip,
				origin,
			},
			body: JSON.stringify(body),
		}),
		locals: partial<APIContext["locals"]>({
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					RESEND_API_KEY: "key",
					TURNSTILE_SECRET_KEY: "secret",
					CONTACT_TO_EMAIL: "kazon.wilson@thesuperhuman.us",
					CONTACT_FROM_EMAIL: "noreply@thesuperhuman.us",
					RATE_LIMIT: fakeKv(kv),
				}),
			}),
		}),
	});
}

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async (input) => {
			const url = String(input);

			if (url.includes("challenges.cloudflare.com")) {
				return double<Response>({
					ok: true,
					json: async () => ({ success: true }),
				});
			}

			if (url.includes("resend.com")) {
				return double<Response>({
					ok: true,
					json: async () => ({ id: "em_1" }),
				});
			}

			return double<Response>({ ok: false, json: async () => ({}) });
		}),
	);
});

describe("POST /api/contact", () => {
	it("returns 200 ok=true on valid submission", async () => {
		const res = await POST(makeContext(validBody));
		expect(res.status).toBe(200);

		const json = await readJson<ContactBody>(res);

		expect(json.ok).toBe(true);
	});

	it("returns 400 with errors on invalid input", async () => {
		const res = await POST(makeContext({ ...validBody, email: "bad" }));
		expect(res.status).toBe(400);

		const json = await readJson<ContactBody>(res);

		expect(json.ok).toBe(false);
		expect(json.errors?.email).toBeDefined();
	});

	it("returns 403 on Turnstile failure", async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);

			if (url.includes("challenges.cloudflare.com")) {
				return double<Response>({
					ok: true,
					json: async () => ({ success: false }),
				});
			}

			return double<Response>({ ok: true, json: async () => ({ id: "em" }) });
		});
		const res = await POST(makeContext(validBody));
		expect(res.status).toBe(403);
	});

	it("returns 429 on rate-limit hit", async () => {
		const ctx = makeContext(validBody);
		const first = await POST(ctx);
		expect(first.status).toBe(200);

		const ctx2 = {
			...ctx,
			request: new Request("https://thesuperhuman.us/api/contact", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"cf-connecting-ip": "1.2.3.4",
					origin: "https://thesuperhuman.us",
				},
				body: JSON.stringify(validBody),
			}),
		};

		ctx2.locals.runtime.env.RATE_LIMIT = ctx.locals.runtime.env.RATE_LIMIT;
		const second = await POST(ctx2);
		expect(second.status).toBe(429);
	});

	it("returns 403 on origin mismatch", async () => {
		const res = await POST(
			makeContext(validBody, "1.2.3.4", "https://evil.example.com"),
		);

		expect(res.status).toBe(403);
	});

	it("returns 500 if Resend primary email fails", async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);

			if (url.includes("challenges.cloudflare.com")) {
				return double<Response>({
					ok: true,
					json: async () => ({ success: true }),
				});
			}

			if (url.includes("resend.com")) {
				return double<Response>({
					ok: false,
					status: 500,
					json: async () => ({}),
				});
			}

			return double<Response>({ ok: false, json: async () => ({}) });
		});
		const res = await POST(makeContext(validBody));
		expect(res.status).toBe(500);
	});
});
