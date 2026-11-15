import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type IntakeInput, validateIntake } from "../../src/lib/audio-intake";
import type { OwnerIncident } from "../../src/lib/owner-alerts";
import { submitIntake } from "../../src/server/flows/audio-intake";
import {
	Background,
	MusicDb,
	OwnerAlert,
	OwnerAlertFailed,
	OwnerNotice,
	OwnerNoticeFailed,
	ProjectInvitation,
	ProjectInvitationFailed,
	RateLimit,
	TurnstileCheck,
} from "../../src/server/services";
import { fakeKv } from "../helpers/doubles";
import { musicWorld } from "../helpers/music-world";

// The audio intake flow as stories: a visitor sends a request, is counted, fails the captcha, or meets a storage failure. Each
// story runs the real flow against the real schema; the captcha, the alert, the notices and the background are doubles, so a
// story can say what they answered and see what was sent and when.

const checked = validateIntake({
	service: "vocal-mix",
	title: "My song",
	direction: "judgment",
	preferences: {},
	name: "Artist",
	email: "artist@example.com",
	permission: true,
	turnstileToken: "token",
	fileLink: "https://drive.google.com/example",
});

if (!checked.ok) throw new Error("the story's request must be valid");

const said: IntakeInput = checked.value;

const ATTEMPTS = "rl:audio-attempt:203.0.113.7";
const REQUESTS = "rl:audio:203.0.113.7";

type Told = {
	alerts: OwnerIncident[];
	notices: string[];
	invitations: string[];
	/** What the flow handed to the background, in order, and how many times it did. */
	deferred: number[];
	asked: number;
};

type Options = {
	captcha?: "passed" | "refused" | "unavailable";
	portal?: boolean;
	alertFails?: boolean;
	noticeFails?: boolean;
	invitationFails?: boolean;
	kv?: KVNamespace;
};

