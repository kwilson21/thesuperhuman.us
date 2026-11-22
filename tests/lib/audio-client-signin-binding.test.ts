import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteD1, DatabaseSync } from "../helpers/sqlite-d1";
import { studioSignin } from "../helpers/studio-signin";

// A sign-in code belongs to the browser that asked for it. These cases are the threats against that: other people who know
// the address, a second browser, expiry, reuse and the limits, run through the issue and the entry of the sign-in flows
// (src/server/flows/signin-code.ts and signin-session.ts, after the routes' allowances). The model is
// verification/signin-codes.qnt.

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

const secret = "studio-code-key-for-tests-32-characters";
const now = new Date("2026-09-22T12:00:00.000Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const address = "artist@example.com";

const otherAddress = "other@example.com";

function fixture() {
	const sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);
	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service',?,'A song','new',?,?)`)
		.run(address, now.toISOString(), now.toISOString());
	sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-2','service',?,'Another song','new',?,?)`)
		.run(otherAddress, now.toISOString(), now.toISOString());

	return { sql, signin: studioSignin(sqliteD1(sql), secret) };
}

const rows = (sql: InstanceType<typeof DatabaseSync>) =>
	sql
		.prepare(
			"SELECT nonce_hash,attempts,code_hash FROM audio_client_signin_codes ORDER BY created_at,nonce_hash",
		)
		.all();

const wrongFor = (code: string) =>
	code === "00000000" ? "11111111" : "00000000";

describe("a sign-in code belongs to the browser that asked for it", () => {
	it("is not charged, or opened, by guesses that carry no matching cookie", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;
		const before = rows(sql);

		for (const nonce of [null, "", "f".repeat(64), "F".repeat(64), "short"])
			for (let attempt = 0; attempt < 8; attempt++)
				expect(
					await signin.enter(
						address,
						attempt === 7 ? client.code : wrongFor(client.code),
						nonce,
						now,
					),
				).toBeNull();

		expect(rows(sql)).toEqual(before);

		expect(
			await signin.enter(address, client.code, client.nonce, now),
		).toBeTruthy();
		sql.close();
	});

	it("keeps the client's code working when a stranger asks for codes and spends their own attempts", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;
		const stranger = (await signin.issue(address, later(5)))!;

		for (let attempt = 0; attempt < 5; attempt++)
			await signin.enter(
				address,
				wrongFor(stranger.code),
				stranger.nonce,
				later(6),
			);

		expect(
			await signin.enter(address, stranger.code, stranger.nonce, later(7)),
		).toBeNull();
		expect(rows(sql)).toHaveLength(2);

		expect(
			await signin.enter(address, client.code, client.nonce, later(8)),
		).toBeTruthy();
		sql.close();
	});

	it("does not accept the client's code from another browser, and does not charge the client's code for it", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;
		const other = (await signin.issue(address, later(40)))!;

		// The right code, the wrong browser: tied to the other browser's own row, so it fails there.
		expect(
			await signin.enter(address, client.code, other.nonce, later(41)),
		).toBeNull();
		expect(
			await signin.enter(address, client.code, null, later(41)),
		).toBeNull();

		const clientRow = sql
			.prepare(
				"SELECT attempts FROM audio_client_signin_codes ORDER BY created_at LIMIT 1",
			)
			.get();

		expect(clientRow).toEqual({ attempts: 0 });
		expect(
			await signin.enter(address, client.code, client.nonce, later(42)),
		).toBeTruthy();
		sql.close();
	});

	it("limits the client's own mistypes to their own code, and a new request starts clean", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;

		for (let attempt = 0; attempt < 5; attempt++)
			await signin.enter(address, wrongFor(client.code), client.nonce, now);

		expect(
			await signin.enter(address, client.code, client.nonce, now),
		).toBeNull();

		const again = (await signin.issue(address, later(60), client.nonce))!;

		expect(
			await signin.enter(address, again.code, again.nonce, later(61)),
		).toBeTruthy();
		sql.close();
	});

	it("stops working at expiry, is swept by the next request, and cannot be used twice", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;

		expect(
			await signin.enter(address, client.code, client.nonce, later(600)),
		).toBeNull();

		const next = (await signin.issue(address, later(601)))!;
		expect(rows(sql)).toHaveLength(1);

		expect(
			await signin.enter(address, next.code, next.nonce, later(602)),
		).toBeTruthy();
		expect(
			await signin.enter(address, next.code, next.nonce, later(603)),
		).toBeNull();
		sql.close();
	});

	it("keeps at most six live codes for an address, refusing the new request rather than dropping another browser's code", async () => {
		const { sql, signin } = fixture();
		const issued = [];

		for (let index = 0; index < 6; index++)
			issued.push((await signin.issue(address, later(index)))!);

		expect(await signin.issue(address, later(7))).toBeNull();
		expect(rows(sql)).toHaveLength(6);

		for (const { code, nonce } of issued)
			expect(await signin.enter(address, code, nonce, later(8))).toBeTruthy();
		sql.close();
	});

	it("lets a browser ask again, even at once, without using up a second place", async () => {
		const { sql, signin } = fixture();
		let pending: string | null = null;

		for (let index = 0; index < 8; index++) {
			const issued: { nonce: string } | null = await signin.issue(
				address,
				later(index),
				pending,
			);

			pending = issued?.nonce ?? pending;
		}

		expect(rows(sql)).toHaveLength(1);
		expect(pending).not.toBeNull();
		sql.close();
	});

	it("discards only the code it was asked to discard", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;
		// Resend refuses the other browser's email, so its code is discarded.
		expect(
			await signin.issue(address, later(1), null, "refused"),
		).not.toBeNull();
		expect(rows(sql)).toHaveLength(1);
		expect(
			await signin.enter(address, client.code, client.nonce, later(3)),
		).toBeTruthy();
		sql.close();
	});

	it("does not accept a cookie value the server did not mint, even with the right code for a row", async () => {
		const { sql, signin } = fixture();
		const client = (await signin.issue(address, now))!;
		const tampered = `${client.nonce.slice(0, 63)}${client.nonce.endsWith("0") ? "1" : "0"}`;

		expect(await signin.enter(address, client.code, tampered, now)).toBeNull();
		expect(
			await signin.enter(address, client.code, client.nonce.toUpperCase(), now),
		).toBeNull();
		expect(
			sql
				.prepare("SELECT SUM(attempts) AS total FROM audio_client_signin_codes")
				.get(),
		).toEqual({ total: 0 });
		sql.close();
	});

	it("keeps the browser's code for one address when it asks for another, whatever the other is", async () => {
		const { sql, signin } = fixture();
		const first = (await signin.issue(address, now))!;

		const second = (await signin.issue(otherAddress, later(5), first.nonce))!;

		expect(second.nonce).toBe(first.nonce);

		// A request for an address with no project or one that issues nothing changes no row of another address.
		expect(
			await signin.issue("nobody@example.com", later(6), first.nonce),
		).toBeNull();
		expect(
			sql
				.prepare("SELECT email FROM audio_client_signin_codes ORDER BY email")
				.all(),
		).toEqual([{ email: address }, { email: otherAddress }]);

		expect(
			await signin.enter(address, first.code, first.nonce, later(7)),
		).toBeTruthy();
		expect(
			await signin.enter(otherAddress, second.code, second.nonce, later(8)),
		).toBeTruthy();
		sql.close();
	});
});
