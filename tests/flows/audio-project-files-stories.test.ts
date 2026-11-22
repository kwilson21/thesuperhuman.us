import * as Context from "effect/Context";
import { describe, expect, it } from "vitest";
import {
	publishProjectFile,
	revokeProjectFile,
} from "../../src/server/flows/audio-project-files";
import {
	AT,
	backgroundWorld,
	endedWith,
	memoryBucket,
	OWNER,
	seedFile,
	seedProject,
	worldServices,
} from "../helpers/audio-project-world";
import { musicWorld } from "../helpers/music-world";

// The owner's publish and revoke of a project file as stories, with the real flows against the real schema, the project and
// its files seeded by plain inserts, and another request's write put between a read and a write where a story needs one.

let ids = 0;
const newId = () => `id-${(ids += 1)}`;
const now = () => AT;

const publish = (
	world: ReturnType<typeof musicWorld>,
	bucket: R2Bucket,
	fileId: string,
	over: { ownerEmail?: string; downloadable?: boolean } = {},
) => {
	const background = backgroundWorld();

	return {
		background,
		ended: endedWith(
			publishProjectFile({
				requestId: "song-1",
				fileId,
				ownerEmail: over.ownerEmail ?? OWNER,
				note: "Here is the mix.",
				downloadable: over.downloadable ?? false,
				now,
				newId,
			}),
			Context.merge(worldServices(world, bucket), background.services),
		),
	};
};

const revoke = (
	world: ReturnType<typeof musicWorld>,
	fileId: string,
	note: string,
) => {
	const background = backgroundWorld();

	return {
		background,
		ended: endedWith(
			revokeProjectFile({
				requestId: "song-1",
				fileId,
				ownerEmail: OWNER,
				note,
				now,
				newId,
			}),
			Context.merge(
				worldServices(world, memoryBucket().bucket),
				background.services,
			),
		),
	};
};

const status = (world: ReturnType<typeof musicWorld>, id: string) =>
	world.sql
		.prepare("SELECT status FROM audio_project_files WHERE id=?")
		.get(id);

const stage = (world: ReturnType<typeof musicWorld>) =>
	world.sql
		.prepare("SELECT stage FROM audio_projects WHERE request_id='song-1'")
		.get();

