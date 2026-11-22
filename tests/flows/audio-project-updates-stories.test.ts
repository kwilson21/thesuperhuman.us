import * as Context from "effect/Context";
import { describe, expect, it } from "vitest";
import {
	retryProjectUpdateEmail,
	saveProjectUpdate,
} from "../../src/server/flows/audio-project-updates";
import type { SavedUpdateCommand } from "../../src/server/audio-project-input";
import { MusicDb } from "../../src/server/services";
import {
	AT,
	backgroundWorld,
	endedWith,
	OWNER,
	seedFile,
	seedProject,
} from "../helpers/audio-project-world";
import { musicWorld } from "../helpers/music-world";

// The owner's updates as stories, with the real flows against the real schema: the project moves from accepted work to a complete
// delivery, each action refuses what it must, a write that lost a race refuses without a trace, and the client's email is
// started in the background once an update is saved.

type World = ReturnType<typeof musicWorld>;

const save = (
	world: World,
	command: SavedUpdateCommand,
	at = AT,
	background = backgroundWorld(),
) => ({
	background,
	ended: endedWith(
		saveProjectUpdate({
			requestId: "song-1",
			ownerEmail: OWNER,
			command,
			now: () => at,
		}),
		Context.merge(Context.make(MusicDb, world.db), background.services),
	),
});

const after = (ms: number) => new Date(AT.getTime() + ms);

const stage = (world: World) =>
	world.sql.prepare("SELECT stage FROM audio_projects").get();

const kinds = (world: World) =>
	world.sql.prepare("SELECT kind FROM audio_project_updates ORDER BY id").all();

const audits = (world: World) =>
	world.sql.prepare("SELECT action FROM audio_project_audit ORDER BY id").all();

