import { readFileSync, readdirSync } from "node:fs";
import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { double, partial } from "../helpers/doubles";
import { fakeBatch } from "../helpers/d1";
import { readJson } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";
import { POST as requestCode } from "~/pages/api/studio/code";
import { POST as completeCode } from "~/pages/api/studio/session";

// The sign-in routes with their real library and a real SQL database (no module mocks): the pending sign-in cookie, the
// answers, and the races. The model is verification/signin-codes.qnt.

const baseline = readFileSync(
	new URL("../../db/music.sql", import.meta.url),
	"utf8",
);

const address = "artist@example.com";

// Over https the cookie uses the __Host- prefix (Secure, Path=/, no Domain), so a sibling subdomain cannot plant or shadow it.
// Plain-http localhost cannot hold a __Host- cookie, so it keeps the plain name, as the session cookie keeps its attributes.
const pendingName = "__Host-studio_pending";
const originOf = "https://thesuperhuman.us";

let sql: InstanceType<typeof DatabaseSync>;
let db: D1Database;
let mails: { to: string[]; text: string }[];
let background: Promise<unknown>[];

beforeEach(() => {
	sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(baseline);
	sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','${address}','A song','new','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);
	db = sqliteD1(sql);
	mails = [];
	background = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { body?: string }) => {
			if (String(url).includes("resend")) {
				const payload = JSON.parse(String(init?.body));
				mails.push({ to: payload.to, text: payload.text });

				return { ok: true, status: 200, json: async () => ({ id: "em" }) };
			}

			return { ok: true, status: 200, json: async () => ({ success: true }) };
		}),
	);
});

type Sent = { cookie?: string; ip?: string; origin?: string };

