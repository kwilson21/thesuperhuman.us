import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import { GET, HEAD, POST } from "~/pages/api/resume-approve";
import { double, partial, fakeKv } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";

const sampleRequest = {
	name: "Jane Doe",
	email: "jane@example.com",
	company: "Acme",
	audience: "dod" as const,
	note: "",
	ts: 1700000000000,
};

function makeBinaryKv(
	pdfs: Partial<Record<string, ArrayBuffer>>,
	storedRequests: Partial<Record<string, typeof sampleRequest>> = {},
) {
	return fakeKv({
		get: vi.fn(async (k: string, type?: string) => {
			if (type === "arrayBuffer") return pdfs[k] ?? null;
			const request = storedRequests[k];

			return request === undefined ? null : JSON.stringify(request);
		}),
		put: vi.fn(),
		delete: vi.fn(),
	});
}

function makeContext(
	kv: ReturnType<typeof makeBinaryKv>,
	method: "GET" | "HEAD" | "POST",
	options: { id?: string; origin?: string; malformed?: boolean } = {},
) {
	const url = "https://thesuperhuman.us/api/resume-approve?id=abc";
	const headers = new Headers();
	let body: string | undefined;

	if (method === "POST") {
		headers.set("content-type", "application/x-www-form-urlencoded");

		if (options.origin !== undefined) headers.set("origin", options.origin);
		body = options.malformed
			? "%"
			: new URLSearchParams({ id: options.id ?? "abc" }).toString();
	}

	const request = new Request(url, { method, headers, body });

	return partial<APIContext>({
		request,
		url: new URL(url),
		locals: {
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					RESEND_API_KEY: "key",
					CONTACT_FROM_EMAIL: "noreply@thesuperhuman.us",
					RATE_LIMIT: kv,
					RESUME_STORE: kv,
				}),
			}),
		},
	});
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchMock = vi.fn<typeof fetch>(async (url) => {
		if (String(url).includes("resend.com"))
			return double<Response>({ ok: true, json: async () => ({ id: "em_1" }) });

		return double<Response>({ ok: false, json: async () => ({}) });
	});
	vi.stubGlobal("fetch", fetchMock);
});

function expectPrivateResponse(response: Response) {
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("referrer-policy")).toBe("strict-origin");
	expect(response.headers.get("x-robots-tag")).toContain("noindex");
	expect(response.headers.get("content-security-policy")).toContain(
		"form-action 'self'",
	);
}

describe("/api/resume-approve", () => {
	it("GET renders a deliberate approval form without reading or delivering the resume", async () => {
		const kv = makeBinaryKv({});
		const response = await GET(makeContext(kv, "GET"));
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(text).toContain('method="post"');
		expect(text).toContain('name="id" value="abc"');
		expect(text).toContain("Approve and send resume");
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.delete).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});

	it("HEAD never reads or delivers the resume", async () => {
		const kv = makeBinaryKv({});
		const response = await HEAD(makeContext(kv, "HEAD"));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
		expect(kv.get).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});

	it("a same-origin explicit POST delivers and consumes the private request", async () => {
		const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
		const kv = makeBinaryKv({ "pdf:dod": pdf }, { "req:abc": sampleRequest });

		const response = await POST(
			makeContext(kv, "POST", { origin: "https://thesuperhuman.us" }),
		);

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("Resume sent");
		expect(text).not.toContain(sampleRequest.email);
		expect(kv.delete).toHaveBeenCalledWith("req:abc");

		const resend = fetchMock.mock.calls.find(([input]) =>
			String(input).includes("resend.com"),
		);

		expect(resend).toBeTruthy();
		expect(JSON.parse(String(resend?.[1]?.body)).to).toEqual([
			"jane@example.com",
		]);
		expectPrivateResponse(response);
	});

	it("rejects a sequential retry after the capability has been deleted", async () => {
		const pdf = new ArrayBuffer(4);

		const storedRequests = {
			"req:abc": { ...sampleRequest },
		};

		const kv = makeBinaryKv({ "pdf:dod": pdf }, storedRequests);
		await POST(makeContext(kv, "POST", { origin: "https://thesuperhuman.us" }));
		// Simulate KV's single-use deletion between a double click and its second request.
		Reflect.deleteProperty(storedRequests, "req:abc");

		const response = await POST(
			makeContext(kv, "POST", { origin: "https://thesuperhuman.us" }),
		);

		expect(response.status).toBe(404);
		expect(
			fetchMock.mock.calls.filter(([input]) =>
				String(input).includes("resend.com"),
			),
		).toHaveLength(1);
	});

	it("rejects a missing or cross-origin Origin before reading or delivering", async () => {
		for (const origin of [undefined, "https://attacker.example"]) {
			const kv = makeBinaryKv({});
			const response = await POST(makeContext(kv, "POST", { origin }));
			expect(response.status).toBe(403);
			expect(kv.get).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expectPrivateResponse(response);
		}
	});

	it("rejects malformed or missing capability form data", async () => {
		for (const options of [{ malformed: true }, { id: "" }]) {
			const kv = makeBinaryKv({});

			const response = await POST(
				makeContext(kv, "POST", {
					origin: "https://thesuperhuman.us",
					...options,
				}),
			);

			expect(response.status).toBe(400);
			expect(kv.get).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		}
	});
});
