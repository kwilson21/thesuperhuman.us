import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestDetails } from "../../src/lib/owner-model";
import {
	resendBriefCopy,
	sendFirstBriefCopy,
} from "../../src/server/flows/brief-copy";
import {
	ClientCopyMail,
	type ClientCopy,
	type ClientCopyOutcome,
	MusicDb,
} from "../../src/server/services";
import { musicWorld, type MusicWorldOptions } from "../helpers/music-world";

// The client's copy of a brief as stories: the public form sends the first copy, the owner resends it, two senders meet at the
// claim, and the database fails at each step. Each story runs the real flow against the real schema; the mail provider is a
// double that says what it answered and what it was asked to send. A story reads what a flow ended in as `done` (its value)
// or `failed` (the name of the failure, and the failure).

const NOW = new Date("2026-11-13T12:00:00.000Z");

type World = ReturnType<typeof musicWorld>;

const DETAILS: RequestDetails = {
	path: "webapp",
	appGoal: "Schedule rehearsals",
	firstVersion: "A calendar",
};

const seed = (
	world: World,
	details: RequestDetails = DETAILS,
	over: { status?: string; email?: string } = {},
) =>
	world.sql
		.prepare(
			`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
			VALUES ('r1','software','Alex Doe',?,'Build a tool',?,?,'2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')`,
		)
		.run(
			over.email ?? "alex@example.com",
			JSON.stringify(details),
			over.status ?? "new",
		);

const detailsOf = (world: World) =>
	JSON.parse(
		String(
			world.sql
				.prepare("SELECT details_json FROM owner_requests WHERE id='r1'")
				.get()?.details_json,
		),
	);

/** Runs a flow with the world's database and a mail double that answers `outcome`, and says what it ended in. */
const provide = <A, E extends { readonly _tag: string }>(
	world: World,
	sent: ClientCopy[],
	outcome: ClientCopyOutcome,
	program: Effect.Effect<A, E, MusicDb | ClientCopyMail>,
) =>
	Effect.runPromise(
		Effect.match(program, {
			onFailure: (failure) => ({ failed: failure._tag, failure }),
			onSuccess: (value) => ({ done: value }),
		}).pipe(
			Effect.provideContext(
				Context.make(MusicDb, world.db).pipe(
					Context.add(ClientCopyMail, {
						send: (copy) =>
							Effect.sync(() => {
								sent.push(copy);

								return outcome;
							}),
					}),
				),
			),
		),
	);

type Story = { outcome?: ClientCopyOutcome; confirmed?: boolean };

const resend = async (world: World, story: Story = {}) => {
	const sent: ClientCopy[] = [];

	const result = await provide(
		world,
		sent,
		story.outcome ?? "sent",
		resendBriefCopy({
			id: "r1",
			confirmedNotSent: story.confirmed ?? false,
			now: () => NOW,
		}),
	);

	return { result, sent };
};

const first = async (world: World, outcome: ClientCopyOutcome = "sent") => {
	const sent: ClientCopy[] = [];

	const result = await provide(
		world,
		sent,
		outcome,
		sendFirstBriefCopy({ id: "r1", now: () => NOW }),
	);

	return { result, sent };
};

/** A database that fails the statements that match, from the `after`-th match on. */
const throwing = (pattern: RegExp, after = 0): MusicWorldOptions => {
	let seen = 0;

	return {
		beforeStatement: [
			pattern,
			() => {
				if (seen++ >= after) throw new Error("d1 down");
			},
		],
	};
};

/** A stored answer that is an object with a text toString: the brief cannot be turned into a label, so no copy can be built. */
const UNBUILDABLE: RequestDetails = {
	path: "webapp",
	timing: { toString: "x" },
};

const CLAIM = /clientCopyStatus','uncertain'/;

const READ = /FROM owner_requests WHERE id=\?/;

