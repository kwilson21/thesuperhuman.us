import type { APIContext } from "astro";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { POST } from "~/pages/api/audio-intake";
import { freshMusicDb } from "../golden/harness";
import { double, fakeKv, partial } from "../helpers/doubles";
import type { JsonObject } from "../helpers/json";
import { type ResendEmail, stubResend } from "../helpers/resend-fetch";
import type { TestRuntime } from "../helpers/runtime";
import { type SqliteDatabase, sqliteD1 } from "../helpers/sqlite-d1";

const base = {
	service: "vocal-mix",
	title: "My song",
	direction: "judgment",
	preferences: {},
	name: "Artist",
	email: "artist@example.com",
	permission: true,
	turnstileToken: "test",
	fileLink: "https://drive.google.com/example",
};

/** The rate-limit read of the latest context(), so a test can change what the limiter reports. */
let rateLimitGet: Mock;

/** The database every context() writes to; each test starts with a fresh one. */
let sql: SqliteDatabase;

/** The emails Resend was asked to send in the current test. */
let emails: ResendEmail[];

function context(
	body: JsonObject = base,
	origin = "https://thesuperhuman.us",
): APIContext {
	rateLimitGet = vi.fn(async () => null);

	return partial<APIContext>({
		request: new Request("https://thesuperhuman.us/api/audio-intake", {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
		locals: {
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					MUSIC_DB: sqliteD1(sql),
					RESEND_API_KEY: "test",
					CONTACT_FROM_EMAIL: "test@example.com",
					CONTACT_TO_EMAIL: "owner@example.com",
					TURNSTILE_SECRET_KEY: "test",
					RATE_LIMIT: fakeKv({
						get: rateLimitGet,
						put: vi.fn(async () => {}),
						delete: vi.fn(async () => {}),
					}),
				}),
			}),
		},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	sql = freshMusicDb();
	sql.exec("PRAGMA foreign_keys=ON");
	emails = stubResend();
});

afterEach(() => {
	sql.close();
	vi.unstubAllGlobals();
});

