import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { describe, expect, it } from "vitest";
import {
	clientProjectForSession,
	clientProjectsForSession,
	groupStudioProjects,
	listStudioSignInFailures,
} from "~/lib/audio-client-access";
import { normalizeClientEmail } from "~/lib/client-portal";
import { CODE_EMAIL } from "~/server/flows/signin-code";
import { studioSignin } from "../helpers/studio-signin";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

const secret = "studio-code-key-for-tests-32-characters";
const now = new Date("2026-09-22T12:00:00.000Z");

function fixture() {
	const sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);

	const db = sqliteD1(sql);
	const signin = studioSignin(db, secret);

	const addRequest = (id: string, email = "artist@example.com") =>
		sql
			.prepare(`INSERT INTO owner_requests
    (id,kind,email,summary,status,created_at,updated_at)
    VALUES (?,'service',?,'A song','new',?,?)`)
			.run(id, email, now.toISOString(), now.toISOString());

	return { sql, db, addRequest, signin };
}

describe("audio client access", () => {
	it("normalizes email without stripping plus addressing", () => {
		expect(normalizeClientEmail("  Artist+mix@Example.com ")).toBe(
			"artist+mix@example.com",
		);
		expect(normalizeClientEmail("not an email")).toBeNull();
	});

	it("issues only to project members and stores hashes rather than the code or the nonce", async () => {
		const { sql, addRequest, signin } = fixture();
		expect(await signin.issue("unknown@example.com", now)).toBeNull();
		addRequest("song-1");

		const issued = (await signin.issue("artist@example.com", now))!;

		expect(issued.code).toMatch(/^\d{8}$/);
		expect(issued.nonce).toMatch(/^[0-9a-f]{64}$/);

		const stored: { code_hash: string; nonce_hash: string } = sql
			.prepare(
				"SELECT code_hash,nonce_hash FROM audio_client_signin_codes WHERE email='artist@example.com'",
			)
			.get();

		expect(stored.code_hash).not.toBe(issued.code);
		expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored.nonce_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored.nonce_hash).not.toBe(issued.nonce);
		expect(
			sql.prepare("SELECT action FROM audio_client_access_audit").all(),
		).toEqual([{ action: "code-issued" }]);
		sql.close();
	});

	it("requires the current unused code from the browser that asked and confines a session to its email projects", async () => {
		const { sql, db, addRequest, signin } = fixture();
		addRequest("song-1");
		addRequest("song-2");
		addRequest("other-song", "other@example.com");

		const first = (await signin.issue("artist@example.com", now))!;

		// The same browser asking again replaces its own earlier code.
		const afterCooldown = new Date(now.getTime() + 31_000);

		const second = (await signin.issue(
			"artist@example.com",
			afterCooldown,
			first.nonce,
		))!;

		// The first code belonged to the browser's earlier request and is gone.
		expect(
			await signin.enter(
				"artist@example.com",
				first.code,
				first.nonce,
				afterCooldown,
			),
		).toBeNull();

		const token = await signin.enter(
			"artist@example.com",
			second.code,
			second.nonce,
			afterCooldown,
		);

		expect(token).toBeTruthy();
		expect(
			await signin.enter(
				"artist@example.com",
				second.code,
				second.nonce,
				afterCooldown,
			),
		).toBeNull();
		expect(
			(await clientProjectsForSession(db, token!, now))?.map(
				(project) => project.request_id,
			),
		).toEqual(["song-1", "song-2"]);
		expect(
			await clientProjectForSession(db, token!, "song-1", now),
		).toMatchObject({ request_id: "song-1" });
		expect(
			await clientProjectForSession(db, token!, "other-song", now),
		).toBeNull();
		expect(
			await clientProjectForSession(
				db,
				token!,
				"song-1",
				new Date("2026-10-10T12:00:00Z"),
			),
		).toBeNull();
		sql
			.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='song-1'")
			.run();
		expect(await clientProjectForSession(db, token!, "song-1", now)).toBeNull();
		expect(
			await clientProjectForSession(db, token!, "song-2", now),
		).not.toBeNull();
		await signin.signOut(token!, now);
		expect(await clientProjectForSession(db, token!, "song-2", now)).toBeNull();
		sql.close();
	});

	it("locks a code after five wrong guesses, even when they arrive together", async () => {
		const { sql, addRequest, signin } = fixture();
		addRequest("song-1");

		const issued = (await signin.issue("artist@example.com", now))!;

		const wrong = issued.code === "00000000" ? "11111111" : "00000000";

		const guesses = await Promise.all(
			Array.from({ length: 10 }, () =>
				signin.enter("artist@example.com", wrong, issued.nonce, now),
			),
		);

		expect(guesses.every((token) => token === null)).toBe(true);
		expect(
			sql.prepare("SELECT attempts FROM audio_client_signin_codes").get(),
		).toEqual({ attempts: 5 });
		expect(
			await signin.enter("artist@example.com", issued.code, issued.nonce, now),
		).toBeNull();
		sql.close();
	});

	it("admits exactly the allowance when requests arrive together, then opens a new window", async () => {
		const { sql, signin } = fixture();

		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				signin.allow(CODE_EMAIL, "artist@example.com", now),
			),
		);

		expect(results.filter(Boolean)).toHaveLength(3);
		expect(await signin.allow(CODE_EMAIL, "other@example.com", now)).toBe(true);
		expect(
			await signin.allow(
				CODE_EMAIL,
				"artist@example.com",
				new Date(now.getTime() + 5 * 60_000 + 1),
			),
		).toBe(true);

		const stored: { key: string }[] = sql
			.prepare("SELECT key FROM audio_client_allowances")
			.all();

		expect(stored.every((row) => !row.key.includes("artist"))).toBe(true);
		sql.close();
	});

	it("locks a code after five wrong attempts and rejects expired or undelivered codes", async () => {
		const { sql, addRequest, signin } = fixture();
		addRequest("song-1");

		const issued = (await signin.issue("artist@example.com", now))!;

		const wrong = issued.code === "00000000" ? "11111111" : "00000000";

		for (let attempt = 0; attempt < 5; attempt++) {
			expect(
				await signin.enter("artist@example.com", wrong, issued.nonce, now),
			).toBeNull();
		}

		expect(
			await signin.enter("artist@example.com", issued.code, issued.nonce, now),
		).toBeNull();

		const later = new Date(now.getTime() + 31_000);

		const newer = (await signin.issue(
			"artist@example.com",
			later,
			issued.nonce,
		))!;

		expect(
			await signin.enter("artist@example.com", newer.code, newer.nonce, later),
		).toBeTruthy();

		const tooLate = (await signin.issue(
			"artist@example.com",
			later,
			newer.nonce,
		))!;

		expect(tooLate).not.toBeNull();
		expect(
			await signin.enter(
				"artist@example.com",
				tooLate.code,
				tooLate.nonce,
				new Date("2026-09-22T12:11:00Z"),
			),
		).toBeNull();

		// Resend refuses the email, so the code is discarded.
		const undelivered = (await signin.issue(
			"artist@example.com",
			new Date("2026-09-22T12:12:00Z"),
			null,
			"refused",
		))!;

		expect(
			await signin.enter(
				"artist@example.com",
				undelivered.code,
				undelivered.nonce,
				now,
			),
		).toBeNull();
		expect(
			sql
				.prepare(
					"SELECT action FROM audio_client_access_audit ORDER BY id DESC LIMIT 1",
				)
				.get(),
		).toEqual({ action: "code-delivery-failed" });
		sql.close();
	});

	it("surfaces failed delivery until the client signs in", async () => {
		const { sql, db, addRequest, signin } = fixture();
		addRequest("song-1");

		// Resend refuses the email, so the code is discarded and the failure audited.
		await signin.issue("artist@example.com", now, null, "refused");
		expect(await listStudioSignInFailures(db)).toEqual([
			{ requestId: "song-1", clientName: "" },
		]);
		sql
			.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      VALUES ('song-1','signed-in',?)`)
			.run(now.toISOString());
		expect(await listStudioSignInFailures(db)).toEqual([]);
		sql.close();
	});
});

describe("studio song groups", () => {
	it("delivers only songs with a published final and marks expired ones", () => {
		const now = new Date("2026-09-23T12:00:00Z");

		const { active, delivered } = groupStudioProjects(
			[
				{ id: "working", stage: "in_progress", final_expires_at: null },
				{
					id: "revoked-final",
					stage: "final_files_ready",
					final_expires_at: null,
				},
				{
					id: "current",
					stage: "final_files_ready",
					final_expires_at: "2027-09-23T12:00:00Z",
				},
				{
					id: "expired",
					stage: "complete",
					final_expires_at: "2026-09-01T12:00:00Z",
				},
			],
			now,
		);

		expect(active.map((project) => project.id)).toEqual([
			"working",
			"revoked-final",
		]);
		expect(delivered.map(({ id, available }) => ({ id, available }))).toEqual([
			{ id: "current", available: true },
			{ id: "expired", available: false },
		]);
	});
});

it.each(["", "not an email", "@example.com"])(
	"returns null for a string that is not an email address (%j)",
	(input) => {
		expect(normalizeClientEmail(input)).toBeNull();
	},
);