describe("publishing a file", () => {
	it("publishes an uploaded review, moves the stage, writes the client's update and starts its notice", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedFile(world, "r1");
		const objects = memoryBucket();
		objects.objects.set("studio/projects/song-1/r1.mp3", 5);

		const run = publish(world, objects.bucket, "r1");
		const result = await run.ended;

		expect(result).toMatchObject({ done: expect.any(Number) });
		expect(status(world, "r1")).toEqual({ status: "published" });
		expect(stage(world)).toEqual({ stage: "review_ready" });
		expect(
			world.sql
				.prepare(
					"SELECT body,notification_status,file_id FROM audio_project_updates",
				)
				.all(),
		).toEqual([
			{
				body: "Here is the mix.",
				notification_status: "pending",
				file_id: "r1",
			},
		]);
		expect(run.background.delivered).toEqual([
			"done" in result ? result.done : -1,
		]);
	});

	it("refuses a blank owner before reading anything, an object that is missing or the wrong size, and a project that cannot take it", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		seedFile(world, "r1");
		const objects = memoryBucket();
		let heads = 0;

		const counting = memoryBucket({
			head: async () => {
				heads += 1;

				return null;
			},
		});

		expect(
			await publish(world, counting.bucket, "r1", { ownerEmail: "  " }).ended,
		).toEqual({ refused: "FileNotPublishable" });
		expect(heads).toBe(0);

		expect(await publish(world, counting.bucket, "r1").ended).toEqual({
			refused: "FileNotPublishable",
		});
		expect(heads).toBe(1);

		objects.objects.set("studio/projects/song-1/r1.mp3", 6);
		expect(await publish(world, objects.bucket, "r1").ended).toEqual({
			refused: "FileNotPublishable",
		});

		objects.objects.set("studio/projects/song-1/r1.mp3", 5);
		world.sql.exec("UPDATE audio_payments SET booking_status='open'");
		expect(await publish(world, objects.bucket, "r1").ended).toEqual({
			refused: "FileNotPublishable",
		});
		expect(status(world, "r1")).toEqual({ status: "uploaded" });
	});

	it("needs the balance paid for a final, and a final replaces the live review", async () => {
		const world = musicWorld();
		seedProject(world, "review_ready");
		seedFile(world, "r1", {
			status: "published",
			published_at: AT.toISOString(),
		});
		seedFile(world, "f1", {
			version: "final",
			media_type: "audio/wav",
			object_key: "studio/projects/song-1/f1.wav",
		});
		const objects = memoryBucket();
		objects.objects.set("studio/projects/song-1/f1.wav", 5);

		expect(await publish(world, objects.bucket, "f1").ended).toEqual({
			refused: "FileNotPublishable",
		});

		world.sql.exec("UPDATE audio_payments SET balance_status='paid'");
		expect(await publish(world, objects.bucket, "f1").ended).toMatchObject({
			done: expect.any(Number),
		});
		expect(status(world, "r1")).toEqual({ status: "revoked" });
		expect(stage(world)).toEqual({ stage: "final_files_ready" });
		expect(
			world.sql
				.prepare("SELECT downloadable FROM audio_project_files WHERE id='f1'")
				.get(),
		).toEqual({ downloadable: 1 });
	});

	it("replaces a review published between its read and its write, by reading again", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_project_files SET status='published'/,
				() => {
					world.sql.exec(
						"UPDATE audio_project_files SET status='published',published_at='2026-11-13T11:59:00.000Z' WHERE id='r2'",
					);
				},
			],
		});

		seedProject(world, "in_progress");
		seedFile(world, "r1");
		seedFile(world, "r2");
		const objects = memoryBucket();
		objects.objects.set("studio/projects/song-1/r1.mp3", 5);

		const result = await publish(world, objects.bucket, "r1").ended;

		expect(result).toMatchObject({ done: expect.any(Number) });
		expect(
			world.sql
				.prepare("SELECT id,status FROM audio_project_files ORDER BY id")
				.all(),
		).toEqual([
			{ id: "r1", status: "published" },
			{ id: "r2", status: "revoked" },
		]);
	});
});

