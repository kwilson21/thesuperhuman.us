import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import {
	GET as legacyGet,
	HEAD as legacyHead,
	POST as legacyPost,
} from "~/pages/api/resume-approve";
import {
	GET as ownerGet,
	HEAD as ownerHead,
	POST as ownerPost,
} from "~/pages/owner/resume-approve";
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
		get: vi.fn(async (key: string, type?: string) => {
			if (type === "arrayBuffer") return pdfs[key] ?? null;
			const request = storedRequests[key];

			return request === undefined ? null : JSON.stringify(request);
		}),
		put: vi.fn(),
		delete: vi.fn(),
	});
}

function makeContext(
	kv: ReturnType<typeof makeBinaryKv>,
	method: "GET" | "HEAD" | "POST",
	options: {
		id?: string;
		origin?: string;
		path?: string;
		owner?: boolean;
		malformed?: boolean;
	} = {},
) {
	const origin = "https://thesuperhuman.us";
	const path = options.path ?? "/owner/resume-approve";
	const url = `${origin}${path}${options.id === undefined ? "?id=abc" : `?id=${encodeURIComponent(options.id)}`}`;
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

	const locals = partial<APIContext["locals"]>({
		runtime: partial<TestRuntime>({
			env: partial<TestRuntime["env"]>({
				RESEND_API_KEY: "key",
				CONTACT_FROM_EMAIL: "noreply@thesuperhuman.us",
				RATE_LIMIT: kv,
				RESUME_STORE: kv,
			}),
		}),
	});

	if (options.owner) locals.owner = { email: "owner@example.test" };

	return partial<APIContext>({ request, url: new URL(url), locals });
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

function expectPrivateResponse(
	response: Response,
	formAction: "self" | "none" = "self",
) {
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("referrer-policy")).toBe("strict-origin");
	expect(response.headers.get("x-robots-tag")).toContain("noindex");
	expect(response.headers.get("content-security-policy")).toContain(
		"form-action '" + formAction + "'",
	);
}

describe("legacy /api/resume-approve", () => {
	it("preserves outstanding GET links by redirecting into the protected owner page", async () => {
		const kv = makeBinaryKv({});

		const response = await legacyGet(
			makeContext(kv, "GET", { path: "/api/resume-approve" }),
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"/owner/resume-approve?id=abc",
		);
		expect(kv.get).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response, "none");
	});

	it("keeps HEAD non-mutating and makes the legacy POST incapable of delivery", async () => {
		const kv = makeBinaryKv({});

		const head = await legacyHead(
			makeContext(kv, "HEAD", { path: "/api/resume-approve" }),
		);

		const post = await legacyPost(
			makeContext(kv, "POST", {
				path: "/api/resume-approve",
				origin: "https://thesuperhuman.us",
			}),
		);

		expect(head.status).toBe(303);
		expect(post.status).toBe(405);
		expect(post.headers.get("allow")).toBe("GET, HEAD");
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.delete).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(head, "none");
		expectPrivateResponse(post, "none");
	});
});

describe("owner resume approval", () => {
	it("refuses unauthenticated GET and POST without reading or delivering", async () => {
		const kv = makeBinaryKv({});
		const get = await ownerGet(makeContext(kv, "GET"));

		const post = await ownerPost(
			makeContext(kv, "POST", { origin: "https://thesuperhuman.us" }),
		);

		expect(get.status).toBe(403);
		expect(post.status).toBe(403);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.delete).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(get);
		expectPrivateResponse(post);
	});

	it("authenticated GET renders one explicit confirmation and performs no delivery", async () => {
		const kv = makeBinaryKv({});
		const response = await ownerGet(makeContext(kv, "GET", { owner: true }));
		const text = await response.text();
		expect(response.status).toBe(200);
		expect(text).toContain('method="post"');
		expect(text).toContain('name="id" value="abc"');
		expect(text).toContain("Approve and send resume");
		expect(text).not.toContain("jane@example.com");
		expect(text).not.toContain("https://fonts.");
		expect(kv.get).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});

	it("authenticated HEAD never reads or delivers", async () => {
		const kv = makeBinaryKv({});
		const response = await ownerHead(makeContext(kv, "HEAD", { owner: true }));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
		expect(kv.get).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});

	it("same-origin authenticated POST delivers only to the stored requester", async () => {
		const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
		const kv = makeBinaryKv({ "pdf:dod": pdf }, { "req:abc": sampleRequest });

		const response = await ownerPost(
			makeContext(kv, "POST", {
				owner: true,
				origin: "https://thesuperhuman.us",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Resume sent");
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

	it("rejects cross-origin POST before reading or delivering", async () => {
		const kv = makeBinaryKv({});

		const response = await ownerPost(
			makeContext(kv, "POST", {
				owner: true,
				origin: "https://attacker.example",
			}),
		);

		expect(response.status).toBe(403);
		expect(kv.get).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});

	it("keeps expired capabilities safe and retryable without delivering", async () => {
		const pdf = new ArrayBuffer(4);
		const kv = makeBinaryKv({ "pdf:dod": pdf });

		const response = await ownerPost(
			makeContext(kv, "POST", {
				owner: true,
				origin: "https://thesuperhuman.us",
			}),
		);

		expect(response.status).toBe(404);
		expect(kv.delete).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expectPrivateResponse(response);
	});
});
