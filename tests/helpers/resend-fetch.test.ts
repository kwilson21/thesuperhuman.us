import { afterEach, expect, it, vi } from "vitest";
import { stubResend } from "./resend-fetch";

const turnstile = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

afterEach(() => vi.unstubAllGlobals());

it("records each Resend email and answers in order, then 200", async () => {
	const emails = stubResend({ resend: [{ status: 422 }, "network-down"] });

	const payload = JSON.stringify({
		from: "studio@example.com",
		to: ["artist@example.com"],
		subject: "Hello",
		text: "Body",
	});

	const headers = { Authorization: "Bearer key" };

	const first = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers,
		body: payload,
	});

	expect(first.status).toBe(422);
	await expect(
		fetch("https://api.resend.com/emails", {
			method: "POST",
			headers,
			body: payload,
		}),
	).rejects.toThrow("fetch failed");
	expect((await fetch("https://api.resend.com/emails")).status).toBe(200);
	expect(emails).toHaveLength(2);
	expect(emails[0]).toEqual({
		authorization: "Bearer key",
		from: "studio@example.com",
		to: ["artist@example.com"],
		subject: "Hello",
		text: "Body",
	});
});

it("answers Turnstile verdicts in order, and the last one repeats", async () => {
	const emails = stubResend({ turnstile: [false] });

	const check = async () =>
		(
			await fetch(turnstile, {
				method: "POST",
				body: new URLSearchParams({ secret: "test", response: "token" }),
			})
		).json();

	expect(await check()).toEqual({ success: false });
	expect(await check()).toEqual({ success: false });
	expect(emails).toEqual([]);
});

it("holds a Resend request until the test releases it, and records it only then", async () => {
	let release!: () => void;

	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});

	const emails = stubResend({ hold });

	const pending = fetch("https://api.resend.com/emails", {
		method: "POST",
		body: JSON.stringify({
			from: "a@example.com",
			to: ["b@example.com"],
			subject: "S",
			text: "T",
		}),
	});

	expect(emails).toEqual([]);
	release();

	expect((await pending).status).toBe(200);
	expect(emails).toHaveLength(1);
});

it("refuses any other outgoing request", async () => {
	stubResend();
	await expect(fetch("https://example.com/")).rejects.toThrow(
		"no answer scripted",
	);
});