describe("revoking a file", () => {
	it("revokes a published review at once, resets the stage and writes the client's update once", async () => {
		const world = musicWorld();
		seedProject(world, "review_ready");
		seedFile(world, "r1", {
			status: "published",
			published_at: AT.toISOString(),
		});

		expect(await revoke(world, "r1", "").ended).toEqual({
			refused: "FileNotRevocable",
		});

		const run = revoke(world, "r1", "I need to replace this review.");
		expect(await run.ended).toEqual({ done: undefined });
		expect(
			world.sql
				.prepare(
					"SELECT status,revoked_by FROM audio_project_files WHERE id='r1'",
				)
				.get(),
		).toEqual({ status: "revoked", revoked_by: OWNER });
		expect(stage(world)).toEqual({ stage: "in_progress" });
		expect(
			world.sql
				.prepare("SELECT body,notification_status FROM audio_project_updates")
				.all(),
		).toEqual([
			{
				body: "I need to replace this review.",
				notification_status: "pending",
			},
		]);
		expect(run.background.delivered).toHaveLength(1);

		expect(await revoke(world, "r1", "Again").ended).toEqual({
			refused: "FileNotRevocable",
		});
	});

	it("reopens a completed project when its only final is revoked", async () => {
		const world = musicWorld();
		seedProject(world, "complete");
		seedFile(world, "f1", {
			version: "final",
			status: "published",
			published_at: AT.toISOString(),
			expires_at: "2027-11-13T12:00:00.000Z",
		});
		world.sql.exec(
			"UPDATE audio_projects SET completed_at='2026-11-13T12:00:00.000Z'",
		);

		expect(
			await revoke(world, "f1", "A corrected final is coming.").ended,
		).toEqual({
			done: undefined,
		});
		expect(
			world.sql.prepare("SELECT stage,completed_at FROM audio_projects").get(),
		).toEqual({ stage: "in_progress", completed_at: null });
		expect(
			world.sql
				.prepare(
					"SELECT action,actor FROM audio_project_audit ORDER BY id DESC LIMIT 1",
				)
				.get(),
		).toEqual({ action: "stage-changed", actor: OWNER });
	});

	it("keeps the stage when another published file of the version is left", async () => {
		const world = musicWorld();
		seedProject(world, "final_files_ready");

		for (const id of ["f1", "f2"])
			seedFile(world, id, {
				version: "final",
				status: "published",
				published_at: AT.toISOString(),
				expires_at: "2027-11-13T12:00:00.000Z",
			});

		expect(await revoke(world, "f1", "Take one is withdrawn.").ended).toEqual({
			done: undefined,
		});
		expect(stage(world)).toEqual({ stage: "final_files_ready" });
	});

	it("resets the stage when two finals are revoked at once, by deciding again on what the other left", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_project_files SET status='revoked',revoked_at=\?,revoked_by/,
				() => {
					world.sql.exec(
						"UPDATE audio_project_files SET status='revoked',revoked_at='2026-11-13T11:59:00.000Z' WHERE id='f2'",
					);
				},
			],
		});

		seedProject(world, "final_files_ready");

		for (const id of ["f1", "f2"])
			seedFile(world, id, {
				version: "final",
				status: "published",
				published_at: AT.toISOString(),
				expires_at: "2027-11-13T12:00:00.000Z",
			});

		expect(await revoke(world, "f1", "Both are withdrawn.").ended).toEqual({
			done: undefined,
		});
		expect(stage(world)).toEqual({ stage: "in_progress" });
	});

	it("refuses a draft's revoke when a publish landed in between, and leaves the published file alone", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_project_files SET status='revoked',revoked_at=\?,revoked_by/,
				() => {
					world.sql.exec(
						"UPDATE audio_project_files SET status='published',published_at='2026-11-13T11:59:00.000Z' WHERE id='r1'",
					);
					world.sql.exec("UPDATE audio_projects SET stage='review_ready'");
				},
			],
		});

		seedProject(world, "in_progress");
		seedFile(world, "r1");

		expect(await revoke(world, "r1", "A note on a draft.").ended).toEqual({
			refused: "FileNotRevocable",
		});
		expect(status(world, "r1")).toEqual({ status: "published" });
		expect(stage(world)).toEqual({ stage: "review_ready" });
	});

	it("revokes a draft although the stage moves under every try, because no reset was decided from it", async () => {
		const stages = ["review_ready", "revision_in_progress", "in_progress"];
		let moves = 0;

		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_project_files SET status='revoked',revoked_at=\?,revoked_by/,
				() => {
					world.sql.exec(
						`UPDATE audio_projects SET stage='${stages[moves % stages.length]}'`,
					);
					moves += 1;
				},
			],
		});

		seedProject(world, "in_progress");
		seedFile(world, "r1");

		expect(await revoke(world, "r1", "").ended).toEqual({ done: undefined });
		expect(moves).toBeGreaterThan(0);
		expect(status(world, "r1")).toEqual({ status: "revoked" });
	});

	it("refuses a revoke in a closed project", async () => {
		const world = musicWorld();
		seedProject(world, "review_ready");
		seedFile(world, "r1", {
			status: "published",
			published_at: AT.toISOString(),
		});
		world.sql.exec(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:00:00.000Z'",
		);

		expect(await revoke(world, "r1", "Too late.").ended).toEqual({
			refused: "FileNotRevocable",
		});
		expect(status(world, "r1")).toEqual({ status: "published" });
	});
});
