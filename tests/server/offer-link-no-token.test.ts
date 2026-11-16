import { describe, expect, it } from "vitest";
import { POST } from "~/pages/api/offer/[token]/link";
import { double, fakeD1 } from "../helpers/doubles";

// POST /api/offer/[token]/link for a request Astro never routes: no token, or an empty one. The route answers as it did
// when the archive path took such a request: the origin check, then the configuration check, then the missing recipient.

type Context = Parameters<typeof POST>[0];

const settings = {
	MUSIC_DB: fakeD1({}),
	AUDIO_CLIENT_CODE_KEY: "k".repeat(40),
	RESEND_API_KEY: "re_key",
	CONTACT_FROM_EMAIL: "site@example.test",
	TURNSTILE_SECRET_KEY: "secret",
};

const ask = async (
	env: Partial<typeof settings>,
	params: { token?: string },
	origin = "https://thesuperhuman.us",
) => {
	const response = await POST(
		double<Context>({
			request: new Request(`${origin}/api/offer/x/link`, {
				method: "POST",
				headers: { "content-type": "application/json", origin },
				body: JSON.stringify({ turnstileToken: "t" }),
			}),
			locals: double<Context["locals"]>({
				runtime: double<Context["locals"]["runtime"]>({
					env: double<Context["locals"]["runtime"]["env"]>(env),
				}),
			}),
			params,
		}),
	);

	return { status: response.status, body: await response.json() };
};

const unavailable = {
	ok: false,
	error: "Agreement sign-in is temporarily unavailable.",
};

describe.each([
	["no token", {}],
	["an empty token", { token: "" }],
])("a request with %s", (_name, params) => {
	it("answers the missing recipient when the site is configured", async () => {
		expect(await ask(settings, params)).toEqual({
			status: 400,
			body: { ok: false, error: "Enter a valid email address." },
		});
	});

	it("answers 404 for another host before anything else", async () => {
		expect(await ask({}, params, "https://evil.example")).toEqual({
			status: 404,
			body: { ok: false },
		});
	});

	it("answers 503 for a missing binding or secret, and for a code key under 32 characters", async () => {
		for (const missing of [
			{ ...settings, MUSIC_DB: undefined },
			{ ...settings, AUDIO_CLIENT_CODE_KEY: undefined },
			{ ...settings, AUDIO_CLIENT_CODE_KEY: "k".repeat(31) },
			{ ...settings, RESEND_API_KEY: undefined },
			{ ...settings, CONTACT_FROM_EMAIL: undefined },
			{ ...settings, TURNSTILE_SECRET_KEY: undefined },
		])
			expect(await ask(missing, params)).toEqual({
				status: 503,
				body: unavailable,
			});
	});
});
