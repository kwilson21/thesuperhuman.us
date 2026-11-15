import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { OwnerRequestStatus } from "../../src/lib/owner-model";
import { ChangedSinceRead } from "../../src/server/guarded-save";
import {
	claimCopy,
	IntakeReadFailed,
	IntakeStoreFailed,
	readCopyFacts,
	recordCopyStatus,
	recordOwnFailure,
	recordUnclaimedFailure,
} from "../../src/server/intake-store";
import type { ClaimWrite } from "../../src/server/rules/brief-copy";
import { MusicDb } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// What the intake store reads and writes for the client's copy of a brief, against the real schema: the read decides
// nothing, and each write compares only that the row is still as it was read (or still carries this attempt).

const DETAILS = JSON.stringify({ path: "webapp", appGoal: "Schedule" });

const seed = (
	world: ReturnType<typeof musicWorld>,
	details: string = DETAILS,
) =>
	world.sql
		.prepare(
			`INSERT INTO owner_requests (id,kind,name,email,summary,details_json,status,created_at,updated_at)
			VALUES ('r1','software','Alex','alex@example.com','Build','${details.replaceAll("'", "''")}','new','2026-11-13T11:00:00.000Z','2026-11-13T11:00:00.000Z')`,
		)
		.run();

const detailsOf = (world: ReturnType<typeof musicWorld>) =>
	JSON.parse(
		String(
			world.sql
				.prepare("SELECT details_json FROM owner_requests WHERE id='r1'")
				.get()?.details_json,
		),
	);

const run = <A, E>(
	world: ReturnType<typeof musicWorld>,
	effect: Effect.Effect<A, E, MusicDb>,
) =>
	Effect.runPromise(
		Effect.result(effect).pipe(Effect.provideService(MusicDb, world.db)),
	);

describe("readCopyFacts", () => {
	it("answers the request and its details text as stored", async () => {
		const world = musicWorld();

		seed(world);
		const result = await run(world, readCopyFacts("r1"));

		expect(result._tag).toBe("Success");

		if (result._tag === "Success") {
			expect(result.success?.request.id).toBe("r1");
			expect(result.success?.request.details).toEqual({
				path: "webapp",
				appGoal: "Schedule",
			});
			expect(result.success?.detailsJson).toBe(DETAILS);
		}
	});

	it("answers null for an id nothing is stored under", async () => {
		const result = await run(musicWorld(), readCopyFacts("nope"));

		expect(result).toMatchObject({ _tag: "Success", success: null });
	});

	it.each(["not json", "[]", "null", '"text"', "7"])(
		"fails to read details that are not a JSON object: %s",
		async (details) => {
			const world = musicWorld();

			seed(world, details);
			const result = await run(world, readCopyFacts("r1"));

			expect(result._tag).toBe("Failure");

			if (result._tag === "Failure")
				expect(result.failure).toBeInstanceOf(IntakeReadFailed);
		},
	);

	it("fails with the database's failure when the read throws", async () => {
		const world = musicWorld({
			beforeStatement: [
				/FROM owner_requests WHERE id=\?/,
				() => {
					throw new Error("d1 down");
				},
			],
		});

		const result = await run(world, readCopyFacts("r1"));

		expect(result).toMatchObject({
			_tag: "Failure",
			failure: { _tag: "IntakeReadFailed" },
		});
	});
});

