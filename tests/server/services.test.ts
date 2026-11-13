import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	AudioBucket,
	Mail,
	MailRefused,
	MailUncertain,
	MusicDb,
	OAuthKv,
	PublicationDb,
	RateLimit,
	ResumeStore,
	Stripe,
	StripeRefused,
	StripeSignatureInvalid,
	StripeUnavailable,
	Turnstile,
	TurnstileFailed,
	liveServices,
} from "../../src/server/services";
import { double, fakeKv } from "../helpers/doubles";

const d1 = (name: string) =>
	double<D1Database>({ dump: async () => new ArrayBuffer(name.length) });

const kv = (name: string) => fakeKv({ get: async () => name });

const env = (): Env =>
	double<Env>({
		MUSIC_DB: d1("music"),
		PUBLICATION_DB: d1("publication"),
		RATE_LIMIT: kv("rate"),
		RESUME_STORE: kv("resume"),
		OAUTH_KV: kv("oauth"),
		AUDIO: double<R2Bucket>({ head: async () => null }),
	});

describe("liveServices", () => {
	it("hands each service the binding it is named for", () => {
		const bindings = env();
		const services = liveServices(bindings);

		expect(Context.get(services, MusicDb)).toBe(bindings.MUSIC_DB);
		expect(Context.get(services, PublicationDb)).toBe(bindings.PUBLICATION_DB);
		expect(Context.get(services, RateLimit)).toBe(bindings.RATE_LIMIT);
		expect(Context.get(services, ResumeStore)).toBe(bindings.RESUME_STORE);
		expect(Context.get(services, OAuthKv)).toBe(bindings.OAUTH_KV);
		expect(Context.get(services, AudioBucket)).toBe(bindings.AUDIO);
	});

	it("gives undefined for an optional binding the deployment does not have", () => {
		const services = liveServices(
			double<Env>({
				RATE_LIMIT: kv("rate"),
				RESUME_STORE: kv("resume"),
				AUDIO: double<R2Bucket>({}),
			}),
		);

		expect(Context.get(services, MusicDb)).toBeUndefined();
		expect(Context.get(services, PublicationDb)).toBeUndefined();
		expect(Context.get(services, OAuthKv)).toBeUndefined();
	});

	it("lets a program read a service by its class", async () => {
		const bindings = env();

		const read = await Effect.runPromise(
			RateLimit.use((limit) => Effect.succeed(limit)).pipe(
				Effect.provideContext(liveServices(bindings)),
			),
		);

		expect(read).toBe(bindings.RATE_LIMIT);
	});

	it("keeps a different key for each service", () => {
		const keys = [
			MusicDb,
			PublicationDb,
			RateLimit,
			ResumeStore,
			OAuthKv,
			AudioBucket,
			Mail,
			Stripe,
			Turnstile,
		].map((service) => service.key);

		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("the outside-call services", () => {
	it("lets a test provide Mail and see its two failures by name", async () => {
		const send = (outcome: "ok" | "refused" | "uncertain") =>
			Mail.use((mail) =>
				mail.send({ from: "a@b.c", to: ["d@e.f"], subject: "s", text: "t" }),
			).pipe(
				Effect.provideService(Mail, {
					send: () =>
						outcome === "ok"
							? Effect.void
							: outcome === "refused"
								? Effect.fail(new MailRefused())
								: Effect.fail(new MailUncertain()),
				}),
				Effect.match({
					onFailure: (failure) => failure._tag,
					onSuccess: () => "sent",
				}),
				Effect.runPromise,
			);

		expect(await send("ok")).toBe("sent");
		expect(await send("refused")).toBe("MailRefused");
		expect(await send("uncertain")).toBe("MailUncertain");
	});

	it("names the failures of Stripe", () => {
		expect(new StripeUnavailable()._tag).toBe("StripeUnavailable");
		expect(new StripeRefused()._tag).toBe("StripeRefused");
		expect(new StripeSignatureInvalid()._tag).toBe("StripeSignatureInvalid");
	});

	it("lets a test provide Turnstile and see its failure by name", async () => {
		const verify = (outcome: "pass" | "fail") =>
			Turnstile.use((t) => t.verify("token", "1.2.3.4")).pipe(
				Effect.provideService(Turnstile, {
					verify: () =>
						outcome === "pass"
							? Effect.void
							: Effect.fail(new TurnstileFailed()),
				}),
				Effect.match({
					onFailure: (failure) => failure._tag,
					onSuccess: () => "passed",
				}),
				Effect.runPromise,
			);

		expect(await verify("pass")).toBe("passed");
		expect(await verify("fail")).toBe("TurnstileFailed");
	});
});
