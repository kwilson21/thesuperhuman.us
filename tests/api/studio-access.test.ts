import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { double, fakeD1, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1, type SqliteDatabase } from "../helpers/sqlite-d1";
import { freshMusicDb, rows, seed } from "../golden/harness";
import { type ResendEmail, stubResend } from "../helpers/resend-fetch";
import { hashValue, keyedHash } from "~/lib/client-portal";
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

type Options = {
	enabled?: boolean;
	database?: D1Database;
	cookie?: string;
	codeKey?: string;
	// No execution context, as a request outside Workers has.
	noContext?: boolean;
};

let sql: SqliteDatabase, db: D1Database;

// Every email Resend was asked to send in the current test, in order. Each test sets its answers with stubResend.
let emails: ResendEmail[];

// The pending sign-in value of the browser that asked for the latest code. Every code answer that issues or refuses a
// code sets it; a refused answer leaves the value the browser already had.
let browser: string | undefined;

// The eight-digit code in the latest email, read the way a client reads it.
function sentCode(): string {
	const latest = emails.at(-1);
	const spaced = /\b(\d{4}) (\d{4})\b/.exec(latest?.text ?? "");

	if (!spaced) throw new Error("no sign-in code in the email");

	return `${spaced[1]}${spaced[2]}`;
}

