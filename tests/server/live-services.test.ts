import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "../../src/lib/resend";
import {
	Mail,
	OwnerAlert,
	RateLimit,
	ResumeStore,
	Turnstile,
	legacyBindingsOrDefect,
	liveMail,
	liveOwnerAlert,
	liveTurnstile,
} from "../../src/server/services";
import { double, fakeKv } from "../helpers/doubles";

// The live Mail and Turnstile wrap sendMail (src/lib/resend.ts) and verifyTurnstile (src/lib/turnstile.ts), which is
// where the requests are made, so these tests stub fetch and look at what each service answers by name.

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
	fetchMock = vi.fn<typeof fetch>();
	vi.stubGlobal("fetch", fetchMock);
});

const message = {
	from: "site@example.test",
	to: ["owner@example.test"],
	subject: "Hello",
	text: "Body",
};

const answered = (status: number) =>
	double<Response>({ ok: status < 400, status, json: async () => ({}) });

/** What the live Mail answers for a message: "sent", or the name of its failure. */
const sendLive = (apiKey = "key") =>
	Mail.use((mail) => mail.send(message)).pipe(
		Effect.provideContext(liveMail(apiKey)),
		Effect.match({
			onFailure: (failure) => failure._tag,
			onSuccess: () => "sent",
		}),
		Effect.runPromise,
	);

describe("sendMail", () => {
	it("posts the message to Resend with the key, and says it sent", async () => {
		fetchMock.mockResolvedValue(answered(200));

		expect(await sendMail("key", message)).toBe("sent");

		const [url, init] = fetchMock.mock.calls[0];

		expect(url).toBe("https://api.resend.com/emails");
		expect(init?.method).toBe("POST");

		expect(init?.headers).toEqual({
			Authorization: "Bearer key",
			"Content-Type": "application/json",
		});

		expect(JSON.parse(String(init?.body))).toEqual({
			from: "site@example.test",
			to: ["owner@example.test"],
			subject: "Hello",
			text: "Body",
		});
	});

	it("sends the idempotency key as a header when the message has one", async () => {
		fetchMock.mockResolvedValue(answered(200));

		await sendMail("key", { ...message, idempotencyKey: "once" });

		expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
			Authorization: "Bearer key",
			"Content-Type": "application/json",
			"Idempotency-Key": "once",
		});
	});

	it("says refused for an answer below 500 that is not a success", async () => {
		fetchMock.mockResolvedValue(answered(422));

		expect(await sendMail("key", message)).toBe("refused");
	});

	it("says uncertain for a 5xx and for no answer at all", async () => {
		fetchMock.mockResolvedValue(answered(503));
		expect(await sendMail("key", message)).toBe("uncertain");

		fetchMock.mockRejectedValue(new Error("network down"));
		expect(await sendMail("key", message)).toBe("uncertain");
	});
});

describe("liveMail", () => {
	it("answers with the failure that names what Resend did", async () => {
		fetchMock.mockResolvedValueOnce(answered(200));
		expect(await sendLive()).toBe("sent");

		fetchMock.mockResolvedValueOnce(answered(400));
		expect(await sendLive()).toBe("MailRefused");

		fetchMock.mockResolvedValueOnce(answered(500));
		expect(await sendLive()).toBe("MailUncertain");

		fetchMock.mockRejectedValueOnce(new Error("timeout"));
		expect(await sendLive()).toBe("MailUncertain");
	});

	it("signs the request with the key it was made with", async () => {
		fetchMock.mockResolvedValue(answered(200));

		await sendLive("re_other");

		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
			Authorization: "Bearer re_other",
		});
	});
});

