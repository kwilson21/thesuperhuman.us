import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	exportJWK,
	generateKeyPair,
	importJWK,
	jwtVerify,
	SignJWT,
} from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateAccessKey } from "../../scripts/screenshots/access-key.mjs";

// Repository files are read from the working directory; the key file is a temporary absolute path.
const read = (path: string) => readFile(`${process.cwd()}/${path}`, "utf8");
const readAbs = (path: string) => readFile(path, "utf8");

const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"];

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

	it("saves only the key id and the private key, since the public key is derived from the private one", async () => {
		await loadOrCreateAccessKey(file);

		expect(Object.keys(JSON.parse(await readAbs(file))).sort()).toEqual([
			"kid",
			"privateKeyPem",
		]);
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

	it("regenerates a file whose private key is unreadable", async () => {
		const first = await loadOrCreateAccessKey(file);
		const saved = JSON.parse(await readAbs(file));
		await writeFile(file, JSON.stringify({ ...saved, privateKeyPem: "junk" }));

		const second = await loadOrCreateAccessKey(file);

		expect(second.kid).not.toBe(first.kid);
		expect(await verifies(second)).toBe("owner@example.test");
	});

	it("regenerates a file that has no private key at all", async () => {
		const first = await loadOrCreateAccessKey(file);
		await writeFile(file, JSON.stringify({ kid: first.kid }));

		const second = await loadOrCreateAccessKey(file);

		expect(second.kid).not.toBe(first.kid);
		expect(await verifies(second)).toBe("owner@example.test");
	});

	it("serves the public key of the private key in the file, whatever public part sits beside it", async () => {
		const first = await loadOrCreateAccessKey(file);
		const saved = JSON.parse(await readAbs(file));
		const { publicKey } = await generateKeyPair("RS256", { extractable: true });
		const other = await exportJWK(publicKey);

		// A tampered public part: another key's modulus, and a private field that must not be served.
		await writeFile(
			file,
			JSON.stringify({
				...saved,
				jwk: { ...other, kid: saved.kid, d: "leaked" },
			}),
		);

		const key = await loadOrCreateAccessKey(file);

		expect(key.jwk.n).toBe(first.jwk.n);
		expect(await verifies(key)).toBe("owner@example.test");
	});

	it("serves a public key with no private fields, the same on every load", async () => {
		const created = await loadOrCreateAccessKey(file);
		const again = await loadOrCreateAccessKey(file);

		for (const field of PRIVATE_FIELDS)
			expect(created.jwk).not.toHaveProperty(field);
		expect(again.jwk).toEqual(created.jwk);
	});

	it("writes the file through a rename: the replaced file is a new one, owner-only, with no temporary file left beside it", async () => {
		await loadOrCreateAccessKey(file);
		const before = (await stat(file)).ino;
		await writeFile(file, "{ not json");

		await loadOrCreateAccessKey(file);

		expect((await stat(file)).ino).not.toBe(before);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(await readdir(join(dir, "nested"))).toEqual(["access-key.json"]);
	});

	it("replaces a symbolic link at the path with a regular file and leaves the link's target untouched", async () => {
		const target = join(dir, "elsewhere.txt");
		await writeFile(target, "keep me");
		await mkdir(join(dir, "nested"));
		await symlink(target, file);

		const key = await loadOrCreateAccessKey(file);

		expect((await lstat(file)).isSymbolicLink()).toBe(false);
		expect((await lstat(file)).isFile()).toBe(true);
		expect(await readFile(target, "utf8")).toBe("keep me");
		expect(await verifies(key)).toBe("owner@example.test");
	});

	it("does not reuse a key that a symbolic link points to, and leaves that file as it was", async () => {
		const target = join(dir, "elsewhere.json");
		const existing = await loadOrCreateAccessKey(target);
		const before = await readAbs(target);
		await mkdir(join(dir, "nested"));
		await symlink(target, file);

		const key = await loadOrCreateAccessKey(file);

		expect(key.kid).not.toBe(existing.kid);
		expect(await readAbs(target)).toBe(before);
	});

	it("is wired into capture, which no longer makes a key pair or a random key id per run", async () => {
		const capture = await read("scripts/screenshots/capture.mjs");

		expect(capture).toContain("loadOrCreateAccessKey(");
		expect(capture).not.toContain("generateKeyPair");
		expect(capture).not.toContain("randomUUID");
	});
});
