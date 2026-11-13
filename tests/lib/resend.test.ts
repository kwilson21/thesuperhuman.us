import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import * as Effect from "effect/Effect";
import { submitContact } from "~/server/flows/contact";
import { RateLimit, Turnstile, liveMail } from "~/server/services";
import type { ContactInput } from "~/server/contact-input";
import { double, fakeKv } from "../helpers/doubles";

const input: ContactInput = {
	name: "Jane",
	email: "jane@example.com",
	company: "Acme",
	description: "Need help with our ingestion pipeline; can pay well.",
	turnstileToken: "tok",
};

// What the contact route sends, through the live Mail it uses: the owner's email, then the visitor's thank-you. The guards
// are stubbed to pass, so every fetch below is a request to Resend.
const sendContactEmails = (args: {
	input: ContactInput;
	apiKey: string;
	from: string;
	to: string;
}) =>
	Effect.runPromise(
		submitContact({
			input: args.input,
			visitor: { ip: "203.0.113.7", turnstileToken: args.input.turnstileToken },
			from: args.from,
			to: args.to,
		}).pipe(
			Effect.provideService(
				RateLimit,
				fakeKv({ get: async () => null, put: async () => {} }),
			),
			Effect.provideService(Turnstile, { verify: () => Effect.void }),
			Effect.provideContext(liveMail(args.apiKey)),
			Effect.match({
				onFailure: () => ({ ok: false }),
				onSuccess: () => ({ ok: true }),
			}),
		),
	);

describe("sendContactEmails", () => {
	let fetchMock: Mock<typeof fetch>;

	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
	});

	it("sends both primary and autoresponder emails", async () => {
		fetchMock.mockResolvedValue(
			double<Response>({
				ok: true,
				json: async () => ({ id: "em_1" }),
			}),
		);

		const result = await sendContactEmails({
			input,
			apiKey: "key",
			from: "noreply@thesuperhuman.us",
			to: "kazon.wilson@thesuperhuman.us",
		});

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		for (const call of fetchMock.mock.calls) {
			expect(call[0]).toBe("https://api.resend.com/emails");
			expect(call[1]?.method).toBe("POST");
			expect(call[1]?.headers).toEqual({
				Authorization: "Bearer key",
				"Content-Type": "application/json",
			});
		}
	});

	it("primary email goes to CONTACT_TO_EMAIL with reply-to set to visitor", async () => {
		fetchMock.mockResolvedValue(
			double<Response>({
				ok: true,
				json: async () => ({ id: "em_1" }),
			}),
		);
		await sendContactEmails({
			input,
			apiKey: "key",
			from: "noreply@thesuperhuman.us",
			to: "kazon.wilson@thesuperhuman.us",
		});

		const primaryBody = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));

		expect(primaryBody.to).toContain("kazon.wilson@thesuperhuman.us");
		expect(primaryBody.reply_to).toBe("jane@example.com");
		expect(primaryBody.subject).toBe("New message from Jane");
		expect(primaryBody.text).toContain("Message:");
		expect(primaryBody.text).not.toMatch(
			/Project type:|Timeline:|Budget:|undefined/,
		);
	});

	it("autoresponder goes to the visitor email", async () => {
		fetchMock.mockResolvedValue(
			double<Response>({
				ok: true,
				json: async () => ({ id: "em_1" }),
			}),
		);
		await sendContactEmails({
			input,
			apiKey: "key",
			from: "noreply@thesuperhuman.us",
			to: "kazon.wilson@thesuperhuman.us",
		});

		const autoBody = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));

		expect(autoBody.to).toContain("jane@example.com");
		expect(autoBody.subject).toMatch(/thanks/i);
		expect(autoBody.text).toContain("https://thesuperhuman.us/about#resumes");
		expect(autoBody.html).toContain("Thanks, I’ve got your message.");
		expect(autoBody.text).not.toMatch(/DoD|two business days/);
	});

	it("returns ok=false if primary email fails", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: false,
				status: 500,
				json: async () => ({ message: "fail" }),
			}),
		);
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({ id: "em_2" }),
			}),
		);

		const result = await sendContactEmails({
			input,
			apiKey: "key",
			from: "noreply@thesuperhuman.us",
			to: "kazon.wilson@thesuperhuman.us",
		});

		expect(result.ok).toBe(false);
	});

	it("autoresponder failure does NOT fail the request (best-effort)", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: true,
				json: async () => ({ id: "em_1" }),
			}),
		);
		fetchMock.mockResolvedValueOnce(
			double<Response>({
				ok: false,
				status: 500,
				json: async () => ({ message: "fail" }),
			}),
		);

		const result = await sendContactEmails({
			input,
			apiKey: "key",
			from: "noreply@thesuperhuman.us",
			to: "kazon.wilson@thesuperhuman.us",
		});

		expect(result.ok).toBe(true);
	});
});
