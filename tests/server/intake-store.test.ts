import * as Effect from "effect/Effect";
import type { NewOwnerRequest } from "../../src/lib/owner-requests";
import { describe, expect, it } from "vitest";
import {
	BriefTooLarge,
	insertRequest,
	IntakeStoreFailed,
	SubmissionIdClash,
} from "../../src/server/intake-store";
import { MusicDb } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// What the intake store answers for each way the insert can end, against the real schema.

const request = (
	submissionId?: string,
	details?: NewOwnerRequest["details"],
): NewOwnerRequest => ({
	kind: "software" as const,
	name: "Alex",
	email: "alex@example.com",
	summary: "A brief",
	submissionId,
	details,
});

const run = (world: ReturnType<typeof musicWorld>, input: NewOwnerRequest) =>
	Effect.runPromise(
		Effect.flip(insertRequest(input)).pipe(
			Effect.provideService(MusicDb, world.db),
		),
	);

describe("insertRequest", () => {
	it("maps a unique violation on the submission id to a SubmissionIdClash", async () => {
		const world = musicWorld();

		await Effect.runPromise(
			insertRequest(request("a")).pipe(
				Effect.provideService(MusicDb, world.db),
			),
		);

		expect(await run(world, request("a"))).toBeInstanceOf(SubmissionIdClash);
	});

	it.each([
		["software", 48_000],
		["service", 16_000],
		["purchase", 16_000],
		["merchandise", 16_000],
	] as const)(
		"refuses %s details over its limit before anything is sent",
		async (kind, limit) => {
			const world = musicWorld();

			const failure = await run(world, {
				...request(undefined, { note: "x".repeat(limit) }),
				kind,
			});

			expect(failure).toBeInstanceOf(BriefTooLarge);
			expect(world.sql.prepare("SELECT id FROM owner_requests").all()).toEqual(
				[],
			);
		},
	);

	it("maps any other refusal to an IntakeStoreFailed", async () => {
		const world = musicWorld({
			beforeStatement: [
				/INSERT INTO owner_requests/,
				() => {
					throw new Error("database unavailable");
				},
			],
		});

		expect(await run(world, request("b"))).toBeInstanceOf(IntakeStoreFailed);
	});
});