describe("liveTurnstile", () => {
	const verify = () =>
		Turnstile.use((turnstile) => turnstile.verify("tok", "1.2.3.4")).pipe(
			Effect.provideContext(liveTurnstile("secret")),
			Effect.match({
				onFailure: (failure) => failure._tag,
				onSuccess: () => "passed",
			}),
			Effect.runPromise,
		);

	it("passes when Turnstile says success, and sends the secret, the token and the address", async () => {
		fetchMock.mockResolvedValue(
			double<Response>({ ok: true, json: async () => ({ success: true }) }),
		);

		expect(await verify()).toBe("passed");

		const [url, init] = fetchMock.mock.calls[0];

		expect(url).toBe(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		);
		expect(String(init?.body)).toBe(
			"secret=secret&response=tok&remoteip=1.2.3.4",
		);
	});

	it("fails with TurnstileFailed when it says no, answers badly or cannot be reached", async () => {
		fetchMock.mockResolvedValueOnce(
			double<Response>({ ok: true, json: async () => ({ success: false }) }),
		);
		expect(await verify()).toBe("TurnstileFailed");

		fetchMock.mockResolvedValueOnce(answered(500));
		expect(await verify()).toBe("TurnstileFailed");

		fetchMock.mockRejectedValueOnce(new Error("network down"));
		expect(await verify()).toBe("TurnstileFailed");
	});
});

describe("liveOwnerAlert", () => {
	const incident = {
		category: "request-storage",
		route: "/api/music-interest",
		requestId: "id-1",
		code: "d1-write-failed",
		occurredAt: "2026-11-14T12:00:00.000Z",
	} as const;

	const env = (over: Partial<Env> = {}) =>
		double<Env>({
			RESEND_API_KEY: "key",
			CONTACT_FROM_EMAIL: "site@example.test",
			CONTACT_TO_EMAIL: "owner@example.test",
			...over,
		});

	/** What the live alert answers: "sent", or the name of its failure and what it carries. */
	const alert = (given: Env) =>
		OwnerAlert.use((owner) => owner.send(incident)).pipe(
			Effect.provideContext(liveOwnerAlert(given)),
			Effect.match({
				onFailure: (failure) => ({
					tag: failure._tag,
					own: Object.keys(failure),
					text: String(failure),
				}),
				onSuccess: () => "sent",
			}),
			Effect.runPromise,
		);

	it("sends the incident through Resend and says it sent", async () => {
		fetchMock.mockResolvedValue(answered(200));

		expect(await alert(env())).toBe("sent");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("fails with OwnerAlertFailed when the alert is not sent (sendUrgentOwnerAlert answers false)", async () => {
		fetchMock.mockResolvedValue(answered(500));
		expect(await alert(env())).toMatchObject({ tag: "OwnerAlertFailed" });

		// No key: the alert is not even attempted, and answers false.
		fetchMock.mockClear();
		expect(await alert(env({ RESEND_API_KEY: "" }))).toMatchObject({
			tag: "OwnerAlertFailed",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fails with OwnerAlertFailed, carrying none of the error's text, when the call rejects", async () => {
		const rejecting = double<Env>({
			get RESEND_API_KEY(): string {
				throw new Error("keychain down for fan@example.com");
			},
		});

		const answer = await alert(rejecting);

		expect(answer).toMatchObject({ tag: "OwnerAlertFailed", own: ["_tag"] });
		expect(JSON.stringify(answer)).not.toContain("keychain");
		expect(JSON.stringify(answer)).not.toContain("fan@example.com");
	});
});

describe("legacyBindingsOrDefect", () => {
	const rate = fakeKv({ get: async () => "rate" });

	it("provides each binding that is set", () => {
		const services = legacyBindingsOrDefect(double<Env>({ RATE_LIMIT: rate }));

		expect(Context.get(services, RateLimit)).toBe(rate);
	});

	it("leaves a binding that is not set out, so a rule that reads it dies there", async () => {
		const services = legacyBindingsOrDefect(double<Env>({ RATE_LIMIT: rate }));

		const rateRead = RateLimit.use(() => Effect.succeed("read")).pipe(
			Effect.provideContext(services),
		);

		const storeRead = ResumeStore.use(() => Effect.succeed("read")).pipe(
			Effect.provideContext(services),
		);

		expect(await Effect.runPromise(rateRead)).toBe("read");
		await expect(Effect.runPromise(storeRead)).rejects.toThrow();
	});
});
