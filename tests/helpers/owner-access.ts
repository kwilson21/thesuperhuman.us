import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";
import { partial } from "./doubles";

// The Cloudflare Access team, application and owner that owner routes verify a token against. The real
// verifyOwnerAccess runs; only the platform's certificate endpoint (fetch) is answered here.
const issuer = "https://owner-test.cloudflareaccess.com";
const audience = "owner-application-audience";
const kid = "owner-test-key";
const certificates = new URL("/cdn-cgi/access/certs", issuer).href;

/** The owner's email, the one verifyOwnerAccess accepts. */
export const ownerEmail = "owner@example.com";

/** The OWNER_ACCESS_* bindings that owner routes read from the runtime env. */
export const ownerAccessEnv = partial<Env>({
	OWNER_ACCESS_TEAM_DOMAIN: issuer,
	OWNER_ACCESS_AUD: audience,
	OWNER_EMAIL: ownerEmail,
});

const keys = generateKeyPair("RS256");

/**
 * A signed Access application token for `email` and application audience `aud`, verifiable once
 * serveOwnerCertificates has run. A different `aud` gives a token the owner routes must refuse.
 */
export async function ownerAccessToken(
	email = ownerEmail,
	aud = audience,
): Promise<string> {
	const { privateKey } = await keys;

	return new SignJWT({ email, type: "app" })
		.setProtectedHeader({ alg: "RS256", kid })
		.setIssuer(issuer)
		.setAudience(aud)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(privateKey);
}

/**
 * Answers fetch for the Access certificate endpoint with the public key that signs ownerAccessToken, and for nothing
 * else: any other outgoing request throws, so an unexpected request is loud. Call it in beforeAll and
 * vi.unstubAllGlobals in afterAll. The stub is a vi.fn, so a test can count certificate requests on fetch.
 */
export async function serveOwnerCertificates(): Promise<void> {
	const { publicKey } = await keys;

	const key = {
		...(await exportJWK(publicKey)),
		kid,
		alg: "RS256",
		use: "sig",
	};

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = input instanceof Request ? input.url : String(input);

			if (url !== certificates)
				throw new Error(`owner-access: no answer scripted for ${url}`);

			return Response.json({ keys: [key] });
		}),
	);
}
