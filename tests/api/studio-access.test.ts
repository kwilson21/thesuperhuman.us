import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { double, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1, type SqliteDatabase } from "../helpers/sqlite-d1";
import { freshMusicDb, rows, seed } from "../golden/harness";
import { type ResendEmail, stubResend } from "../helpers/resend-fetch";
import { keyedHash } from "~/lib/audio-client-access";
import { POST as requestCode } from "~/pages/api/studio/code";
import { POST as completeCode } from "~/pages/api/studio/session";
import { POST as signOut } from "~/pages/api/studio/sign-out";

// The code key the portal is configured with. Rate-limit subjects are keyed hashes of it, so a test can use up an
// allowance by writing the row the route would write.
const CODE_KEY = "a".repeat(32);
const email = "Artist@Example.com";
const client = "artist@example.com";
const ROUTE_IP = "0.0.0.0";

type StudioContext = APIContext & { pending: Promise<unknown>[] };

type Options = { enabled?: boolean; database?: D1Database };

let sql: SqliteDatabase, db: D1Database;

// Every email Resend was asked to send in the current test, in order. Each test sets its answers with stubResend.
let emails: ResendEmail[];

// The eight-digit code in the latest email, read the way a client reads it.
function sentCode(): string {
	const latest = emails.at(-1);
	const spaced = /\b(\d{4}) (\d{4})\b/.exec(latest?.text ?? "");

	if (!spaced) throw new Error("no sign-in code in the email");

	return `${spaced[1]}${spaced[2]}`;
}

function seedProject() {
	seed(sql, {
		owner_requests: [
			rows.ownerRequest("r1", {
				kind: "service",
				email: client,
				status: "reviewed",
			}),
		],
	});
}

// Uses up an allowance: the next use of this scope and subject is refused.
async function exhaustAllowance(scope: string, subject: string) {
	const key = await keyedHash(CODE_KEY, `${scope}:${subject}`);

	sql
		.prepare(
			`INSERT INTO audio_client_allowances(key,window_start,uses) VALUES(?,?,10)
      ON CONFLICT(key) DO UPDATE SET uses=10,window_start=excluded.window_start`,
		)
		.run(key, new Date().toISOString());
}