describe("claimCopy", () => {
	// The write of a claim for the request as it was read: the stored request, and its details text.
	const write = (
		over: {
			status?: OwnerRequestStatus;
			email?: string;
			detailsJson?: string;
		} = {},
	): ClaimWrite => ({
		at: "2026-11-13T12:00:00.000Z",
		request: {
			id: "r1",
			kind: "software",
			releaseId: null,
			serviceId: null,
			campaignId: null,
			name: "Alex",
			email: over.email ?? "alex@example.com",
			cityRegion: "",
			summary: "Build",
			details: JSON.parse(DETAILS),
			status: over.status ?? "new",
			privateNote: "",
			createdAt: "2026-11-13T11:00:00.000Z",
			updatedAt: "2026-11-13T11:00:00.000Z",
			resolvedAt: null,
			contactDeleteAfter: null,
		},
		detailsJson: over.detailsJson ?? DETAILS,
	});

	it("claims a row that is as it was read, and records the attempt", async () => {
		const world = musicWorld();

		seed(world);
		const result = await run(world, claimCopy(write()));

		expect(result._tag).toBe("Success");
		expect(detailsOf(world)).toEqual({
			path: "webapp",
			appGoal: "Schedule",
			clientCopyStatus: "uncertain",
			clientCopyAttemptedAt: "2026-11-13T12:00:00.000Z",
		});
	});

	it.each([
		["the details changed", { detailsJson: '{"path":"idea"}' }],
		["the status changed", { status: "withdrawn" as const }],
		["the address changed", { email: "other@example.com" }],
	])(
		"is a ChangedSinceRead and writes nothing when %s",
		async (_name, change) => {
			const world = musicWorld();

			seed(world);
			const result = await run(world, claimCopy(write(change)));

			expect(result._tag).toBe("Failure");

			if (result._tag === "Failure")
				expect(result.failure).toBeInstanceOf(ChangedSinceRead);

			expect(detailsOf(world)).toEqual(JSON.parse(DETAILS));
		},
	);

	it("is a ChangedSinceRead for a request nothing is stored under", async () => {
		const result = await run(musicWorld(), claimCopy(write()));

		expect(result).toMatchObject({
			_tag: "Failure",
			failure: { _tag: "ChangedSinceRead" },
		});
	});

	it("fails with an IntakeStoreFailed when the write throws", async () => {
		const world = musicWorld({
			beforeStatement: [
				/clientCopyStatus','uncertain'/,
				() => {
					throw new Error("d1 down");
				},
			],
		});

		seed(world);
		const result = await run(world, claimCopy(write()));

		expect(result._tag).toBe("Failure");

		if (result._tag === "Failure")
			expect(result.failure).toBeInstanceOf(IntakeStoreFailed);
	});
});

describe("recording what happened", () => {
	const claimed = JSON.stringify({
		path: "webapp",
		clientCopyStatus: "uncertain",
		clientCopyAttemptedAt: "2026-11-13T12:00:00.000Z",
	});

	it("records the status over this attempt", async () => {
		const world = musicWorld();

		seed(world, claimed);
		await run(
			world,
			recordCopyStatus("r1", "2026-11-13T12:00:00.000Z", "sent"),
		);

		expect(detailsOf(world).clientCopyStatus).toBe("sent");
	});

	it("leaves a row another attempt claimed", async () => {
		const world = musicWorld();

		seed(world, claimed);
		const result = await run(
			world,
			recordCopyStatus("r1", "2026-11-13T11:00:00.000Z", "sent"),
		);

		expect(result._tag).toBe("Success");
		expect(detailsOf(world).clientCopyStatus).toBe("uncertain");
	});

	it("records a failure over this attempt, and leaves another attempt's row", async () => {
		const world = musicWorld();

		seed(world, claimed);
		await run(world, recordOwnFailure("r1", "2026-11-13T11:00:00.000Z"));
		expect(detailsOf(world).clientCopyStatus).toBe("uncertain");
		await run(world, recordOwnFailure("r1", "2026-11-13T12:00:00.000Z"));
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
	});

	it("records a failure over the details as they were read, and not over a changed row", async () => {
		const world = musicWorld();

		seed(world);
		await run(world, recordUnclaimedFailure({ id: "r1", expected: "{}" }));
		expect(detailsOf(world)).toEqual(JSON.parse(DETAILS));
		await run(world, recordUnclaimedFailure({ id: "r1", expected: DETAILS }));
		expect(detailsOf(world).clientCopyStatus).toBe("failed");
	});

	it("fails with an IntakeStoreFailed when a write throws", async () => {
		const world = musicWorld({
			beforeStatement: [
				/clientCopyStatus',\?\)/,
				() => {
					throw new Error("d1 down");
				},
			],
		});

		seed(world, claimed);
		const result = await run(
			world,
			recordCopyStatus("r1", "2026-11-13T12:00:00.000Z", "sent"),
		);

		expect(result._tag).toBe("Failure");

		if (result._tag === "Failure")
			expect(result.failure).toBeInstanceOf(IntakeStoreFailed);
	});
});
