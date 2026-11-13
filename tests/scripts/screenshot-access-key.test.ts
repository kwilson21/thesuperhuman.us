import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importJWK, jwtVerify, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateAccessKey } from "../../scripts/screenshots/access-key.mjs";

// Repository files are read from the working directory; the key file is a temporary absolute path.
const read = (path: string) => readFile(`${process.cwd()}/${path}`, "utf8");
const readAbs = (path: string) => readFile(path, "utf8");

let dir: string;
let file: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "access-key-"));
	file = join(dir, "nested", "access-key.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

// Signs with the loaded key and checks the served JWK verifies it, as the site's JWT check does.
async function verifies(
	key: Awaited<ReturnType<typeof loadOrCreateAccessKey>>,
) {
	const token = await new SignJWT({ email: "owner@example.test" })
		.setProtectedHeader({ alg: "RS256", kid: key.kid })
		.sign(key.privateKey);

	const publicKey = await importJWK(key.jwk, "RS256");
	const { payload } = await jwtVerify(token, publicKey);

	return payload.email;
}

describe("loadOrCreateAccessKey", () => {
	it("creates a key, writes it with owner-only permissions, and the key it serves verifies its tokens", async () => {
		const key = await loadOrCreateAccessKey(file);

		expect(key.kid).toEqual(expect.any(String));
		expect(key.jwk).toMatchObject({ kid: key.kid, alg: "RS256", use: "sig" });
		expect(key.jwk).not.toHaveProperty("d");
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(await verifies(key)).toBe("owner@example.test");
	});

	it("reuses the key already on disk, so the same key id is served on every run", async () => {
		const first = await loadOrCreateAccessKey(file);
		const before = await readAbs(file);

		const second = await loadOrCreateAccessKey(file);

		expect(second.kid).toBe(first.kid);
		expect(await readAbs(file)).toBe(before);
		expect(await verifies(second)).toBe("owner@example.test");
	});

	it("regenerates a file that is not valid JSON, and sets its mode to 0600", async () => {
		const first = await loadOrCreateAccessKey(file);
		await writeFile(file, "{ not json", { mode: 0o644 });

		const second = await loadOrCreateAccessKey(file);

		expect(second.kid).not.toBe(first.kid);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readAbs(file)).kid).toBe(second.kid);
	});

	it("regenerates a file whose private key is missing or unreadable", async () => {
		const first = await loadOrCreateAccessKey(file);
		const saved = JSON.parse(await readAbs(file));
		await writeFile(file, JSON.stringify({ ...saved, privateKeyPem: "junk" }));

		const second = await loadOrCreateAccessKey(file);

		expect(second.kid).not.toBe(first.kid);
		expect(await verifies(second)).toBe("owner@example.test");
	});

	it("regenerates a file whose served key id does not match its private key's", async () => {
		await loadOrCreateAccessKey(file);
		const saved = JSON.parse(await readAbs(file));
		await writeFile(
			file,
			JSON.stringify({ ...saved, jwk: { ...saved.jwk, kid: "other" } }),
		);

		const key = await loadOrCreateAccessKey(file);

		expect(key.kid).toBe(JSON.parse(await readAbs(file)).kid);
		expect(key.jwk.kid).toBe(key.kid);
		expect(await verifies(key)).toBe("owner@example.test");
	});

	it("is wired into capture, which no longer makes a key pair or a random key id per run", async () => {
		const capture = await read("scripts/screenshots/capture.mjs");

		expect(capture).toContain("loadOrCreateAccessKey(");
		expect(capture).not.toContain("generateKeyPair");
		expect(capture).not.toContain("randomUUID");
	});
});
