import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnerRequest } from "../../src/lib/owner-model";
import {
	type SoftwareInput,
	validateSoftwareInquiry,
} from "../../src/lib/software-inquiry";
import type { OwnerIncident } from "../../src/lib/owner-alerts";
import { submitInquiry } from "../../src/server/flows/software-inquiry";
import {
	Background,
	BriefCopy,
	BriefCopyFailed,
	MusicDb,
	OwnerAlert,
	RateLimit,
	SoftwareNotice,
	SoftwareNoticeFailed,
	TurnstileCheck,
} from "../../src/server/services";
import { musicWorld, type MusicWorldOptions } from "../helpers/music-world";

// The software inquiry flow as stories: a visitor sends a brief, sends it again, loses a race with another request that used the
// same submission id, or meets a storage failure. Each story runs the real flow against the real schema; the captcha, the
// alert, the client copy, the notice and the background are doubles, so a story can say what they answered and see what was sent.

const ID = "00000000-0000-4000-8000-000000000001";

const body = {
	path: "workflow",
	today: "First line",
	audience: "Our team",
	firstResult: "One place to see next steps.",
	name: "Alex",
	email: "Alex@Example.com",
	company: "Example Studio",
	timing: "flexible",
	timingReason: "",
	budgetStatus: "exploring",
	budgetNote: "",
	approver: "self",
	approverRole: "",
	turnstileToken: "token",
	submissionId: ID,
};

const read = (over: Record<string, string> = {}) => {
	const checked = validateSoftwareInquiry({ ...body, ...over });

	if (!checked.ok) throw new Error("the story's brief must be valid");

	return checked.value;
};

const REQUESTS = "rl:software:203.0.113.7";

type Told = {
	alerts: OwnerIncident[];
	copies: string[];
	notices: string[];
	deferred: number;
};

type Options = {
	input?: SoftwareInput;
	captcha?: "passed" | "refused" | "unavailable";
	alertFails?: boolean;
	copyFails?: boolean;
	noticeFails?: boolean;
};

