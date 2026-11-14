import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sqliteD1, DatabaseSync } from "../helpers/sqlite-d1";
import {
	completeClientCode,
	discardUndeliveredCode,
	issueClientCode,
} from "~/lib/audio-client-access";

// A sign-in code belongs to the browser that asked for it. These cases are the threats against that: other people who know
// the address, a second browser, expiry, reuse and the limits. The model is verification/signin-codes.qnt.

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

	return { sql, db: sqliteD1(sql) };
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
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;
		const before = rows(sql);

		for (const nonce of [null, "", "f".repeat(64), "F".repeat(64), "short"])
			for (let attempt = 0; attempt < 8; attempt++)
				expect(
					await completeClientCode(
						db,
						address,
						attempt === 7 ? client.code : wrongFor(client.code),
						nonce,
						secret,
						now,
					),
				).toBeNull();

		expect(rows(sql)).toEqual(before);

		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				now,
			),
		).toBeTruthy();
		sql.close();
	});

	it("keeps the client's code working when a stranger asks for codes and spends their own attempts", async () => {
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;
		const stranger = (await issueClientCode(db, address, secret, later(5)))!;

		for (let attempt = 0; attempt < 5; attempt++)
			await completeClientCode(
				db,
				address,
				wrongFor(stranger.code),
				stranger.nonce,
				secret,
				later(6),
			);

		expect(
			await completeClientCode(
				db,
				address,
				stranger.code,
				stranger.nonce,
				secret,
				later(7),
			),
		).toBeNull();
		expect(rows(sql)).toHaveLength(2);

		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				later(8),
			),
		).toBeTruthy();
		sql.close();
	});

	it("does not accept the client's code from another browser, and does not charge the client's code for it", async () => {
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;
		const other = (await issueClientCode(db, address, secret, later(40)))!;

		// The right code, the wrong browser: tied to the other browser's own row, so it fails there.
		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				other.nonce,
				secret,
				later(41),
			),
		).toBeNull();
		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				null,
				secret,
				later(41),
			),
		).toBeNull();

		const clientRow = sql
			.prepare(
				"SELECT attempts FROM audio_client_signin_codes ORDER BY created_at LIMIT 1",
			)
			.get();

		expect(clientRow).toEqual({ attempts: 0 });
		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				later(42),
			),
		).toBeTruthy();
		sql.close();
	});

	it("limits the client's own mistypes to their own code, and a new request starts clean", async () => {
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;

		for (let attempt = 0; attempt < 5; attempt++)
			await completeClientCode(
				db,
				address,
				wrongFor(client.code),
				client.nonce,
				secret,
				now,
			);

		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				now,
			),
		).toBeNull();

		const again = (await issueClientCode(
			db,
			address,
			secret,
			later(60),
			client.nonce,
		))!;

		expect(
			await completeClientCode(
				db,
				address,
				again.code,
				again.nonce,
				secret,
				later(61),
			),
		).toBeTruthy();
		sql.close();
	});

	it("stops working at expiry, is swept by the next request, and cannot be used twice", async () => {
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;

		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				later(600),
			),
		).toBeNull();

		const next = (await issueClientCode(db, address, secret, later(601)))!;
		expect(rows(sql)).toHaveLength(1);

		expect(
			await completeClientCode(
				db,
				address,
				next.code,
				next.nonce,
				secret,
				later(602),
			),
		).toBeTruthy();
		expect(
			await completeClientCode(
				db,
				address,
				next.code,
				next.nonce,
				secret,
				later(603),
			),
		).toBeNull();
		sql.close();
	});

	it("keeps at most six live codes for an address, refusing the new request rather than dropping another browser's code", async () => {
		const { sql, db } = fixture();
		const issued = [];

		for (let index = 0; index < 6; index++)
			issued.push((await issueClientCode(db, address, secret, later(index)))!);

		expect(await issueClientCode(db, address, secret, later(7))).toBeNull();
		expect(rows(sql)).toHaveLength(6);

		for (const { code, nonce } of issued)
			expect(
				await completeClientCode(db, address, code, nonce, secret, later(8)),
			).toBeTruthy();
		sql.close();
	});

	it("lets a browser ask again, even at once, without using up a second place", async () => {
		const { sql, db } = fixture();
		let pending: string | null = null;

		for (let index = 0; index < 8; index++) {
			const issued: { nonce: string } | null = await issueClientCode(
				db,
				address,
				secret,
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
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;
		const other = (await issueClientCode(db, address, secret, later(1)))!;

		await discardUndeliveredCode(
			db,
			address,
			other.code,
			other.nonce,
			secret,
			later(2),
		);
		expect(rows(sql)).toHaveLength(1);
		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce,
				secret,
				later(3),
			),
		).toBeTruthy();
		sql.close();
	});

	it("does not accept a cookie value the server did not mint, even with the right code for a row", async () => {
		const { sql, db } = fixture();
		const client = (await issueClientCode(db, address, secret, now))!;
		const tampered = `${client.nonce.slice(0, 63)}${client.nonce.endsWith("0") ? "1" : "0"}`;

		expect(
			await completeClientCode(db, address, client.code, tampered, secret, now),
		).toBeNull();
		expect(
			await completeClientCode(
				db,
				address,
				client.code,
				client.nonce.toUpperCase(),
				secret,
				now,
			),
		).toBeNull();
		expect(
			sql
				.prepare("SELECT SUM(attempts) AS total FROM audio_client_signin_codes")
				.get(),
		).toEqual({ total: 0 });
		sql.close();
	});

	it("removes the browser's earlier code when it asks for a different address", async () => {
		const { sql, db } = fixture();
		const first = (await issueClientCode(db, address, secret, now))!;

		const second = (await issueClientCode(
			db,
			otherAddress,
			secret,
			later(5),
			first.nonce,
		))!;

		expect(second).not.toBeNull();
		expect(
			sql.prepare("SELECT email FROM audio_client_signin_codes").all(),
		).toEqual([{ email: otherAddress }]);

		// Also when nothing new is issued for the other address: the browser's cookie is replaced either way.
		const third = await issueClientCode(
			db,
			"nobody@example.com",
			secret,
			later(6),
			second.nonce,
		);

		expect(third).toBeNull();
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_signin_codes").get(),
		).toEqual({ n: 0 });
		sql.close();
	});
});