const RECORD = /json_set\(details_json,'\$\.clientCopyStatus',\?\)/;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("the owner's resend", () => {
	it("claims, sends once to the request's address and records what the provider answered", async () => {
		const world = musicWorld();

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({
			done: { outcome: "sent", status: "sent" },
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: "alex@example.com",
			subject: "Your brief: Build a tool",
		});
		expect(detailsOf(world)).toMatchObject({
			clientCopyStatus: "sent",
			clientCopyAttemptedAt: NOW.toISOString(),
		});
	});

	it.each([
		["refused", "failed"],
		["uncertain", "uncertain"],
		["unconfigured", "failed"],
	] as const)("records %s as %s", async (outcome, status) => {
		const world = musicWorld();

		seed(world);
		const { result } = await resend(world, { outcome });

		expect(result).toMatchObject({ done: { outcome, status } });
		expect(detailsOf(world).clientCopyStatus).toBe(status);
	});

	it("does not send a copy that was sent, and says so", async () => {
		const world = musicWorld();

		seed(world, { ...DETAILS, clientCopyStatus: "sent" });
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "BriefCopyNotDue" });
		expect(sent).toEqual([]);
	});

	it("sends a failed copy again once, and a second click is refused", async () => {
		const world = musicWorld();

		seed(world, { ...DETAILS, clientCopyStatus: "failed" });
		expect((await resend(world)).sent).toHaveLength(1);

		const second = await resend(world);

		expect(second.result).toMatchObject({ failed: "BriefCopyNotDue" });
		expect(second.sent).toEqual([]);
	});

	it("holds an uncertain copy until the owner confirms and a minute has passed", async () => {
		const world = musicWorld();

		seed(world, {
			...DETAILS,
			clientCopyStatus: "uncertain",
			clientCopyAttemptedAt: "2026-11-13T11:59:30.000Z",
		});

		expect((await resend(world, { confirmed: true })).result).toMatchObject({
			failed: "BriefCopyNotDue",
		});
		world.sql.exec(
			`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyAttemptedAt','2026-11-13T11:58:00.000Z')`,
		);
		expect((await resend(world)).result).toMatchObject({
			failed: "BriefCopyNotDue",
		});
		expect((await resend(world, { confirmed: true })).sent).toHaveLength(1);
	});

	it("refuses a request that is not there, closed, or with no address", async () => {
		expect((await resend(musicWorld())).result).toMatchObject({
			failed: "NoSuchSoftwareRequest",
		});

		const closed = musicWorld();

		seed(closed, DETAILS, { status: "withdrawn" });
		expect((await resend(closed)).result).toMatchObject({
			failed: "BriefCopyRequestClosed",
		});

		const blank = musicWorld();

		seed(blank, DETAILS, { email: "" });
		expect((await resend(blank)).result).toMatchObject({
			failed: "BriefCopyNoAddress",
		});
	});
});

describe("two senders at the claim", () => {
	it("sends once when another sender claims between the read and the claim, and the loser reads again and is refused", async () => {
		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					world.sql.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','sent','$.clientCopyAttemptedAt','2026-11-13T11:59:59.000Z')`,
					);
				},
			],
		});

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "BriefCopyNotDue" });
		expect(sent).toEqual([]);
		expect(detailsOf(world).clientCopyStatus).toBe("sent");
	});

	it("reads again when the request changes under the claim, and sends to the address it has then", async () => {
		let changes = 0;

		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					if (changes++ === 0)
						world.sql.exec("UPDATE owner_requests SET email='new@example.com'");
				},
			],
		});

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ done: { outcome: "sent" } });
		expect(sent.map((copy) => copy.to)).toEqual(["new@example.com"]);
	});

	it("is refused when the request is closed between the read and the claim", async () => {
		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					world.sql.exec("UPDATE owner_requests SET status='resolved'");
				},
			],
		});

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "BriefCopyRequestClosed" });
		expect(sent).toEqual([]);
	});

	it("gives up after three lost claims and sends nothing", async () => {
		let changes = 0;

		// Each pass, another sender rewrites the details between the read and the claim, so no claim wins.
		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					changes++;
					world.sql.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.note','${changes}')`,
					);
				},
			],
		});

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "SaveKeptChanging" });
		expect(changes).toBe(3);
		expect(sent).toEqual([]);
	});

	it("does not overwrite another sender's claim with its own answer", async () => {
		const world = musicWorld({
			beforeStatement: [
				RECORD,
				() => {
					world.sql.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyAttemptedAt','2026-11-13T12:05:00.000Z')`,
					);
				},
			],
		});

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ done: { outcome: "sent" } });
		expect(sent).toHaveLength(1);
		expect(detailsOf(world)).toMatchObject({
			clientCopyStatus: "uncertain",
			clientCopyAttemptedAt: "2026-11-13T12:05:00.000Z",
		});
	});
});

