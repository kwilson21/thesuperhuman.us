import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { submitInterest } from "../../src/server/flows/music-interest";
import type { InterestInput } from "../../src/server/music-input";
import {
	MusicDb,
	OwnerAlert,
	RateLimit,
	Turnstile,
	TurnstileFailed,
} from "../../src/server/services";
import type { OwnerIncident } from "../../src/lib/owner-alerts";
import { fakeKv } from "../helpers/doubles";
import { musicWorld, type MusicWorldOptions } from "../helpers/music-world";
import { answerOfRun, refuse, refuseWith } from "../helpers/rule-answers";

// The interest flow as stories: a listener sends their interest, sends it again, is limited, fails the captcha, or hits a
// storage failure. Each story runs the real flow against the real schema; the captcha, the alert and the clock are
// doubles, so a story can say what they answered and see what was sent.

const said: InterestInput = {
	releaseId: "old-news-single",
	email: "fan@example.com",
	interest: "both",
	merchandise: ["shirts", "digital-art"],
	suggestion: "Blue design",
	cityRegion: "Nashville, Tennessee",
	consent: true,
	turnstileToken: "token",
};

const COUNTER = "rl:music-interest:203.0.113.7";

/** How many times each world has been sent to, so two sends to one database never reuse an id. */
const rounds = new WeakMap<object, number>();

type Told = { alerts: OwnerIncident[]; ids: number };

const send = async (
	world: ReturnType<typeof musicWorld>,
	input: InterestInput,
	options: { captcha?: "pass" | "fail"; kv?: ReturnType<typeof fakeKv> } = {},
) => {
	const told: Told = { alerts: [], ids: 0 };
	const round = (rounds.get(world) ?? 0) + 1;

	rounds.set(world, round);

	const answer = await answerOfRun(
		submitInterest({
			input,
			ip: "203.0.113.7",
			now: () => new Date("2026-09-19T12:00:00.000Z"),
			newId: () => `id-${round}-${++told.ids}`,
		}).pipe(
			Effect.provide(
				Context.make(MusicDb, world.db).pipe(
					Context.add(RateLimit, options.kv ?? world.kv),
					Context.add(Turnstile, {
						verify: () =>
							options.captcha === "fail"
								? Effect.fail(new TurnstileFailed())
								: Effect.void,
					}),
					Context.add(OwnerAlert, {
						send: (incident: OwnerIncident) =>
							Effect.sync(() => {
								told.alerts.push(incident);
							}),
					}),
				),
			),
		),
	);

	return { answer, told };
};

const requests = (world: ReturnType<typeof musicWorld>) =>
	world.sql
		.prepare("SELECT id,kind,status FROM owner_requests ORDER BY id")
		.all();

describe("a listener's interest", () => {
	it("updates the standing interest and keeps each request independent", async () => {
		const world = musicWorld();

		await send(world, said);
		world.counts.clear();
		await send(world, { ...said, merchandise: ["hoodies"] });

		const rows = world.sql
			.prepare("SELECT email, merchandise FROM music_interest")
			.all();

		expect(rows).toEqual([
			{ email: "fan@example.com", merchandise: '["hoodies"]' },
		]);
		expect(requests(world).map((row) => row.kind)).toEqual([
			"purchase",
			"merchandise",
			"purchase",
			"merchandise",
		]);
		expect(
			world.sql
				.prepare("SELECT count(*) AS total FROM owner_request_audit")
				.get(),
		).toEqual({ total: 4 });
	});

	it("names each owner request with an id the flow was given, one per request, in order", async () => {
		const world = musicWorld();

		await send(world, said);
		expect(requests(world)).toEqual([
			{ id: "music-id-1-1", kind: "purchase", status: "new" },
			{ id: "music-id-1-2", kind: "merchandise", status: "new" },
		]);
	});

	it("stores a repeated merchandise choice once, in the standing interest and the owner request", async () => {
		const world = musicWorld();

		await send(world, {
			...said,
			merchandise: ["shirts", "hoodies", "shirts"],
		});

		expect(
			world.sql.prepare("SELECT merchandise FROM music_interest").get(),
		).toEqual({ merchandise: '["shirts","hoodies"]' });
		expect(
			JSON.parse(
				String(
					world.sql
						.prepare(
							"SELECT details_json FROM owner_requests WHERE kind='merchandise'",
						)
						.get()?.details_json,
				),
			).merchandise,
		).toEqual(["shirts", "hoodies"]);
	});
});

describe("the limits and the captcha", () => {
	it("refuse a second submission from the same address in the window", async () => {
		const world = musicWorld();

		await send(world, said);

		expect((await send(world, said)).answer).toEqual(
			refuse(
				"TooManyInterests",
				"Please wait a few minutes before sending another request.",
			),
		);
	});

	it("refuse an address that has made ten attempts, before asking the captcha", async () => {
		const world = musicWorld();

		world.counts.set("rl:music-interest-attempt:203.0.113.7", "10");

		const { answer } = await send(world, said, { captcha: "fail" });

		expect(answer).toMatchObject({ kind: "refuse", type: "TooManyInterests" });
	});

	it("does not use up the allowance of an address that failed the captcha", async () => {
		const world = musicWorld();

		const { answer } = await send(world, said, { captcha: "fail" });

		expect(answer).toEqual(
			refuse("VerificationExpired", "Verification expired. Please try again."),
		);
		expect(world.counts.has(COUNTER)).toBe(false);
		expect(requests(world)).toEqual([]);
	});
});

describe("a storage failure", () => {
	const failing = (): MusicWorldOptions => ({
		beforeStatement: [
			/INSERT INTO music_interest/,
			() => {
				throw new Error("d1 down: secret");
			},
		],
	});

	it("gives the allowance back, tells the owner without the visitor's details, and fails by name", async () => {
		const world = musicWorld(failing());
		const { answer, told } = await send(world, said);

		expect(answer).toEqual(refuseWith("MusicStoreFailed", {}));
		expect(world.counts.has(COUNTER)).toBe(false);
		expect(told.alerts).toEqual([
			{
				category: "request-storage",
				route: "/api/music-interest",
				// The two owner request ids were taken first, then the alert's.
				requestId: "id-1-3",
				code: "d1-write-failed",
				occurredAt: "2026-09-19T12:00:00.000Z",
			},
		]);
	});

	it("tells the owner even when giving the allowance back fails", async () => {
		const world = musicWorld(failing());

		const kv = fakeKv({
			get: async (key: string) => world.counts.get(key) ?? null,
			put: async (key: string, value: string) => {
				world.counts.set(key, value);
			},
			delete: async () => {
				throw new Error("kv down");
			},
		});

		const { answer, told } = await send(world, said, { kv });

		expect(answer).toEqual(refuseWith("MusicStoreFailed", {}));
		expect(told.alerts).toHaveLength(1);
		expect(world.counts.has(COUNTER)).toBe(true);
	});

	it("leaves no half-stored interest when a later statement of the batch fails", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO owner_request_audit/,
				() => {
					throw new Error("d1 down");
				},
			],
		});

		await send(world, said);
		expect(
			world.sql.prepare("SELECT count(*) AS n FROM music_interest").get(),
		).toEqual({ n: 0 });
	});
});