describe("intake endpoint", () => {
	it("stores reviewed details without fetching the shared file", async () => {
		const res = await POST(context());
		expect(res.status).toBe(200);
		expect(
			sql.prepare("SELECT kind,service_id,email FROM owner_requests").all(),
		).toEqual([
			{ kind: "service", service_id: "vocal-mix", email: "artist@example.com" },
		]);
	});
	it("sends the owner an immediate notice with the service, title, client, files, direction and a dashboard link, regardless of the client portal flag", async () => {
		const res = await POST(context());
		expect(res.status).toBe(200);
		expect(
			sql.prepare("SELECT invitation_attempted_at FROM audio_projects").get(),
		).toEqual({ invitation_attempted_at: null });

		expect(emails).toHaveLength(1);
		const body = emails[0];
		expect(body.to).toEqual(["owner@example.com"]);
		expect(body.reply_to).toBe("artist@example.com");
		expect(body.subject).not.toContain("—");
		expect(body.text).not.toContain("—");
		expect(body.text).toContain("Service: Two-track vocal mixing");
		expect(body.text).toContain("Title: My song");
		expect(body.text).toContain("Name: Artist");
		expect(body.text).toContain("Email: artist@example.com");
		expect(body.text).toContain("Files: https://drive.google.com/example");
		expect(body.text).toContain("Direction: Use your judgment");
		const requestId = sql.prepare("SELECT id FROM owner_requests").get()?.id;
		expect(body.text).toContain(
			`https://thesuperhuman.us/owner/requests/${requestId}`,
		);
	});
	it("queues a sign-in invitation in addition to the owner notice when the private portal is enabled", async () => {
		const ctx = context();
		const background: Promise<unknown>[] = [];
		ctx.locals.runtime.ctx = double<ExecutionContext>({
			waitUntil: vi.fn((work: Promise<unknown>) => {
				background.push(work);
			}),
		});
		ctx.locals.runtime.env.AUDIO_CLIENT_PORTAL_ENABLED = "true";
		expect((await POST(ctx)).status).toBe(200);
		await Promise.all(background);
		expect(background).toHaveLength(1);
		expect(
			sql
				.prepare(
					"SELECT invitation_status FROM audio_projects WHERE request_id=(SELECT id FROM owner_requests)",
				)
				.get(),
		).toEqual({ invitation_status: "sent" });

		expect(emails).toContainEqual(
			expect.objectContaining({
				to: ["artist@example.com"],
				subject: "Your private studio project",
			}),
		);
	});
	it("still returns success when the owner notice fails to send, since the request is already stored", async () => {
		emails = stubResend({ resend: [{ status: 500 }] });
		const res = await POST(context());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
	it("rejects cross-origin and oversized requests before external calls", async () => {
		expect((await POST(context(base, "https://evil.example"))).status).toBe(
			403,
		);
		expect((await POST(context({ padding: "x".repeat(33000) }))).status).toBe(
			413,
		);
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});
	it("requires files and permission before sending", async () => {
		expect(
			(await POST(context({ ...base, fileLink: "", permission: false })))
				.status,
		).toBe(400);
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});
	it("does not accept obsolete upload session instead of files", async () => {
		expect(
			(
				await POST(
					context({
						...base,
						fileLink: "",
						uploadSession: "00000000-0000-0000-0000-000000000001",
					}),
				)
			).status,
		).toBe(400);
	});
	it("does not claim success when storage is unavailable or fails", async () => {
		const ctx = context();
		ctx.locals.runtime.env.MUSIC_DB = undefined;
		expect((await POST(ctx)).status).toBe(503);
		sql.exec(
			"CREATE TRIGGER reject_request_storage BEFORE INSERT ON owner_requests BEGIN SELECT RAISE(ABORT,'database unavailable'); END;",
		);
		expect((await POST(context())).status).toBe(503);

		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			subject: "Urgent: website request storage failed",
			to: ["owner@example.com"],
		});
		expect(emails[0].text).toContain("Category: request-storage");
		expect(emails[0].text).toContain("Route: /api/audio-intake");
	});
	it("rejects empty specific direction before external calls", async () => {
		const response = await POST(
			context({ ...base, direction: "specific", referenceNote: "  " }),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			errors: {
				referenceNote: "Describe the specific direction you have in mind.",
			},
		});
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});
	it("allows a corrected captcha immediately while limiting successful submissions", async () => {
		const stored = new Map<string, string>();

		const kv = fakeKv({
			get: vi.fn(async (key: string) => stored.get(key) ?? null),
			put: vi.fn(async (key: string, value: string) => {
				stored.set(key, value);
			}),
		});

		const submit = () => {
			const ctx = context();
			ctx.locals.runtime.env.RATE_LIMIT = kv;

			return POST(ctx);
		};

		emails = stubResend({ turnstile: [false, true] });
		expect((await submit()).status).toBe(403);
		expect(stored.has("rl:audio:0.0.0.0")).toBe(false);
		expect((await submit()).status).toBe(200);
		expect((await submit()).status).toBe(429);
		// Exactly one submission succeeded, so exactly one owner notice went out.
		expect(emails).toHaveLength(1);
	});
	it("bounds repeated failed captcha attempts before external verification", async () => {
		const ctx = context();
		rateLimitGet.mockImplementation(async (key: string) =>
			key.startsWith("rl:audio-attempt:") ? "10" : null,
		);
		expect((await POST(ctx)).status).toBe(429);
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});
	it("blocks failed captcha and rate limit", async () => {
		const ctx = context();
		rateLimitGet.mockResolvedValue("1");
		expect((await POST(ctx)).status).toBe(429);
		stubResend({ turnstile: [false] });
		expect((await POST(context())).status).toBe(403);
	});
});