describe("a failure of the database", () => {
	it("on the read is named and sends nothing, and records nothing", async () => {
		const world = musicWorld(throwing(READ));

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "IntakeReadFailed" });
		expect(sent).toEqual([]);
		expect(detailsOf(world)).toEqual(DETAILS);
	});

	it("on the claim is named, records a failure over a copy with no status, and sends nothing", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(CLAIM));

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "CopyClaimFailed" });
		expect(sent).toEqual([]);
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
		expect(logged.mock.calls).toEqual([["Client brief copy state is failed."]]);
	});

	it("on the claim leaves a status another sender recorded", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(CLAIM));

		seed(world, { ...DETAILS, clientCopyStatus: "failed" });
		const { result } = await resend(world);

		expect(result).toMatchObject({ failed: "CopyClaimFailed" });
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
	});

	it("on the claim and on the record of the failure logs both and still names the claim", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		const world = musicWorld(
			throwing(/clientCopyStatus','(uncertain|failed)'/),
		);

		seed(world);
		const { result } = await resend(world);

		expect(result).toMatchObject({ failed: "CopyClaimFailed" });
		expect(logged.mock.calls).toEqual([
			["Client brief copy failure could not be recorded."],
			["Client brief copy state is failed."],
		]);
		expect(detailsOf(world)).toEqual(DETAILS);
	});

	it("on the record after the provider answered leaves the claim, so the copy is held for the owner", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(RECORD));

		seed(world);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({
			failed: "CopyNotRecorded",
			failure: { status: "uncertain" },
		});
		expect(sent).toHaveLength(1);
		expect(detailsOf(world).clientCopyStatus).toBe("uncertain");
		expect(logged.mock.calls).toEqual([
			["Client brief copy state is uncertain."],
		]);
		expect((await resend(world)).result).toMatchObject({
			failed: "BriefCopyNotDue",
		});
	});

	it("on the record when the provider was never asked records a failure over this attempt", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(RECORD));

		seed(world);
		const { result } = await resend(world, { outcome: "unconfigured" });

		expect(result).toMatchObject({
			failed: "CopyNotRecorded",
			failure: { status: "failed" },
		});
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
		expect(logged.mock.calls).toEqual([["Client brief copy state is failed."]]);
	});

	it("on the record when the provider was never asked and the failure cannot be recorded either logs both", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(/clientCopyStatus',(\?|'failed')\)/));

		seed(world);
		const { result } = await resend(world, { outcome: "unconfigured" });

		expect(result).toMatchObject({
			failed: "CopyNotRecorded",
			failure: { status: "failed" },
		});
		expect(detailsOf(world).clientCopyStatus).toBe("uncertain");
		expect(logged.mock.calls).toEqual([
			["Client brief copy failure could not be recorded."],
			["Client brief copy state is failed."],
		]);
	});

	it("building the copy records a failure over this attempt, asks nothing of the provider and names the failure", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld();

		seed(world, UNBUILDABLE);
		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "CopyNotBuilt" });
		expect(sent).toEqual([]);
		expect(detailsOf(world)).toMatchObject({
			clientCopyStatus: "failed",
			clientCopyAttemptedAt: NOW.toISOString(),
		});
		expect(logged.mock.calls).toEqual([["Client brief copy state is failed."]]);
	});

	it("building the copy and recording its failure both failing logs both", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(/clientCopyStatus','failed'/));

		seed(world, UNBUILDABLE);
		const { result } = await resend(world);

		expect(result).toMatchObject({ failed: "CopyNotBuilt" });
		expect(detailsOf(world).clientCopyStatus).toBe("uncertain");
		expect(logged.mock.calls).toEqual([
			["Client brief copy failure could not be recorded."],
			["Client brief copy state is failed."],
		]);
	});

	it("on a request whose details are not a JSON object is named, and nothing is sent", async () => {
		const world = musicWorld();

		world.sql
			.prepare(
				`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
				VALUES ('r1','software','Alex','alex@example.com','Build','[]','new','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')`,
			)
			.run();

		const { result, sent } = await resend(world);

		expect(result).toMatchObject({ failed: "IntakeReadFailed" });
		expect(sent).toEqual([]);
	});
});

