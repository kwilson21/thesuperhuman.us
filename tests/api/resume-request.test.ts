import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import { POST } from "~/pages/api/resume-request";
import { double, partial, fakeKv } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { readJson, type JsonObject } from "../helpers/json";

const validBody = {
	name: "Jane Doe",
	email: "jane@example.com",
	company: "Acme",
	audience: "general",
	note: "",
	turnstileToken: "tok",
};

function makeKv() {
	const store = new Map<string, string>();

	return {
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		put: vi.fn(async (k: string, v: string) => {
			store.set(k, v);
		}),
		delete: vi.fn(async (k: string) => {
			store.delete(k);
		}),
	};
}

function makeContext(
	body: JsonObject,
	ip = "1.2.3.4",
	origin = "https://thesuperhuman.us",
	kv?: ReturnType<typeof makeKv>,
) {
	const sharedKv = fakeKv(kv ?? makeKv());

	return partial<APIContext>({
		request: new Request("https://thesuperhuman.us/api/resume-request", {
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
					RATE_LIMIT: sharedKv,
					RESUME_STORE: sharedKv,
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

describe("POST /api/resume-request", () => {
	it("returns 200 ok=true on valid submission", async () => {
		const res = await POST(makeContext(validBody));
		expect(res.status).toBe(200);
		const json = await readJson<{ ok: boolean }>(res);
		expect(json.ok).toBe(true);
	});

	it("returns 400 with errors on invalid input", async () => {
		const res = await POST(makeContext({ ...validBody, audience: "sales" }));
		expect(res.status).toBe(400);

		const json = await readJson<{
			ok: boolean;
			errors?: Record<string, string>;
		}>(res);

		expect(json.ok).toBe(false);
		expect(json.errors?.audience).toBeDefined();
	});

	it("rejects new DoD requests before storage or external requests", async () => {
		const kv = makeKv();

		const res = await POST(
			makeContext(
				{ ...validBody, audience: "dod" },
				"1.2.3.4",
				"https://thesuperhuman.us",
				kv,
			),
		);

		expect(res.status).toBe(400);
		expect(kv.put).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("returns 403 on origin mismatch", async () => {
		const res = await POST(
			makeContext(validBody, "1.2.3.4", "https://evil.example.com"),
		);

		expect(res.status).toBe(403);
	});

	it("returns 403 on Turnstile failure", async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).includes("challenges.cloudflare.com")) {
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

	it("returns 429 when same IP submits twice within rate-limit window", async () => {
		const kv = makeKv();

		const first = await POST(
			makeContext(validBody, "1.2.3.4", "https://thesuperhuman.us", kv),
		);

		expect(first.status).toBe(200);

		const second = await POST(
			makeContext(validBody, "1.2.3.4", "https://thesuperhuman.us", kv),
		);

		expect(second.status).toBe(429);
	});

	it("returns 500 if approval notification email fails", async () => {
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

	it("stores the request in KV and emails the operator with the approval link", async () => {
		const kv = makeKv();
		await POST(
			makeContext(validBody, "1.2.3.4", "https://thesuperhuman.us", kv),
		);

		const reqEntries = Array.from(kv.put.mock.calls).filter((c) =>
			String(c[0]).startsWith("req:"),
		);

		expect(reqEntries.length).toBe(1);

		const resendCall = vi
			.mocked(fetch)
			.mock.calls.find(([input]) => String(input).includes("resend.com"));

		expect(resendCall).toBeTruthy();
		const body = JSON.parse(String(resendCall?.[1]?.body));
		expect(body.to).toEqual(["kazon.wilson@thesuperhuman.us"]);
		expect(body.text).toContain("/api/resume-approve?id=");
		expect(body.text).toContain("general");
	});
});