function context(
	path: string,
	body: { [field: string]: string },
	sent: Sent = {},
): APIContext {
	const origin = sent.origin ?? originOf;
	const headers = new Headers({ origin, "content-type": "application/json" });

	if (sent.cookie) headers.set("cookie", sent.cookie);
	headers.set("cf-connecting-ip", sent.ip ?? "203.0.113.1");

	return partial<APIContext>({
		request: new Request(`${origin}${path}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		locals: {
			runtime: partial<TestRuntime>({
				ctx: double<ExecutionContext>({
					waitUntil: vi.fn((work: Promise<unknown>) => {
						background.push(work);
					}),
				}),
				env: partial<TestRuntime["env"]>({
					AUDIO_CLIENT_PORTAL_ENABLED: "true",
					AUDIO_CLIENT_CODE_KEY: "a".repeat(32),
					MUSIC_DB: db,
					TURNSTILE_SECRET_KEY: "test",
					RESEND_API_KEY: "test",
					CONTACT_FROM_EMAIL: "noreply@example.com",
					SITE_ORIGIN: originOf,
				}),
			}),
		},
	});
}

const nonceFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.match(new RegExp(`${pendingName}=([^;]*)`))?.[1])
		.find(Boolean);

async function ask(sent: Sent = {}, who = address) {
	const response = await requestCode(
		context("/api/studio/code", { email: who, turnstileToken: "ok" }, sent),
	);

	await Promise.all(background.splice(0));

	return response;
}

const codeIn = (mail: { text: string }) =>
	/(\d{4}) (\d{4})/.exec(mail.text)!.slice(1, 3).join("");

async function enter(code: string, sent: Sent = {}, who = address) {
	return completeCode(
		context("/api/studio/session", { email: who, code }, sent),
	);
}

const allowanceRows = () =>
	sql.prepare("SELECT COUNT(*) AS n FROM audio_client_allowances").get();

describe("the pending sign-in cookie", () => {
	it("is set on every code request, with the same attributes whether or not the address has a project", async () => {
		const known = await ask();
		const unknown = await ask({}, "nobody@example.com");

		const pendingCookieOf = (response: Response) =>
			response.headers
				.getSetCookie()
				.find((cookie) => cookie.startsWith(`${pendingName}=`))!
				.replace(/=[0-9a-f]{64}/, "=<nonce>");

		expect(pendingCookieOf(known)).toBe(
			`${pendingName}=<nonce>; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
		);
		expect(pendingCookieOf(unknown)).toBe(pendingCookieOf(known));
		expect(await known.json()).toEqual(await unknown.json());
		expect(mails).toHaveLength(1);
	});

	it("is not marked Secure on plain-HTTP localhost, as the session cookie is not", async () => {
		const response = await requestCode(
			context(
				"/api/studio/code",
				{ email: address, turnstileToken: "ok" },
				{ origin: "http://localhost:4321" },
			),
		);

		const cookie = response.headers
			.getSetCookie()
			.find((value) => value.startsWith("studio_pending="))!;

		expect(cookie).toMatch(
			/^studio_pending=[0-9a-f]{64}; Path=\/api\/studio; HttpOnly; SameSite=Lax; Max-Age=600$/,
		);
	});

	it("signs in over plain-http localhost with the unprefixed cookie", async () => {
		const local = "http://localhost:4321";

		const asked = await requestCode(
			context(
				"/api/studio/code",
				{ email: address, turnstileToken: "ok" },
				{ origin: local },
			),
		);

		await Promise.all(background.splice(0));

		const value = asked.headers
			.getSetCookie()
			.map((cookie) => cookie.match(/^studio_pending=([0-9a-f]{64})/)?.[1])
			.find(Boolean);

		const entered = await completeCode(
			context(
				"/api/studio/session",
				{ email: address, code: codeIn(mails[0]) },
				{ origin: local, cookie: `studio_pending=${value}` },
			),
		);

		expect(entered.status).toBe(200);
		expect(entered.headers.getSetCookie()[1]).toBe(
			"studio_pending=; Path=/api/studio; HttpOnly; SameSite=Lax; Max-Age=0",
		);
	});

	it("ignores an unprefixed cookie over https, so a planted one cannot stand in for the real one", async () => {
		const asked = await ask();
		const plain = `studio_pending=${nonceFrom(asked)}`;

		expect((await enter(codeIn(mails[0]), { cookie: plain })).status).toBe(401);
		expect(
			sql.prepare("SELECT attempts FROM audio_client_signin_codes").get(),
		).toEqual({ attempts: 0 });
	});

	it("gives a browser that blocks cookies the refusal that names the browser", async () => {
		await ask();

		const refused = await enter(codeIn(mails[0]));

		expect(refused.status).toBe(401);
		expect((await readJson<{ error: string }>(refused)).error).toContain(
			"Enter it in the browser where you asked for it",
		);
	});

	it("lets the browser that asked sign in, and clears the pending cookie beside the session cookie", async () => {
		const asked = await ask();

		const response = await enter(codeIn(mails[0]), {
			cookie: `${pendingName}=${nonceFrom(asked)}`,
		});

		expect(response.status).toBe(200);

		const cookies = response.headers.getSetCookie();
		expect(cookies).toHaveLength(2);
		expect(cookies[0]).toMatch(/^studio_session=[0-9a-f-]{72};/);
		expect(cookies[1]).toBe(
			`${pendingName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
		);
	});

	it("keeps working when the code is typed on another device but sent from the original browser", async () => {
		const asked = await ask();
		const code = codeIn(mails[0]);

		expect(
			(
				await enter(code, {
					cookie: `${pendingName}=${nonceFrom(asked)}`,
					ip: "198.51.100.9",
				})
			).status,
		).toBe(200);
	});

	it("does not sign in a different browser that has the right code", async () => {
		await ask();
		const response = await enter(codeIn(mails[0]));

		expect(response.status).toBe(401);
		expect((await readJson<{ error: string }>(response)).error).toBe(
			"That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here.",
		);
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	it("does no database work and spends no allowance for a guess without the cookie", async () => {
		await ask();
		const before = allowanceRows();

		for (let attempt = 0; attempt < 30; attempt++) await enter("00000000", {});

		expect(allowanceRows()).toEqual(before);
		expect(
			sql.prepare("SELECT attempts FROM audio_client_signin_codes").get(),
		).toEqual({ attempts: 0 });
	});

	it("does not let guesses with invented or altered cookies use up the client's attempts or allowance", async () => {
		const asked = await ask();
		const nonce = nonceFrom(asked)!;
		const altered = `${nonce.slice(0, 63)}${nonce.endsWith("0") ? "1" : "0"}`;

		for (let attempt = 0; attempt < 25; attempt++)
			await enter("00000000", {
				cookie: `${pendingName}=${attempt % 2 ? altered : "e".repeat(64)}`,
				ip: `198.51.100.${attempt}`,
			});

		expect(
			sql.prepare("SELECT attempts FROM audio_client_signin_codes").get(),
		).toEqual({ attempts: 0 });
		expect(
			(await enter(codeIn(mails[0]), { cookie: `${pendingName}=${nonce}` }))
				.status,
		).toBe(200);
	});

	it("does not let a stranger's requests and guesses lock the client out", async () => {
		const asked = await ask({ ip: "203.0.113.5" });
		const clientNonce = nonceFrom(asked)!;
		const clientCode = codeIn(mails[0]);

		// The stranger asks for codes (within the address's allowance) and guesses against their own.
		const strangerAsked = await ask({ ip: "203.0.113.77" });

		for (let attempt = 0; attempt < 12; attempt++)
			await enter("00000000", {
				cookie: `${pendingName}=${nonceFrom(strangerAsked)}`,
				ip: "203.0.113.77",
			});

		expect(
			(
				await enter(clientCode, {
					cookie: `${pendingName}=${clientNonce}`,
					ip: "203.0.113.5",
				})
			).status,
		).toBe(200);
	});

	it("returns a fresh value whether or not the address has a project, even when the browser sends one", async () => {
		const sent = "9".repeat(64);
		const cookie = `${pendingName}=${sent}`;
		const known = await ask({ cookie });
		const unknown = await ask({ cookie }, "nobody@example.com");

		expect(nonceFrom(known)).toMatch(/^[0-9a-f]{64}$/);
		expect(nonceFrom(known)).not.toBe(sent);
		expect(nonceFrom(unknown)).toMatch(/^[0-9a-f]{64}$/);
		expect(nonceFrom(unknown)).not.toBe(sent);
	});

	it("returns a fresh value to a browser that asks again at once, and the new code replaces its own earlier one", async () => {
		const first = await ask();
		const nonce = nonceFrom(first)!;
		const second = await ask({ cookie: `${pendingName}=${nonce}` });

		expect(nonceFrom(second)).not.toBe(nonce);
		expect(mails).toHaveLength(2);
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_signin_codes").get(),
		).toEqual({ n: 1 });
		expect(
			(
				await enter(codeIn(mails[0]), {
					cookie: `${pendingName}=${nonceFrom(second)}`,
				})
			).status,
		).toBe(401);
		expect(
			(
				await enter(codeIn(mails[1]), {
					cookie: `${pendingName}=${nonceFrom(second)}`,
				})
			).status,
		).toBe(200);
	});

	it("answers the same way when the address already has the most live codes", async () => {
		for (let index = 0; index < 6; index++)
			sql
				.prepare(`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at)
          VALUES (?,?,?,0,?,?)`)
				.run(
					`n${index}`,
					address,
					`c${index}`,
					new Date().toISOString(),
					new Date(Date.now() + 600_000).toISOString(),
				);

		const full = await ask();
		const unknown = await ask({}, "nobody@example.com");

		expect(full.status).toBe(200);
		expect(await full.json()).toEqual(await unknown.json());
		expect(mails).toHaveLength(0);
		expect(nonceFrom(full)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("a browser's own earlier code", () => {
	const otherAddress = "other@example.com";

	it("is removed when the browser asks for a code for a different address", async () => {
		sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES ('song-2','service','${otherAddress}','Another song','new','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);

		const first = await ask();

		const second = await ask(
			{ cookie: `${pendingName}=${nonceFrom(first)}` },
			otherAddress,
		);

		expect(second.status).toBe(200);
		expect(
			sql.prepare("SELECT email FROM audio_client_signin_codes").all(),
		).toEqual([{ email: otherAddress }]);
	});

	it("is removed when the browser asks for an address with no project", async () => {
		const first = await ask();

		await ask(
			{ cookie: `${pendingName}=${nonceFrom(first)}` },
			"nobody@example.com",
		);
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_signin_codes").get(),
		).toEqual({ n: 0 });
	});
});

describe("races", () => {
	it("gives two requests for one address at once a code and a browser each", async () => {
		const [one, two] = await Promise.all([
			requestCode(
				context(
					"/api/studio/code",
					{ email: address, turnstileToken: "ok" },
					{ ip: "203.0.113.10" },
				),
			),
			requestCode(
				context(
					"/api/studio/code",
					{ email: address, turnstileToken: "ok" },
					{ ip: "203.0.113.11" },
				),
			),
		]);

		await Promise.all(background.splice(0));
		expect([one.status, two.status]).toEqual([200, 200]);
		expect(nonceFrom(one)).not.toBe(nonceFrom(two));
		expect(mails).toHaveLength(2);

		const firstCode = codeIn(mails[0]);
		const secondCode = codeIn(mails[1]);

		expect(firstCode).not.toBe(secondCode);

		// Each browser's cookie opens exactly one of the two codes.
		const opened = [];

		for (const response of [one, two])
			for (const code of [firstCode, secondCode]) {
				const entered = await enter(code, {
					cookie: `${pendingName}=${nonceFrom(response)}`,
				});

				if (entered.status === 200) opened.push(code);
			}

		expect(opened.sort()).toEqual([firstCode, secondCode].sort());
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_signin_codes").get(),
		).toEqual({ n: 2 });
	});

	it("signs the client in when another request for the address commits just before the completing batch", async () => {
		const asked = await ask({ ip: "203.0.113.5" });
		const nonce = nonceFrom(asked)!;
		const original = db.batch.bind(db);

		db.batch = fakeBatch(async (statements) => {
			sql
				.prepare(`INSERT INTO audio_client_signin_codes(nonce_hash,email,code_hash,attempts,created_at,expires_at)
          VALUES ('stranger',?,'x',0,?,?)`)
				.run(
					address,
					new Date().toISOString(),
					new Date(Date.now() + 600_000).toISOString(),
				);
			db.batch = original;

			return original(statements);
		});

		expect(
			(
				await enter(codeIn(mails[0]), {
					cookie: `${pendingName}=${nonce}`,
					ip: "203.0.113.5",
				})
			).status,
		).toBe(200);
		expect(
			sql
				.prepare(
					"SELECT attempts FROM audio_client_signin_codes WHERE nonce_hash='stranger'",
				)
				.get(),
		).toEqual({ attempts: 0 });
	});

	it("lets two requests from one browser at once both succeed, and only the later cookie opens its code", async () => {
		const asked = await ask({ ip: "203.0.113.5" });
		const cookie = `${pendingName}=${nonceFrom(asked)}`;

		const [one, two] = await Promise.all([
			requestCode(
				context(
					"/api/studio/code",
					{ email: address, turnstileToken: "ok" },
					{ cookie, ip: "203.0.113.20" },
				),
			),
			requestCode(
				context(
					"/api/studio/code",
					{ email: address, turnstileToken: "ok" },
					{ cookie, ip: "203.0.113.21" },
				),
			),
		]);

		await Promise.all(background.splice(0));
		expect([one.status, two.status]).toEqual([200, 200]);
		expect(mails).toHaveLength(3);
		// The first code's row is gone; both new rows are live and bounded by the email allowance.
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_signin_codes").get(),
		).toEqual({ n: 2 });
	});

	it("keeps the client's code when a stranger's request commits between the client's request and entry", async () => {
		const asked = await ask({ ip: "203.0.113.5" });
		const nonce = nonceFrom(asked)!;
		const clientCode = codeIn(mails[0]);

		await ask({ ip: "203.0.113.99" });
		expect(mails).toHaveLength(2);
		expect(
			(
				await enter(clientCode, {
					cookie: `${pendingName}=${nonce}`,
					ip: "203.0.113.5",
				})
			).status,
		).toBe(200);
	});

	it("never signs in twice when the same correct entry arrives twice at once", async () => {
		const asked = await ask();
		const sent = { cookie: `${pendingName}=${nonceFrom(asked)}` };
		const code = codeIn(mails[0]);
		const results = await Promise.all([enter(code, sent), enter(code, sent)]);

		expect(results.map((response) => response.status).sort()).toEqual([
			200, 401,
		]);
		expect(
			sql.prepare("SELECT COUNT(*) AS n FROM audio_client_sessions").get(),
		).toEqual({ n: 1 });
	});
});

describe("the deploy order", () => {
	it("answers 503 and stores nothing when the 0027 migration has not been applied", async () => {
		const before = new DatabaseSync(":memory:");

		for (const name of readdirSync(
			new URL("../../migrations/music/", import.meta.url),
		)
			.filter((file) => file.endsWith(".sql") && file < "0027")
			.sort())
			before.exec(
				readFileSync(
					new URL(`../../migrations/music/${name}`, import.meta.url),
					"utf8",
				),
			);
		before.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES ('song-1','service','${address}','A song','new','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);
		db = sqliteD1(before);

		const response = await ask();

		expect(response.status).toBe(503);
		expect(mails).toHaveLength(0);
	});

	it("leaves the old table alone, so the code running before the deploy keeps working on the migrated database", () => {
		const names = sql
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'audio_client_%codes'",
			)
			.all()
			.map((row) => row.name);

		expect(names).toEqual(["audio_client_codes", "audio_client_signin_codes"]);
	});
});
