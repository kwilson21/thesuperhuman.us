import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOwnerAccess } from "~/lib/owner-access";
import {
	ownerAccessEnv,
	ownerAccessToken,
	ownerEmail,
	serveOwnerCertificates,
} from "../helpers/owner-access";

function requestWith(token: string): Request {
	return new Request("https://thesuperhuman.us/owner", {
		headers: { "cf-access-jwt-assertion": token },
	});
}

beforeEach(async () => {
	await serveOwnerCertificates();
});

afterEach(() => vi.unstubAllGlobals());

describe("owner Access verification", () => {
	it("accepts a signed application token for the configured owner", async () => {
		const first = requestWith(await ownerAccessToken());
		const second = requestWith(await ownerAccessToken());
		await expect(verifyOwnerAccess(first, ownerAccessEnv)).resolves.toEqual({
			email: ownerEmail,
		});
		await expect(verifyOwnerAccess(second, ownerAccessEnv)).resolves.toEqual({
			email: ownerEmail,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("rejects missing, wrong-audience and wrong-owner tokens", async () => {
		await expect(
			verifyOwnerAccess(
				new Request("https://thesuperhuman.us/owner"),
				ownerAccessEnv,
			),
		).resolves.toBeNull();
		await expect(
			verifyOwnerAccess(
				requestWith(await ownerAccessToken(ownerEmail, "other-app")),
				ownerAccessEnv,
			),
		).resolves.toBeNull();
		await expect(
			verifyOwnerAccess(
				requestWith(await ownerAccessToken("other@example.com")),
				ownerAccessEnv,
			),
		).resolves.toBeNull();
	});

	it("rejects invalid signatures and incomplete configuration", async () => {
		const token = await ownerAccessToken();
		const parts = token.split(".");
		parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;

		await expect(
			verifyOwnerAccess(requestWith(parts.join(".")), ownerAccessEnv),
		).resolves.toBeNull();
		await expect(
			verifyOwnerAccess(requestWith(token), {
				...ownerAccessEnv,
				OWNER_ACCESS_AUD: "",
			}),
		).resolves.toBeNull();
	});
});
