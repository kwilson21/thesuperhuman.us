// The throwaway signing key of the local Access issuer that capture.mjs starts on 127.0.0.1:9911. It signs
// owner tokens that only the local preview trusts (PREVIEW_OVERRIDES in config.mjs points the site at it). It is
// not a credential for anything. It lives in .screenshots/, which is gitignored and outside the CI cache and
// artifact paths (screenshots/ only), so it is never uploaded.
//
// The key is kept across runs rather than made fresh each time. The dev server keeps the keys it fetched, and
// jose will not fetch again for an unknown key id during its 30 second cooldown, which is measured on the
// server's clock. A run moves that clock, so a new key id on a running server could fail for a long time.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { exportJWK, exportPKCS8, generateKeyPair, importPKCS8 } from "jose";

async function createAccessKey() {
	const { publicKey, privateKey } = await generateKeyPair("RS256", {
		extractable: true,
	});

	const kid = randomUUID();

	return {
		kid,
		privateKeyPem: await exportPKCS8(privateKey),
		jwk: { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" },
	};
}

/** Reads the saved key, or undefined when the file is missing, not JSON, or does not hold a usable pair. */
async function readAccessKey(file) {
	try {
		const saved = JSON.parse(await readFile(file, "utf8"));

		if (
			typeof saved?.kid !== "string" ||
			typeof saved.privateKeyPem !== "string" ||
			saved.jwk?.kid !== saved.kid
		)
			return undefined;

		return {
			kid: saved.kid,
			privateKey: await importPKCS8(saved.privateKeyPem, "RS256"),
			jwk: saved.jwk,
		};
	} catch {
		return undefined;
	}
}

/**
 * The issuer's key at `file`: the saved one when it is intact, otherwise a new one that replaces the file.
 * The file is written owner-only. Returns `{ kid, privateKey, jwk }`, where `jwk` is the public key the issuer serves.
 */
export async function loadOrCreateAccessKey(file) {
	const saved = await readAccessKey(file);

	if (saved) return saved;

	const created = await createAccessKey();

	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(created, null, 2), { mode: 0o600 });
	// writeFile keeps the mode of a file it overwrites, so set it explicitly.
	await chmod(file, 0o600);

	return {
		kid: created.kid,
		privateKey: await importPKCS8(created.privateKeyPem, "RS256"),
		jwk: created.jwk,
	};
}