describe("the public form's first copy", () => {
	it.each([
		["sent", "sent"],
		["refused", "failed"],
		["uncertain", "uncertain"],
		["unconfigured", "failed"],
	] as const)(
		"answers the status the recorded answer gives when the provider answers %s",
		async (outcome, status) => {
			const world = musicWorld();

			seed(world);
			expect((await first(world, outcome)).result).toEqual({ done: status });
			expect(detailsOf(world).clientCopyStatus).toBe(status);
		},
	);

	it.each([
		["a copy that has a status", { ...DETAILS, clientCopyStatus: "failed" }],
		["a copy that was sent", { ...DETAILS, clientCopyStatus: "sent" }],
	])("answers null and sends nothing for %s", async (_name, details) => {
		const world = musicWorld();

		seed(world, details);
		const { result, sent } = await first(world);

		expect(result).toEqual({ done: null });
		expect(sent).toEqual([]);
	});

	it("answers null for a request that is withdrawn", async () => {
		const world = musicWorld();

		seed(world, DETAILS, { status: "withdrawn" });
		expect((await first(world)).result).toEqual({ done: null });
	});

	it("answers null when another sender claims it between the read and the claim", async () => {
		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					world.sql.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','uncertain','$.clientCopyAttemptedAt','2026-11-13T11:59:59.000Z')`,
					);
				},
			],
		});

		seed(world);
		const { result, sent } = await first(world);

		expect(result).toEqual({ done: null });
		expect(sent).toEqual([]);
	});

	it("answers null when another sender keeps changing the request under the claim", async () => {
		let changes = 0;

		const world = musicWorld({
			beforeStatement: [
				CLAIM,
				() => {
					changes++;
					world.sql.exec(
						`UPDATE owner_requests SET details_json=json_set(details_json,'$.note','${changes}')`,
					);
				},
			],
		});

		seed(world);
		const { result, sent } = await first(world);

		expect(result).toEqual({ done: null });
		expect(sent).toEqual([]);
	});

	it("answers failed when the claim cannot be written, and uncertain when the answer cannot be recorded", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const claim = musicWorld(throwing(CLAIM));

		seed(claim);
		expect((await first(claim)).result).toEqual({ done: "failed" });

		const record = musicWorld(throwing(RECORD));

		seed(record);
		expect((await first(record)).result).toEqual({ done: "uncertain" });
	});

	it("answers failed and sends nothing when the copy cannot be built", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld();

		seed(world, UNBUILDABLE);
		const { result, sent } = await first(world);

		expect(result).toEqual({ done: "failed" });
		expect(sent).toEqual([]);
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
	});

	it("answers failed when the request cannot be read", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const world = musicWorld(throwing(READ));

		seed(world);
		const { result, sent } = await first(world);

		expect(result).toEqual({ done: "failed" });
		expect(sent).toEqual([]);
		expect(logged.mock.calls).toEqual([["Client brief copy state is failed."]]);
	});
});