// The cookie the requesting browser holds. A code only works in the browser that asked for it.
function browserCookie(): string {
	if (!browser) throw new Error("no code was requested in this browser");

	return `__Host-studio_pending=${browser}`;
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
	{
		enabled = true,
		database = db,
		cookie,
		codeKey = CODE_KEY,
		noContext = false,
	}: Options = {},
): StudioContext {
	const pending: Promise<unknown>[] = [];

	const headers = new Headers({
		origin: "https://thesuperhuman.us",
		"content-type": "application/json",
	});

	if (cookie) headers.set("cookie", cookie);

	const runtime = partial<TestRuntime>({
		env: partial<TestRuntime["env"]>({
			AUDIO_CLIENT_PORTAL_ENABLED: enabled ? "true" : "false",
			AUDIO_CLIENT_CODE_KEY: codeKey,
			MUSIC_DB: database,
			TURNSTILE_SECRET_KEY: "test",
			RESEND_API_KEY: "test",
			CONTACT_FROM_EMAIL: "noreply@example.com",
		}),
	});

	if (!noContext)
		runtime.ctx = double<ExecutionContext>({
			waitUntil: vi.fn((work: Promise<unknown>) => {
				pending.push(work);
			}),
		});

	return partial<StudioContext>({
		request: new Request(`https://thesuperhuman.us${path}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		locals: { runtime },
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

	const nonce = /__Host-studio_pending=([0-9a-f]{64})/.exec(
		response.headers.get("set-cookie") ?? "",
	)?.[1];

	browser = nonce ?? browser;

	return response;
}

// A full sign-in: a code is requested, read from the email, and completed. Returns the session token.
async function signIn(): Promise<string> {
	expect((await requestSignInCode()).status).toBe(200);

	const response = await completeCode(
		context(
			"/api/studio/session",
			{ email, code: sentCode() },
			{ cookie: browserCookie() },
		),
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
	browser = undefined;
});

afterEach(() => {
	sql.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
			sql
				.prepare("SELECT COUNT(*) AS total FROM audio_client_signin_codes")
				.get(),
		).toEqual({ total: 0 });

		expect((await requestSignInCode()).status).toBe(200);

		const response = await completeCode(
			context(
				"/api/studio/session",
				{ email, code: sentCode() },
				{ cookie: browserCookie() },
			),
		);

		expect(response.status).toBe(200);
		const cookie = response.headers.getSetCookie()[0];
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
					context(
						"/api/studio/session",
						{ email, code: rejected },
						{ cookie: browserCookie() },
					),
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
			context(
				"/api/studio/session",
				{ email, code: sentCode() },
				{ cookie: browserCookie() },
			),
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

		await exhaustAllowance(
			"session-requester",
			`${client}:${await hashValue(browser ?? "")}`,
		);
		expect(
			(
				await completeCode(
					context(
						"/api/studio/session",
						{ email, code: issued },
						{ cookie: browserCookie() },
					),
				)
			).status,
		).toBe(429);
		expect(
			sql.prepare("SELECT used_at FROM audio_client_signin_codes").get(),
		).toEqual({ used_at: null });
		expect(
			sql.prepare("SELECT COUNT(*) AS total FROM audio_client_sessions").get(),
		).toEqual({ total: 0 });
	});

	it("answers 500, clears the browser cookie and logs once when session revocation fails", async () => {
		seedProject();
		const token = await signIn();
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});

		const failing = double<D1Database>({
			prepare: () => {
				throw new Error("Database unavailable");
			},
		});

		const ctx = context("/api/studio/sign-out", {}, { database: failing });
		ctx.request.headers.set("cookie", `studio_session=${token}`);
		const response = await signOut(ctx);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ ok: false, localSignedOut: true });
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(errors).toHaveBeenCalledOnce();
		expect(errors).toHaveBeenCalledWith(
			"/api/studio/sign-out failed unexpectedly:",
			"Error",
			"Database unavailable",
		);
		expect(
			sql
				.prepare(
					"SELECT COUNT(*) AS total FROM audio_client_sessions WHERE revoked_at IS NULL",
				)
				.get(),
		).toEqual({ total: 1 });
	});
});

describe("studio sign-in faults", () => {
	const SHORT_KEY = "k".repeat(31);
	const PENDING = `__Host-studio_pending=${"1".repeat(64)}`;

	const unavailable = {
		ok: false,
		error: "Studio sign-in is temporarily unavailable.",
	};

	// A database that refuses every use and records it, so a test can show a route made no statement.
	function untouched() {
		const prepare = vi.fn((): D1PreparedStatement => {
			throw new Error("no statement expected");
		});

		return { prepare, database: fakeD1({ prepare }) };
	}

	// The real database, with every batch failing as D1 does when it is down.
	const down = () =>
		fakeD1({
			prepare: (query) => db.prepare(query),
			batch: async () => {
				throw new Error("D1_ERROR: d1 down");
			},
		});

	let errors: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errors = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("reads the code request's body before the code key, so a short key still answers a bad body with 400", async () => {
		const { prepare, database } = untouched();

		const invalid = await requestCode(
			context(
				"/api/studio/code",
				{ email: "not an email", turnstileToken: "challenge" },
				{ database, codeKey: SHORT_KEY },
			),
		);

		const noToken = await requestCode(
			context("/api/studio/code", { email }, { database, codeKey: SHORT_KEY }),
		);

		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			ok: false,
			error: "Enter a valid email address.",
		});
		expect(noToken.status).toBe(400);
		expect(await noToken.json()).toEqual({
			ok: false,
			error: "Enter your email and complete the security check.",
		});
		expect(prepare).not.toHaveBeenCalled();
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});

	it("answers a code request with a short code key with 503, before any statement or check, and logs nothing", async () => {
		const { prepare, database } = untouched();

		const response = await requestCode(
			context(
				"/api/studio/code",
				{ email, turnstileToken: "challenge" },
				{ database, codeKey: SHORT_KEY },
			),
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(unavailable);
		expect(prepare).not.toHaveBeenCalled();
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
	});

	it("checks the pending cookie before the code key, so a short key still answers a missing cookie with 401", async () => {
		const { prepare, database } = untouched();

		const response = await completeCode(
			context(
				"/api/studio/session",
				{ email, code: "12345678" },
				{ database, codeKey: SHORT_KEY },
			),
		);

		expect(response.status).toBe(401);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("answers an entry with a short code key with 503, before any statement, and logs nothing", async () => {
		const { prepare, database } = untouched();

		const response = await completeCode(
			context(
				"/api/studio/session",
				{ email, code: "12345678" },
				{ database, codeKey: SHORT_KEY, cookie: PENDING },
			),
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(unavailable);
		expect(prepare).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
	});

	it("answers a code request with 500 and logs once when the database fails", async () => {
		const response = await requestCode(
			context(
				"/api/studio/code",
				{ email, turnstileToken: "challenge" },
				{ database: down() },
			),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual(unavailable);
		expect(errors).toHaveBeenCalledOnce();
		expect(errors).toHaveBeenCalledWith(
			"/api/studio/code failed unexpectedly:",
			"Error",
			"D1_ERROR: d1 down",
		);
	});

	it("answers an entry with 500 and logs once when the database fails", async () => {
		const response = await completeCode(
			context(
				"/api/studio/session",
				{ email, code: "12345678" },
				{ database: down(), cookie: PENDING },
			),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual(unavailable);
		expect(errors).toHaveBeenCalledOnce();
		expect(errors).toHaveBeenCalledWith(
			"/api/studio/session failed unexpectedly:",
			"Error",
			"D1_ERROR: d1 down",
		);
	});

	it("sends the code before answering when the request has no execution context", async () => {
		seedProject();

		const ctx = context(
			"/api/studio/code",
			{ email, turnstileToken: "challenge" },
			{ noContext: true },
		);

		const response = await requestCode(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			message:
				"If this email has a studio project, a sign-in code is on its way.",
		});
		// Nothing was left to run after the answer: the email had already gone.
		expect(ctx.pending).toEqual([]);
		expect(emails).toHaveLength(1);

		browser = /__Host-studio_pending=([0-9a-f]{64})/.exec(
			response.headers.get("set-cookie") ?? "",
		)?.[1];

		const entered = await completeCode(
			context(
				"/api/studio/session",
				{ email, code: sentCode() },
				{ cookie: browserCookie() },
			),
		);

		expect(entered.status).toBe(200);
	});

	it("discards a refused code before answering when the request has no execution context", async () => {
		seedProject();
		emails = stubResend({ resend: [{ status: 422 }] });

		const response = await requestCode(
			context(
				"/api/studio/code",
				{ email, turnstileToken: "challenge" },
				{ noContext: true },
			),
		);

		expect(response.status).toBe(200);
		expect(emails).toHaveLength(1);
		expect(
			sql
				.prepare("SELECT COUNT(*) AS total FROM audio_client_signin_codes")
				.get(),
		).toEqual({ total: 0 });
		expect(errors).not.toHaveBeenCalled();
	});
});
