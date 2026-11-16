import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkTurnstile, verifyTurnstile } from "~/lib/turnstile";
import { double } from "../helpers/doubles";

describe("checkTurnstile", () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
	});

	it("passes when Cloudflare says success", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: true }) }),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe("passed");
	});

	it("refuses when a parsed answer does not say success is true", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: false }) }),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe("refused");
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: "true" }) }),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe("refused");
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => [] }),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe("refused");
	});

	it.each([
		"internal-error",
		"missing-input-secret",
		"invalid-input-secret",
		"bad-request",
	])(
		"is unavailable when Cloudflare reports %s, which is a fault on our side",
		async (code) => {
			fetchMock.mockResolvedValueOnce(
				double<Response>({
					ok: true,
					json: async () => ({ success: false, "error-codes": [code] }),
				}),
			);
			expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
				"unavailable",
			);
		},
	);

	it.each([
		"missing-input-response",
		"invalid-input-response",
		"timeout-or-duplicate",
		"some-future-code",
	])(
		"is refused when Cloudflare reports %s, a fault of the visitor's token",
		async (code) => {
			fetchMock.mockResolvedValueOnce(
				double<Response>({
					ok: true,
					json: async () => ({ success: false, "error-codes": [code] }),
				}),
			);
			expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe("refused");
		},
	);

	it("is unavailable when a fault code comes with a visitor code", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({
					success: false,
					"error-codes": ["invalid-input-response", "invalid-input-secret"],
				}),
			}),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
			"unavailable",
		);
	});

	it("is unavailable when fetch rejects or times out", async () => {
		fetchMock.mockRejectedValueOnce(new Error("network"));
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
			"unavailable",
		);
		fetchMock.mockRejectedValueOnce(new DOMException("slow", "TimeoutError"));
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
			"unavailable",
		);
	});

	it("is unavailable when the answer is not OK, even with success in the body", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: false, json: async () => ({ success: true }) }),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
			"unavailable",
		);
	});

	it("is unavailable when the answer is not JSON", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => {
					throw new SyntaxError("Unexpected token <");
				},
			}),
		);
		expect(await checkTurnstile("tok", "secret", "1.2.3.4")).toBe(
			"unavailable",
		);
	});
});

describe("verifyTurnstile", () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
	});

	it("is true only for a passed check, false for refused and unavailable", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: true }) }),
		);
		expect(await verifyTurnstile("tok", "secret", "1.2.3.4")).toBe(true);
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: false }) }),
		);
		expect(await verifyTurnstile("tok", "secret", "1.2.3.4")).toBe(false);
		fetchMock.mockRejectedValueOnce(new Error("network"));
		expect(await verifyTurnstile("tok", "secret", "1.2.3.4")).toBe(false);
	});

	it("returns true when Cloudflare says success", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({ success: true }),
			}),
		);
		const result = await verifyTurnstile("tok", "secret", "1.2.3.4");
		expect(result).toBe(true);
	});

	it("returns false when Cloudflare says failure", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({
					success: false,
					"error-codes": ["invalid-input-response"],
				}),
			}),
		);
		const result = await verifyTurnstile("tok", "secret", "1.2.3.4");
		expect(result).toBe(false);
	});

	it("returns false when fetch rejects", async () => {
		fetchMock.mockRejectedValueOnce(new Error("network"));
		const result = await verifyTurnstile("tok", "secret", "1.2.3.4");
		expect(result).toBe(false);
	});

	it("returns false when fetch returns non-OK", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: false,
				json: async () => ({}),
			}),
		);
		const result = await verifyTurnstile("tok", "secret", "1.2.3.4");
		expect(result).toBe(false);
	});

	it("sends token, secret, and remoteip in the form body", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({ success: true }),
			}),
		);
		await verifyTurnstile("TOKEN", "SECRET", "9.9.9.9");
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain("challenges.cloudflare.com");
		const body = new URLSearchParams(String(init?.body));
		expect(body.get("response")).toBe("TOKEN");
		expect(body.get("secret")).toBe("SECRET");
		expect(body.get("remoteip")).toBe("9.9.9.9");
	});
});