function context(
	path: string,
	body: JsonObject,
	{ enabled = true, database = db }: Options = {},
): StudioContext {
	const pending: Promise<unknown>[] = [];

	return partial<StudioContext>({
		request: new Request(`https://thesuperhuman.us${path}`, {
			method: "POST",
			headers: {
				origin: "https://thesuperhuman.us",
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		}),
		locals: {
			runtime: partial<TestRuntime>({
				ctx: double<ExecutionContext>({
					waitUntil: vi.fn((work: Promise<unknown>) => {
						pending.push(work);
					}),
				}),
				env: partial<TestRuntime["env"]>({
					AUDIO_CLIENT_PORTAL_ENABLED: enabled ? "true" : "false",
					AUDIO_CLIENT_CODE_KEY: CODE_KEY,
					MUSIC_DB: database,
					TURNSTILE_SECRET_KEY: "test",
					RESEND_API_KEY: "test",
					CONTACT_FROM_EMAIL: "noreply@example.com",
				}),
			}),
		},
		pending,
	});
}

// Asks for a code and waits for its email, as the client's browser and inbox would.
async function requestSignInCode(options: Options = {}) {
	const ctx = context(
		"/api/studio/code",
		{ email, turnstileToken: "challenge" },
		options,
	);

	const response = await requestCode(ctx);
	await Promise.all(ctx.pending);

	return response;
}

// A full sign-in: a code is requested, read from the email, and completed. Returns the session token.
async function signIn(): Promise<string> {
	expect((await requestSignInCode()).status).toBe(200);

	const response = await completeCode(
		context("/api/studio/session", { email, code: sentCode() }),
	);

	expect(response.status).toBe(200);

	const token = /studio_session=([0-9a-f-]{72})/.exec(
		response.headers.get("set-cookie") ?? "",
	)?.[1];

	if (!token) throw new Error("no session cookie");

	return token;
}

beforeEach(() => {
	sql = freshMusicDb();
	db = sqliteD1(sql);
	emails = stubResend();
});

afterEach(() => {
	sql.close();
	vi.unstubAllGlobals();
});

describe("studio access routes", () => {
	it("keeps project existence out of the code-request response", async () => {
		const unknown = await requestSignInCode();

		expect(unknown.status).toBe(200);
		expect(emails).toEqual([]);

		seedProject();

		const knownContext = context("/api/studio/code", {
			email,
			turnstileToken: "challenge",
		});

		const known = await requestCode(knownContext);
		expect(known.status).toBe(200);
		expect(await known.json()).toEqual(await unknown.json());
		await Promise.all(knownContext.pending);

		const sent = emails;
		const code = sentCode();
		const spaced = `${code.slice(0, 4)} ${code.slice(4)}`;

		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toEqual([client]);
		expect(sent[0]?.text).toContain(spaced);
		expect(sent[0]?.html).toContain(spaced);
	});

	it("responds without waiting for email delivery", async () => {
		seedProject();
		let finishDelivery!: () => void;
		emails = stubResend({
			hold: new Promise<void>((resolve) => {
				finishDelivery = resolve;
			}),
		});

		const ctx = context("/api/studio/code", {
			email,
			turnstileToken: "challenge",
		});

		try {
			const response = await Promise.race([
				requestCode(ctx),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Code response waited for email delivery")),
						1000,
					),
				),
			]);

			expect(response.status).toBe(200);
			expect(ctx.locals.runtime.ctx.waitUntil).toHaveBeenCalledOnce();
			expect(emails).toEqual([]);
		} finally {
			// Release the held Resend answer even when an assertion above fails, so the pending send can finish.
			finishDelivery();
			await Promise.all(ctx.pending);
		}

		expect(emails).toHaveLength(1);
	});

	it("keeps access closed by default and sets a protected cookie after a valid code", async () => {
		seedProject();

		expect((await requestSignInCode({ enabled: false })).status).toBe(404);
		expect(emails).toEqual([]);
		expect(
			sql.prepare("SELECT COUNT(*) AS total FROM audio_client_codes").get(),
		).toEqual({ total: 0 });

		expect((await requestSignInCode()).status).toBe(200);

		const response = await completeCode(
			context("/api/studio/session", { email, code: sentCode() }),
		);

		expect(response.status).toBe(200);
		const cookie = response.headers.get("set-cookie");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("Max-Age=1209600");
	});

	it("invalidates an undelivered code and revokes the current session on sign-out", async () => {
		seedProject();
		emails = stubResend({ resend: [{ status: 422 }] });

		expect((await requestSignInCode()).status).toBe(200);
		const rejected = sentCode();

		// The rejected code was discarded, so completing it fails.
		expect(
			(
				await completeCode(
					context("/api/studio/session", { email, code: rejected }),
				)
			).status,
		).toBe(401);

		const token = await signIn();
		const ctx = context("/api/studio/sign-out", {});
		ctx.request.headers.set("cookie", `studio_session=${token}`);

		const response = await signOut(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(
			sql
				.prepare(
					"SELECT COUNT(*) AS total FROM audio_client_sessions WHERE revoked_at IS NOT NULL",
				)
				.get(),
		).toEqual({ total: 1 });
	});

	it("keeps a code whose delivery is uncertain, since the email may still arrive", async () => {
		seedProject();
		emails = stubResend({ resend: [{ status: 503 }] });

		expect((await requestSignInCode()).status).toBe(200);
		expect(emails).toHaveLength(1);

		// The provider answered 5xx, so the code was not discarded and still completes.
		const response = await completeCode(
			context("/api/studio/session", { email, code: sentCode() }),
		);

		expect(response.status).toBe(200);
	});

	it("refuses code requests and guesses past their allowance", async () => {
		seedProject();

		// A valid code is issued before the allowances run out.
		expect((await requestSignInCode()).status).toBe(200);
		const issued = sentCode();
		const sentBefore = emails.length;

		await exhaustAllowance("code-ip", ROUTE_IP);
		expect((await requestSignInCode()).status).toBe(429);
		expect(emails).toHaveLength(sentBefore);

		await exhaustAllowance("session-email", client);
		expect(
			(
				await completeCode(
					context("/api/studio/session", { email, code: issued }),
				)
			).status,
		).toBe(429);
		expect(sql.prepare("SELECT used_at FROM audio_client_codes").get()).toEqual(
			{ used_at: null },
		);
		expect(
			sql.prepare("SELECT COUNT(*) AS total FROM audio_client_sessions").get(),
		).toEqual({ total: 0 });
	});

	it("clears the browser cookie when session revocation fails", async () => {
		seedProject();
		const token = await signIn();

		const failing = double<D1Database>({
			prepare: () => {
				throw new Error("Database unavailable");
			},
		});

		const ctx = context("/api/studio/sign-out", {}, { database: failing });
		ctx.request.headers.set("cookie", `studio_session=${token}`);
		const response = await signOut(ctx);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ ok: false, localSignedOut: true });
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(
			sql
				.prepare(
					"SELECT COUNT(*) AS total FROM audio_client_sessions WHERE revoked_at IS NULL",
				)
				.get(),
		).toEqual({ total: 1 });
	});
});
