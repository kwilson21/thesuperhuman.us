// The throwaway signing key of the local Access issuer that capture.mjs starts on 127.0.0.1:9911. It signs
// owner tokens that only the local preview trusts (PREVIEW_OVERRIDES in config.mjs points the site at it). It is
// not a credential for anything. It lives in .screenshots/, which is gitignored and outside the CI cache and
// artifact paths (screenshots/ only), so it is never uploaded.
//
// The key is kept across runs rather than made fresh each time. The dev server keeps the keys it fetched, and
// jose will not fetch again for an unknown key id during its 30 second cooldown, which is measured on the
// server's clock. A run moves that clock, so a new key id on a running server could fail for a long time.
import { createPublicKey, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { exportJWK, exportPKCS8, generateKeyPair, importPKCS8 } from "jose";

/** The key pair for a saved record: the private key, and the public JWK derived from it on every load. */
async function keyFrom({ kid, privateKeyPem }) {
	const publicJwk = await exportJWK(createPublicKey(privateKeyPem));

	return {
		kid,
		privateKey: await importPKCS8(privateKeyPem, "RS256"),
		jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" },
	};
}

async function createAccessKey() {
	const { privateKey } = await generateKeyPair("RS256", { extractable: true });

	return { kid: randomUUID(), privateKeyPem: await exportPKCS8(privateKey) };
}

/**
 * Reads the saved key, or undefined when the file is missing, is not a plain file, is not JSON, or does not
 * hold a usable private key. A link is never followed, so a key reached through one is not reused.
 */
async function readAccessKey(file) {
	try {
		if (!(await lstat(file)).isFile()) return undefined;

		const saved = JSON.parse(await readFile(file, "utf8"));

		if (
			typeof saved?.kid !== "string" ||
			typeof saved.privateKeyPem !== "string"
		)
			return undefined;

		return await keyFrom(saved);
	} catch {
		return undefined;
	}
}

/**
 * Writes the record owner-only. The bytes go to a new temporary file beside the target, which must not exist
 * yet (the exclusive flag), and that file is renamed over the target. A link at the target is replaced, not
 * followed, and a failed write leaves no temporary file behind.
 */
async function writeAccessKey(file, record) {
	const temporary = `${file}.${randomUUID()}.tmp`;

	try {
		await writeFile(temporary, JSON.stringify(record, null, 2), {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

/**
 * The issuer's key at `file`: the saved one when it is intact, otherwise a new one that replaces the file.
 * Only the key id and the private key are saved; the served public JWK is derived from the private key, so a
 * saved public part can neither disagree with it nor carry a private field. Returns `{ kid, privateKey, jwk }`.
 */
export async function loadOrCreateAccessKey(file) {
	const existing = await readAccessKey(file);

	if (existing) return existing;

	const created = await createAccessKey();

	await mkdir(dirname(file), { recursive: true });
	await writeAccessKey(file, created);

	return keyFrom(created);
}