describe("an update's walk through a project", () => {
	it("accepts a reviewed project, starts paid work and moves the date later with its reason", async () => {
		const world = musicWorld();
		seedProject(world, "files_under_review", { booking: "open" });

		// A date in the past, and a note over the limit, are refused before anything is written.
		expect(
			await save(world, {
				action: "accept",
				dueDate: "2020-01-01",
				body: "Hi.",
			}).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		const accepted = save(world, {
			action: "accept",
			dueDate: "2026-12-01",
			body: "I have your song.",
		});

		expect(await accepted.ended).toMatchObject({
			done: {
				kind: "accepted",
				new_due_at: "2026-12-01",
				notification_status: "pending",
			},
		});
		expect(accepted.background.defers).toEqual([1]);

		// Booking not paid: no work yet.
		expect(
			await save(
				world,
				{ action: "start_work", body: "Listening." },
				after(1000),
			).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		world.sql.exec("UPDATE audio_payments SET booking_status='paid'");
		expect(
			await save(
				world,
				{ action: "start_work", body: "Listening." },
				after(1000),
			).ended,
		).toMatchObject({ done: { kind: "work_started" } });

		expect(
			await save(
				world,
				{
					action: "revise_date",
					dueDate: "2026-12-04",
					reason: "client_clarification",
					body: "I need the vocal file.",
				},
				after(2000),
			).ended,
		).toMatchObject({
			done: {
				kind: "date_changed",
				reason: "client_clarification",
				previous_due_at: "2026-12-01",
				new_due_at: "2026-12-04",
			},
		});
		// An earlier date than the current one is refused.
		expect(
			await save(
				world,
				{
					action: "revise_date",
					dueDate: "2026-12-02",
					reason: "protect_song",
					body: "Sooner.",
				},
				after(3000),
			).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		expect(kinds(world)).toEqual([
			{ kind: "accepted" },
			{ kind: "work_started" },
			{ kind: "date_changed" },
		]);
		expect(audits(world)).toEqual([
			{ action: "created" },
			{ action: "accepted" },
			{ action: "stage-changed" },
			{ action: "date-changed" },
		]);
		expect(
			world.sql
				.prepare(
					"SELECT stage,original_due_at,current_due_at FROM audio_projects",
				)
				.get(),
		).toEqual({
			stage: "in_progress",
			original_due_at: "2026-12-01",
			current_due_at: "2026-12-04",
		});
	});

	it("takes a progress note except before acceptance and after completion", async () => {
		const world = musicWorld();
		seedProject(world, "files_under_review");

		expect(
			await save(world, { action: "progress", body: "Note." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		world.sql.exec("UPDATE audio_projects SET stage='in_progress'");
		expect(
			await save(world, { action: "progress", body: "Note." }).ended,
		).toMatchObject({
			done: { kind: "progress", milestone: null },
		});

		world.sql.exec("UPDATE audio_projects SET stage='complete'");
		expect(
			await save(world, { action: "progress", body: "Note." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });
	});

	it("moves an agreed review into revision, and completes only a paid, published final", async () => {
		const world = musicWorld();
		seedProject(world, "review_ready", { balance: "open" });

		// No published review yet.
		expect(
			await save(world, { action: "begin_revision", body: "Revising." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		seedFile(world, "r1", {
			status: "published",
			published_at: AT.toISOString(),
		});
		expect(
			await save(world, { action: "begin_revision", body: "Revising." }).ended,
		).toMatchObject({
			done: { kind: "progress", milestone: "revision_started" },
		});
		expect(stage(world)).toEqual({ stage: "revision_in_progress" });

		world.sql.exec("UPDATE audio_projects SET stage='final_files_ready'");
		expect(
			await save(world, { action: "complete", body: "Done." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		world.sql.exec("UPDATE audio_payments SET balance_status='paid'");
		seedFile(world, "f1", {
			version: "final",
			status: "published",
			published_at: AT.toISOString(),
			expires_at: "2027-11-13T12:00:00.000Z",
		});
		expect(
			await save(world, { action: "complete", body: "Done." }).ended,
		).toMatchObject({ done: { milestone: "completed" } });
		expect(stage(world)).toEqual({ stage: "complete" });
		expect(audits(world).at(-1)).toEqual({ action: "completed" });
	});

	it("takes a revision on a request the owner marked resolved, but not a withdrawn one", async () => {
		const world = musicWorld();
		seedProject(world, "final_files_ready", { balance: "paid" });
		seedFile(world, "f1", {
			version: "final",
			status: "published",
			published_at: AT.toISOString(),
			expires_at: "2027-11-13T12:00:00.000Z",
		});

		world.sql.exec("UPDATE owner_requests SET status='withdrawn'");
		expect(
			await save(world, { action: "complete", body: "Done." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		world.sql.exec("UPDATE owner_requests SET status='resolved'");
		expect(
			await save(world, { action: "complete", body: "Done." }).ended,
		).toMatchObject({ done: { milestone: "completed" } });
	});

	it("refuses a closed project, a blank owner and a note that is not text, writing nothing", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		world.sql.exec(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:00:00.000Z'",
		);

		expect(
			await save(world, { action: "progress", body: "Note." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });

		const open = musicWorld();
		seedProject(open, "in_progress");

		expect(
			await endedWith(
				saveProjectUpdate({
					requestId: "song-1",
					ownerEmail: "  ",
					command: { action: "progress", body: "Note." },
					now: () => AT,
				}),
				Context.merge(
					Context.make(MusicDb, open.db),
					backgroundWorld().services,
				),
			),
		).toEqual({ refused: "ProjectCannotTakeUpdate" });
		expect(kinds(open)).toEqual([]);
	});

	it("records only one acceptance when another write changed the project after the read", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_projects SET stage='accepted'/,
				() => {
					world.sql.exec(
						"UPDATE audio_projects SET updated_at='2026-11-13T11:59:59.000Z'",
					);
				},
			],
		});

		seedProject(world, "files_under_review");

		expect(
			await save(world, {
				action: "accept",
				dueDate: "2026-12-01",
				body: "I have your song.",
			}).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });
		expect(kinds(world)).toEqual([]);
		expect(audits(world)).toEqual([{ action: "created" }]);
		expect(stage(world)).toEqual({ stage: "files_under_review" });
	});

	it("refuses a begin-revision whose review was revoked just before the stage write", async () => {
		const world = musicWorld({
			beforeStatement: [
				/UPDATE audio_projects SET stage='revision_in_progress'/,
				() => {
					world.sql.exec("UPDATE audio_project_files SET status='revoked'");
				},
			],
		});

		seedProject(world, "review_ready");
		seedFile(world, "r1", {
			status: "published",
			published_at: AT.toISOString(),
		});

		expect(
			await save(world, { action: "begin_revision", body: "Revising." }).ended,
		).toEqual({ refused: "ProjectCannotTakeUpdate" });
		expect(stage(world)).toEqual({ stage: "review_ready" });
	});
});

describe("retrying an update's email", () => {
	it("queues a failed one and starts its delivery, and refuses one that was sent", async () => {
		const world = musicWorld();
		seedProject(world, "in_progress");
		world.sql
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,notification_status)
        VALUES ('song-1','progress','Mixing.',?,?,'failed')`)
			.run(OWNER, AT.toISOString());
		const background = backgroundWorld();

		const retry = () =>
			endedWith(
				retryProjectUpdateEmail({
					requestId: "song-1",
					updateId: 1,
					confirmedNotSent: false,
					now: () => AT,
				}),
				Context.merge(Context.make(MusicDb, world.db), background.services),
			);

		expect(await retry()).toEqual({ done: undefined });
		expect(background.mails).toHaveLength(1);
		expect(
			world.sql
				.prepare("SELECT notification_status FROM audio_project_updates")
				.get(),
		).toEqual({ notification_status: "sent" });
		expect(await retry()).toEqual({ refused: "NoticeNotQueueable" });
	});
});