const send = async (
	world: ReturnType<typeof musicWorld>,
	options: Options = {},
) => {
	const told: Told = {
		alerts: [],
		notices: [],
		invitations: [],
		deferred: [],
		asked: 0,
	};

	let ids = 0;

	const answer = await Effect.runPromise(
		submitIntake({
			input: said,
			ip: "203.0.113.7",
			portal: options.portal ?? false,
			now: () => new Date("2026-09-19T12:00:00.000Z"),
			newId: () => `id-${++ids}`,
		}).pipe(
			Effect.provideContext(
				Context.make(MusicDb, world.db).pipe(
					Context.add(RateLimit, options.kv ?? world.kv),
					Context.add(TurnstileCheck, {
						check: () =>
							Effect.sync(() => {
								told.asked += 1;

								return options.captcha ?? "passed";
							}),
					}),
					Context.add(OwnerAlert, {
						send: (incident: OwnerIncident) =>
							options.alertFails
								? Effect.fail(new OwnerAlertFailed())
								: Effect.sync(() => {
										told.alerts.push(incident);
									}),
					}),
					Context.add(OwnerNotice, {
						send: ({ requestId }) =>
							options.noticeFails
								? Effect.fail(new OwnerNoticeFailed())
								: Effect.sync(() => {
										told.notices.push(requestId);
									}),
					}),
					Context.add(ProjectInvitation, {
						deliver: (requestId) =>
							options.invitationFails
								? Effect.fail(new ProjectInvitationFailed())
								: Effect.sync(() => {
										told.invitations.push(requestId);
									}),
					}),
					Context.add(Background, {
						schedule: () => Effect.void,
						defer: (work) =>
							Effect.promise(async () => {
								told.deferred.push(work.length);
								await Promise.all(work.map((item) => Effect.runPromise(item)));
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
		.prepare("SELECT id,kind,service_id,status FROM owner_requests")
		.all();

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a visitor's request", () => {
	it("is stored once, answered as sent, and the owner notice goes out in the background", async () => {
		const world = musicWorld();
		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "sent" });
		expect(requests(world)).toHaveLength(1);
		expect(told.notices).toHaveLength(1);
		expect(told.deferred).toEqual([1]);
		expect(told.invitations).toEqual([]);
		expect(told.alerts).toEqual([]);
	});

	it("also invites the visitor into the studio when the client portal is on, in one background hand-off", async () => {
		const world = musicWorld();
		const { answer, told } = await send(world, { portal: true });

		expect(answer).toEqual({ kind: "sent" });
		expect(told.invitations).toEqual(told.notices);
		expect(told.deferred).toEqual([2]);
	});

	it("is still answered as sent when the owner notice and the invitation both fail, and the failures are logged in the route's words", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld();

		const { answer } = await send(world, {
			portal: true,
			noticeFails: true,
			invitationFails: true,
		});

		expect(answer).toEqual({ kind: "sent" });
		expect(requests(world)).toHaveLength(1);
		expect(logged.mock.calls).toEqual([
			["Owner notification email state is uncertain."],
			["Studio invitation email state is uncertain."],
		]);
	});
});

describe("the limits and the captcha", () => {
	it("refuse a second request from the same address in the window", async () => {
		const world = musicWorld();

		await send(world);

		expect((await send(world)).answer).toEqual({ kind: "tooManyRequests" });
		expect(requests(world)).toHaveLength(1);
	});

	it("refuse an address that has made ten attempts, before asking the captcha", async () => {
		const world = musicWorld();

		world.counts.set(ATTEMPTS, "10");

		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "tooManyAttempts" });
		expect(told.asked).toBe(0);
	});

	it("refuse a token the captcha refused, and keep the request allowance for the next try", async () => {
		const world = musicWorld();
		const { answer } = await send(world, { captcha: "refused" });

		expect(answer).toEqual({ kind: "captchaRefused" });
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(requests(world)).toEqual([]);
	});

	it("answer a captcha service that cannot answer as unavailable, not refused", async () => {
		const world = musicWorld();
		const { answer } = await send(world, { captcha: "unavailable" });

		expect(answer).toEqual({ kind: "captchaUnavailable" });
		// The attempt was counted before the captcha was asked and is not given back.
		expect(world.counts.get(ATTEMPTS)).toBe("1");
		expect(requests(world)).toEqual([]);
	});

	it("fail with the store's name when the rate limit store cannot be read", async () => {
		const world = musicWorld();

		const kv = fakeKv({
			get: async () => {
				throw new Error("kv down");
			},
			put: async () => {},
			delete: async () => {},
		});

		const failed = await Effect.runPromise(
			Effect.flip(
				submitIntake({
					input: said,
					ip: "203.0.113.7",
					portal: false,
					now: () => new Date(),
					newId: () => "id",
				}).pipe(
					Effect.provideContext(
						Context.make(MusicDb, world.db).pipe(
							Context.add(RateLimit, kv),
							Context.add(TurnstileCheck, {
								check: () => Effect.succeed("passed" as const),
							}),
							Context.add(OwnerAlert, { send: () => Effect.void }),
							Context.add(OwnerNotice, { send: () => Effect.void }),
							Context.add(ProjectInvitation, { deliver: () => Effect.void }),
							Context.add(Background, {
								schedule: () => Effect.void,
								defer: () => Effect.void,
							}),
						),
					),
				),
			),
		);

		expect(failed._tag).toBe("RateLimitStoreFailed");
		expect(requests(world)).toEqual([]);
	});
});

describe("a storage failure", () => {
	const failing = () =>
		musicWorld({
			beforeStatement: [
				/INSERT INTO owner_requests/,
				() => {
					throw new Error("database unavailable");
				},
			],
		});

	it("tells the visitor nothing was stored, gives the allowance back and alerts the owner once", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = failing();
		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "unstored" });
		expect(requests(world)).toEqual([]);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.notices).toEqual([]);
		expect(told.alerts).toHaveLength(1);
		expect(told.alerts[0]).toMatchObject({
			category: "request-storage",
			route: "/api/audio-intake",
			code: "d1-write-failed",
			requestId: "id-1",
			occurredAt: "2026-09-19T12:00:00.000Z",
		});
		expect(logged).toHaveBeenCalledTimes(1);
	});

	it("still alerts the owner when giving the allowance back fails", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = failing();

		const kv = fakeKv({
			get: async (key: string) => world.counts.get(key) ?? null,
			put: async (key: string, value: string) => {
				world.counts.set(key, value);
			},
			delete: async () => {
				throw new Error("kv down");
			},
		});

		const { answer, told } = await send(world, { kv });

		expect(answer).toEqual({ kind: "unstored" });
		expect(told.alerts).toHaveLength(1);
		expect(logged).toHaveBeenCalledTimes(2);
	});

	it("is answered the same when the owner alert cannot be sent either", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const { answer } = await send(failing(), { alertFails: true });

		expect(answer).toEqual({ kind: "unstored" });
	});
});