const send = async (
	world: ReturnType<typeof musicWorld>,
	options: Options = {},
) => {
	const told: Told = { alerts: [], copies: [], notices: [], deferred: 0 };
	let ids = 0;

	const answer = await Effect.runPromise(
		submitInquiry({
			input: options.input ?? read(),
			ip: "203.0.113.7",
			now: () => new Date("2026-09-19T12:00:00.000Z"),
			newId: () => `id-${++ids}`,
		}).pipe(
			Effect.provideContext(
				Context.make(MusicDb, world.db).pipe(
					Context.add(RateLimit, world.kv),
					Context.add(TurnstileCheck, {
						check: () => Effect.succeed(options.captcha ?? "passed"),
					}),
					Context.add(OwnerAlert, {
						send: (incident: OwnerIncident) =>
							Effect.sync(() => {
								told.alerts.push(incident);
							}),
					}),
					Context.add(BriefCopy, {
						deliver: (request: OwnerRequest) =>
							options.copyFails
								? Effect.fail(new BriefCopyFailed({ raised: "down" }))
								: Effect.sync(() => {
										told.copies.push(request.id);

										return "sent";
									}),
					}),
					Context.add(SoftwareNotice, {
						send: ({ requestId }) =>
							options.noticeFails
								? Effect.fail(new SoftwareNoticeFailed())
								: Effect.sync(() => {
										told.notices.push(requestId);
									}),
					}),
					Context.add(Background, {
						schedule: () => Effect.void,
						defer: (work) =>
							Effect.promise(async () => {
								told.deferred += work.length;
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
	world.sql.prepare("SELECT id,email,submission_id FROM owner_requests").all();

const rival = (email: string): MusicWorldOptions => ({
	beforeStatement: [
		/INSERT INTO owner_requests/,
		() =>
			world_exec(
				`INSERT INTO owner_requests(id,kind,name,email,summary,details_json,status,created_at,updated_at,submission_id) VALUES('raced','software','Grace','${email}','We copy rows','{"path":"workflow","clientCopyStatus":"sent"}','new','2026-09-19T11:59:00.000Z','2026-09-19T11:59:00.000Z','${ID}')`,
			),
	],
});

let world_exec: (statement: string) => void = () => {};

/** A world where the insert stores the brief and the database then fails to answer. */
const lostAnswer = () => {
	const made = musicWorld({
		beforeStatement: [
			/INSERT INTO owner_requests/,
			() => {
				const insert = made.sql.prepare(
					`INSERT INTO owner_requests(id,kind,name,email,summary,details_json,status,created_at,updated_at,submission_id) VALUES('stored','software','Alex','alex@example.com','First line','{"path":"workflow"}','new','2026-09-19T11:59:00.000Z','2026-09-19T11:59:00.000Z','${ID}')`,
				);

				insert.run();
				throw new Error("connection lost");
			},
		],
	});

	return made;
};

/** A world whose other request stores the same submission id just before this one's insert. */
const racing = (email: string) => {
	const options = rival(email);
	const made = musicWorld(options);

	world_exec = (statement) => made.sql.exec(statement);

	return made;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a visitor's brief", () => {
	it("is stored once, answered with the stored brief and the copy status, and the owner notice goes out in the background", async () => {
		const world = musicWorld();
		const { answer, told } = await send(world);

		expect(answer).toMatchObject({ kind: "sent", clientCopyStatus: "sent" });
		expect(requests(world)).toEqual([
			{ id: expect.any(String), email: "alex@example.com", submission_id: ID },
		]);
		expect(told.copies).toHaveLength(1);
		expect(told.notices).toHaveLength(1);
		expect(told.deferred).toBe(1);
	});

	it("is still answered as sent when the owner notice fails, and the failure is logged in the route's words", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld();
		const { answer } = await send(world, { noticeFails: true });

		expect(answer).toMatchObject({ kind: "sent" });
		expect(logged.mock.calls).toEqual([
			["Owner notification email state is uncertain."],
		]);
	});

	it("fails with the copy's name when the client copy cannot be delivered, after the brief is stored", async () => {
		const world = musicWorld();

		await expect(send(world, { copyFails: true })).rejects.toBeInstanceOf(
			BriefCopyFailed,
		);
		expect(requests(world)).toHaveLength(1);
	});
});

describe("a brief sent twice", () => {
	it("is answered with the stored brief the second time, is not stored again and is not counted", async () => {
		const world = musicWorld();

		await send(world);
		world.counts.clear();

		const { answer, told } = await send(world);

		expect(answer).toMatchObject({ kind: "alreadyStored" });
		expect(requests(world)).toHaveLength(1);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.copies).toEqual([]);
		expect(told.notices).toEqual([]);
	});

	it("is a clash when the stored brief is from another address", async () => {
		const world = musicWorld();

		await send(world);
		world.counts.clear();

		const { answer } = await send(world, {
			input: read({ email: "other@example.com" }),
		});

		expect(answer).toEqual({ kind: "idTaken" });
		expect(requests(world)).toHaveLength(1);
	});
});

describe("two requests with the same submission id", () => {
	it("answers the loser with the other request's brief, stores nothing of its own and gives its allowance back", async () => {
		const world = racing("alex@example.com");
		const { answer, told } = await send(world);

		expect(answer).toMatchObject({ kind: "alreadyStored" });
		expect(requests(world)).toEqual([
			{ id: "raced", email: "alex@example.com", submission_id: ID },
		]);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.copies).toEqual([]);
		expect(told.notices).toEqual([]);
		expect(told.alerts).toEqual([]);
	});

	it("answers a clash when the other request's brief is from another address, and still gives the allowance back", async () => {
		const world = racing("someone@else.test");
		const { answer } = await send(world);

		expect(answer).toEqual({ kind: "idTaken" });
		expect(world.counts.has(REQUESTS)).toBe(false);
	});
});

describe("the limits and the captcha", () => {
	it("refuse a second brief from the same address in the window", async () => {
		const world = musicWorld();

		await send(world);

		expect(
			(
				await send(world, {
					input: read({ submissionId: "00000000-0000-4000-8000-000000000002" }),
				})
			).answer,
		).toEqual({ kind: "tooManyRequests" });
	});

	it("refuse an address that has made ten attempts, before asking the captcha", async () => {
		const world = musicWorld();

		world.counts.set("rl:software-attempt:203.0.113.7", "10");

		expect((await send(world)).answer).toEqual({ kind: "tooManyAttempts" });
	});

	it("tell a refused token from a captcha that cannot answer", async () => {
		const world = musicWorld();

		expect((await send(world, { captcha: "refused" })).answer).toEqual({
			kind: "captchaRefused",
		});
		expect((await send(world, { captcha: "unavailable" })).answer).toEqual({
			kind: "captchaUnavailable",
		});
		expect(requests(world)).toEqual([]);
	});
});

describe("a storage failure", () => {
	const failing = (statement: RegExp) =>
		musicWorld({
			beforeStatement: [
				statement,
				() => {
					throw new Error("database unavailable");
				},
			],
		});

	it("on the first look-up alerts the owner with the read code, counts nothing and tells the visitor", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const world = failing(/FROM owner_requests WHERE submission_id/);
		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "readFailed" });
		expect(told.alerts).toHaveLength(1);
		expect(told.alerts[0]).toMatchObject({ code: "d1-read-failed" });
		expect(world.counts.has(REQUESTS)).toBe(false);
	});

	it("on the insert gives the allowance back, alerts the owner with the write code and tells the visitor", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const world = failing(/INSERT INTO owner_requests/);
		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "unstored" });
		expect(requests(world)).toEqual([]);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.alerts).toHaveLength(1);
		expect(told.alerts[0]).toMatchObject({
			category: "request-storage",
			route: "/api/software-inquiry",
			code: "d1-write-failed",
		});
		expect(told.copies).toEqual([]);
	});

	it("stops after one insert when the index refuses it but no other brief is found, and takes the lost-brief path", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		let inserts = 0;

		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO owner_requests/,
				() => {
					inserts += 1;
					throw new Error(
						"UNIQUE constraint failed: owner_requests.submission_id",
					);
				},
			],
		});

		const { answer, told } = await send(world);

		expect(answer).toEqual({ kind: "unstored" });
		expect(inserts).toBe(1);
		expect(requests(world)).toEqual([]);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.alerts).toHaveLength(1);
		expect(told.alerts[0]).toMatchObject({ code: "d1-write-failed" });
		expect(logged).toHaveBeenCalledTimes(1);
	});

	it("is answered as stored when the insert's answer was lost but the brief was stored", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});

		const world = lostAnswer();
		const { answer, told } = await send(world);

		expect(answer).toMatchObject({ kind: "alreadyStored" });
		expect(requests(world)).toHaveLength(1);
		expect(world.counts.has(REQUESTS)).toBe(false);
		expect(told.alerts).toEqual([]);
	});
});
