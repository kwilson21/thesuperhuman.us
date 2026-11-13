import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { issueAgreementLink } from "~/lib/agreement-access";
import { POST as musicInterest } from "~/pages/api/music-interest";
import { passGuards } from "~/server/flows/guards";
import { RateLimit, Turnstile, TurnstileFailed } from "~/server/services";
import { fakeKv, partial } from "../helpers/doubles";
import { answerOfRun, done, refuse } from "../helpers/rule-answers";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1 } from "../helpers/sqlite-d1";

// A public form checks, in this order: a coarse limit on the visitor's address (so the captcha service is not asked
// without bound), the captcha, and last the visitor's own allowance. A request that fails the captcha therefore never
// uses up the allowance of the visitor who sends the real one.

// The captcha service is the one outside call these routes make before sending anything; a stub of fetch stands in for it.
const captcha = vi.fn();

const answerCaptcha = (passes: boolean) => {
	captcha.mockReset();
	captcha.mockImplementation(
		async () => new Response(JSON.stringify({ success: passes })),
	);
	vi.stubGlobal("fetch", captcha);
};

const IP = "203.0.113.7";

afterEach(() => {
	vi.unstubAllGlobals();
});

// The flow: contact and resume request.

function flow(options: {
	captcha: "pass" | "fail";
	stored?: Record<string, string>;
}) {
	const store = new Map(Object.entries(options.stored ?? {}));
	const log: string[] = [];

	const kv = fakeKv({
		get: async (key: string) => store.get(key) ?? null,
		put: async (key: string, value: string) => {
			log.push(`count ${key}`);
			store.set(key, value);
		},
	});

	const answer = answerOfRun(
		passGuards({ ip: IP, turnstileToken: "token" }).pipe(
			Effect.provideService(RateLimit, kv),
			Effect.provideService(Turnstile, {
				verify: () => {
					log.push("captcha");

					return options.captcha === "fail"
						? Effect.fail(new TurnstileFailed())
						: Effect.void;
				},
			}),
		),
	);

	return answer.then((result) => ({ result, log }));
}

const wait = refuse(
	"RateLimited",
	"Please wait a few minutes before submitting again.",
);

it("flow: a failed captcha counts only the coarse limit", async () => {
	const { result, log } = await flow({ captcha: "fail" });

	expect(result).toEqual(refuse("CaptchaFailed", "Captcha failed."));
	expect(log).toEqual([`count rl:attempt:${IP}`, "captcha"]);
});

it("flow: a passed captcha counts the coarse limit, then the visitor's allowance", async () => {
	const { result, log } = await flow({ captcha: "pass" });

	expect(result).toEqual(done(undefined));
	expect(log).toEqual([`count rl:attempt:${IP}`, "captcha", `count rl:${IP}`]);
});

it("flow: the coarse limit refuses before the captcha is asked", async () => {
	const { result, log } = await flow({
		captcha: "pass",
		stored: { [`rl:attempt:${IP}`]: "10" },
	});

	expect(result).toEqual(wait);
	expect(log).toEqual([]);
});

it("flow: a visitor who already sent is refused after a passed captcha", async () => {
	const { result, log } = await flow({
		captcha: "pass",
		stored: { [`rl:${IP}`]: "1" },
	});

	expect(result).toEqual(wait);
	expect(log).toEqual([`count rl:attempt:${IP}`, "captcha"]);
});

it("flow: ten failed captchas in a window still leave the allowance unused", async () => {
	const stored: Record<string, string> = {};

	for (let attempt = 0; attempt < 9; attempt++) {
		stored[`rl:attempt:${IP}`] = String(attempt);
		const { log } = await flow({ captcha: "fail", stored });

		expect(log).not.toContain(`count rl:${IP}`);
	}
});

// The music interest route.

function interestRequest() {
	return new Request("https://thesuperhuman.us/api/music-interest", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://thesuperhuman.us",
			"cf-connecting-ip": IP,
		},
		body: JSON.stringify({
			releaseId: "old-news-single",
			email: "fan@example.com",
			interest: "both",
			merchandise: ["shirts"],
			suggestion: "",
			cityRegion: "Roanoke, VA",
			consent: true,
			turnstileToken: "token",
		}),
	});
}

async function interest(passes: boolean) {
	answerCaptcha(passes);
	const store = new Map<string, string>();
	const keys: string[] = [];

	const response = await musicInterest(
		partial<APIContext>({
			request: interestRequest(),
			locals: {
				runtime: partial<TestRuntime>({
					env: partial<TestRuntime["env"]>({
						MUSIC_DB: partial<D1Database>({}),
						TURNSTILE_SECRET_KEY: "secret",
						RATE_LIMIT: fakeKv({
							get: async (key: string) => store.get(key) ?? null,
							put: async (key: string, value: string) => {
								keys.push(key);
								store.set(key, value);
							},
						}),
					}),
				}),
			},
		}),
	);

	return { response, keys };
}

it("music interest: a failed captcha counts only the coarse limit", async () => {
	const { response, keys } = await interest(false);

	expect(response.status).toBe(403);
	expect(keys).toEqual([`rl:music-interest-attempt:${IP}`]);
});

// The agreement link request.

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
let sql: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
	sql = new DatabaseSync(":memory:");
	sql.exec("PRAGMA foreign_keys=ON");
	sql.exec(readFileSync("db/music.sql", "utf8"));
});

function linkRequest() {
	return new Request("https://thesuperhuman.us/api/agreements/link", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			origin: "https://thesuperhuman.us",
			"cf-connecting-ip": IP,
		},
		body: "{}",
	});
}

const linkEnv = () =>
	partial<Env>({
		MUSIC_DB: sqliteD1(sql, /^SELECT|RETURNING/),
		AUDIO_CLIENT_CODE_KEY: "k".repeat(40),
		RESEND_API_KEY: "re_key",
		CONTACT_FROM_EMAIL: "site@example.test",
		TURNSTILE_SECRET_KEY: "secret",
		SITE_ORIGIN: "https://thesuperhuman.us",
	});

const allowanceRows = () =>
	sql.prepare("SELECT count(*) AS n FROM audio_client_allowances").get().n;

it("agreement link: a failed captcha counts the address allowance and not the email's", async () => {
	answerCaptcha(false);

	const response = await issueAgreementLink(linkEnv(), linkRequest(), {
		turnstileToken: "t",
		email: "client@example.com",
	});

	expect(response.status).toBe(403);
	expect(allowanceRows()).toBe(1);
});

it("agreement link: the address allowance refuses before the captcha is asked", async () => {
	answerCaptcha(true);

	for (let use = 0; use < 20; use++)
		await issueAgreementLink(linkEnv(), linkRequest(), {
			turnstileToken: "t",
			email: `client${use}@example.com`,
		});
	captcha.mockClear();

	const response = await issueAgreementLink(linkEnv(), linkRequest(), {
		turnstileToken: "t",
		email: "client@example.com",
	});

	expect(response.status).toBe(429);
	expect(captcha).not.toHaveBeenCalled();
});
