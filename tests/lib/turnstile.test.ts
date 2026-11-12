import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTurnstile } from "~/lib/turnstile";
import { double } from "../helpers/doubles";

describe("verifyTurnstile", () => {
	let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
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
