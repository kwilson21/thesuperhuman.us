import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import { GET } from "~/pages/api/resume-approve";
import { double, fakeKv } from "../helpers/doubles";

type TestRuntime = APIContext["locals"]["runtime"];

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
			if (type === "arrayBuffer") {
				return pdfs[k] ?? null;
			}

			const r = storedRequests[k];

			return r === undefined ? null : JSON.stringify(r);
		}),
		put: vi.fn(),
		delete: vi.fn(),
	});
}

function makeContext(id: string | null, kv: ReturnType<typeof makeBinaryKv>) {
	const url =
		id === null
			? "https://thesuperhuman.us/api/resume-approve"
			: `https://thesuperhuman.us/api/resume-approve?id=${id}`;

	return double<APIContext>({
		request: new Request(url, { method: "GET" }),
		url: new URL(url),
		locals: {
			runtime: double<TestRuntime>({
				env: double<TestRuntime["env"]>({
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
		if (String(url).includes("resend.com")) {
			return double<Response>({
				ok: true,
				json: async () => ({ id: "em_1" }),
			});
		}

		return double<Response>({ ok: false, json: async () => ({}) });
	});
	vi.stubGlobal("fetch", fetchMock);
});

describe("GET /api/resume-approve", () => {
	it("returns 400 HTML when id is missing", async () => {
		const kv = makeBinaryKv({});
		const res = await GET(makeContext(null, kv));
		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("returns 404 HTML when id is not in KV", async () => {
		const kv = makeBinaryKv({});
		const res = await GET(makeContext("does-not-exist", kv));
		expect(res.status).toBe(404);
		const text = await res.text();
		expect(text).toMatch(/already processed|expired|not found/i);
	});

	it("returns 500 HTML when the PDF is missing from KV", async () => {
		const kv = makeBinaryKv({}, { "req:abc": sampleRequest });
		const res = await GET(makeContext("abc", kv));
		expect(res.status).toBe(500);
		// Request should NOT be deleted on failure, so operator can retry after fixing.
		expect(kv.delete).not.toHaveBeenCalled();
	});

	it("still fulfills a stored legacy DoD request and consumes it only after delivery", async () => {
		const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer; // "%PDF-"
		const kv = makeBinaryKv({ "pdf:dod": pdf }, { "req:abc": sampleRequest });
		const res = await GET(makeContext("abc", kv));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");

		const text = await res.text();
		expect(text).toContain("jane@example.com");
		expect(text).toMatch(/sent/i);

		expect(kv.delete).toHaveBeenCalledWith("req:abc");

		const resendCall = fetchMock.mock.calls.find(([input]) =>
			String(input).includes("resend.com"),
		);

		expect(resendCall).toBeTruthy();
		const body = JSON.parse(String(resendCall?.[1]?.body));
		expect(body.to).toEqual(["jane@example.com"]);
		expect(body.attachments).toHaveLength(1);
		expect(body.attachments[0].filename).toBe("kazon-wilson-resume-dod.pdf");
	});

	it("does not delete the request when send fails", async () => {
		const pdf = new ArrayBuffer(4);
		const kv = makeBinaryKv({ "pdf:dod": pdf }, { "req:abc": sampleRequest });
		fetchMock.mockResolvedValue(
			double<Response>({
				ok: false,
				status: 500,
				json: async () => ({}),
			}),
		);
		const res = await GET(makeContext("abc", kv));
		expect(res.status).toBe(500);
		expect(kv.delete).not.toHaveBeenCalled();
	});
});
