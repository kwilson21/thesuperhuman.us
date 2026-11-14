import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { verifyOwnerAccess } from "~/lib/owner-access";
import {
	ownerAccessEnv,
	ownerAccessToken,
	ownerEmail,
	serveOwnerCertificates,
} from "./owner-access";

beforeAll(async () => serveOwnerCertificates());

afterAll(() => vi.unstubAllGlobals());

function requestWith(token: string): Request {
	return new Request("https://thesuperhuman.us/owner", {
		headers: { "cf-access-jwt-assertion": token },
	});
}

it("accepts a token for the owner once the certificates are served", async () => {
	expect(
		await verifyOwnerAccess(
			requestWith(await ownerAccessToken()),
			ownerAccessEnv,
		),
	).toEqual({ email: ownerEmail });
});

it("rejects a valid token for a different email", async () => {
	expect(
		await verifyOwnerAccess(
			requestWith(await ownerAccessToken("someone-else@example.com")),
			ownerAccessEnv,
		),
	).toBeNull();
});

it("refuses any request other than the Access certificates", async () => {
	await expect(fetch("https://example.com/")).rejects.toThrow(
		"no answer scripted",
	);
});
