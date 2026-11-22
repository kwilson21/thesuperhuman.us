import * as Context from "effect/Context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { partial } from "../helpers/doubles";
import {
	deliverInvitation,
	deliverUpdateNotice,
	queueProjectInvitation,
	queueProjectUpdateNotice,
} from "../../src/server/flows/audio-project-notices";
import { MusicDb, liveStudioNoticeMail } from "../../src/server/services";
import { endedWith, seedProject } from "../helpers/audio-project-world";
import { musicWorld } from "../helpers/music-world";
import { stubResend } from "../helpers/resend-fetch";

// The studio notices as stories: the project's invitation and an update's email are queued, claimed, sent and settled with the
// real flows against the real schema, and the real mail service against the stand-in for Resend.

type World = ReturnType<typeof musicWorld>;

const ENV = partial<Env>({
	RESEND_API_KEY: "test",
	CONTACT_FROM_EMAIL: "studio@example.com",
});

const NOW = new Date("2026-11-13T12:00:00.000Z");
const now = () => NOW;

const services = (world: World) =>
	Context.merge(Context.make(MusicDb, world.db), liveStudioNoticeMail(ENV));

const invite = (world: World) =>
	endedWith(deliverInvitation({ requestId: "song-1", now }), services(world));

const notice = (world: World, updateId = 1) =>
	endedWith(deliverUpdateNotice({ updateId, now }), services(world));

const requeueInvitation = (world: World, confirmedNotSent = false, at = NOW) =>
	endedWith(
		queueProjectInvitation({
			requestId: "song-1",
			confirmedNotSent,
			now: () => at,
		}),
		Context.make(MusicDb, world.db),
	);

const requeueNotice = (world: World, confirmedNotSent = false, at = NOW) =>
	endedWith(
		queueProjectUpdateNotice({
			requestId: "song-1",
			updateId: 1,
			confirmedNotSent,
			now: () => at,
		}),
		Context.make(MusicDb, world.db),
	);

const invitation = (world: World) =>
	world.sql
		.prepare(
			"SELECT invitation_status,invitation_sent_at IS NOT NULL AS delivered FROM audio_projects WHERE request_id='song-1'",
		)
		.get();

const update = (world: World) =>
	world.sql
		.prepare("SELECT notification_status FROM audio_project_updates WHERE id=1")
		.get();

const seeded = (world: World) => {
	seedProject(world, "in_progress");
	world.sql
		.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
      VALUES ('song-1','progress','Mixing.','owner@example.com',?)`)
		.run(NOW.toISOString());
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the project's invitation", () => {
	it("sends one email, with the invitation's wording, and records success", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend();

		await Promise.all([invite(world), invite(world)]);

		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			authorization: "Bearer test",
			from: "studio@example.com",
			to: ["artist@example.com"],
			subject: "Your private studio project",
		});
		expect(emails[0]?.text).toContain("Your song has a private studio.");
		expect(emails[0]?.text).not.toContain("You have a new studio update.");
		expect(invitation(world)).toEqual({
			invitation_status: "sent",
			delivered: 1,
		});
		expect(await requeueInvitation(world)).toEqual({
			refused: "NoticeNotQueueable",
		});
	});

	it("keeps a refused invitation as failed, for an explicit retry", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend({ resend: [{ status: 422 }] });

		await invite(world);
		expect(invitation(world)).toMatchObject({ invitation_status: "failed" });
		expect(await requeueInvitation(world)).toEqual({ done: undefined });
		await invite(world);
		expect(emails).toHaveLength(2);
	});

	it("leaves an invitation whose answer is uncertain at sending, and needs the owner's check before a retry", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend({ resend: [{ status: 500 }] });
		const later = new Date(NOW.getTime() + 61_000);

		await invite(world);
		expect(invitation(world)).toMatchObject({ invitation_status: "sending" });
		expect(await requeueInvitation(world, false, later)).toEqual({
			refused: "NoticeNotQueueable",
		});
		expect(
			await requeueInvitation(world, true, new Date(NOW.getTime() + 30_000)),
		).toEqual({ refused: "NoticeNotQueueable" });
		expect(await requeueInvitation(world, true, later)).toEqual({
			done: undefined,
		});
		await invite(world);
		expect(emails).toHaveLength(2);
	});

	it("does not invite a withdrawn request or a revoked project", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend();

		world.sql.exec("UPDATE owner_requests SET status='withdrawn'");
		await invite(world);
		expect(await requeueInvitation(world)).toEqual({
			refused: "NoticeNotQueueable",
		});
		expect(emails).toHaveLength(0);
		expect(invitation(world)).toMatchObject({ invitation_status: "pending" });

		const other = musicWorld();
		seeded(other);
		other.sql.exec(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:00:00.000Z'",
		);
		await invite(other);
		expect(emails).toHaveLength(0);
	});

	it("sends nothing when access closes after the claim, and leaves the invitation sending", async () => {
		const world = musicWorld({
			beforeStatement: [
				/SELECT r\.email,r\.kind,r\.status,p\.revoked_at FROM owner_requests r/,
				() => {
					world.sql.exec(
						"UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'",
					);
				},
			],
		});

		seeded(world);
		const emails = stubResend();

		await invite(world);
		expect(emails).toHaveLength(0);
		expect(invitation(world)).toMatchObject({ invitation_status: "sending" });
	});
});

describe("an update's email", () => {
	it("is sent once with the update wording and records success, and a sent one cannot be retried", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend();

		await Promise.all([notice(world), notice(world)]);

		expect(emails).toHaveLength(1);
		expect(emails[0]?.subject).toBe("Your studio project has an update");
		expect(update(world)).toEqual({ notification_status: "sent" });
		expect(await requeueNotice(world)).toEqual({
			refused: "NoticeNotQueueable",
		});
	});

	it("keeps the saved update when the email is refused, and lets only a failed delivery retry", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend({ resend: [{ status: 422 }] });

		await notice(world);
		expect(update(world)).toEqual({ notification_status: "failed" });
		expect(await requeueNotice(world)).toEqual({ done: undefined });
		await notice(world);
		expect(emails).toHaveLength(2);
		expect(update(world)).toEqual({ notification_status: "sent" });
	});

	it("needs the owner's check before a stale unconfirmed delivery is retried", async () => {
		const world = musicWorld();
		seeded(world);
		stubResend({ resend: [{ status: 500 }] });
		const later = new Date(NOW.getTime() + 61_000);

		await notice(world);
		expect(update(world)).toEqual({ notification_status: "sending" });
		expect(await requeueNotice(world, false, later)).toEqual({
			refused: "NoticeNotQueueable",
		});
		expect(await requeueNotice(world, true, later)).toEqual({
			done: undefined,
		});
	});

	it("marks a closed project's update failed without an email, because its claim has no access condition", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend();
		world.sql.exec(
			"UPDATE audio_projects SET revoked_at='2026-11-13T11:30:00.000Z'",
		);

		await notice(world);
		expect(emails).toHaveLength(0);
		expect(update(world)).toEqual({ notification_status: "failed" });
		expect(await requeueNotice(world)).toEqual({
			refused: "NoticeNotQueueable",
		});
	});

	it("is not sent when the mail service has no key on this deployment, and ends failed", async () => {
		const world = musicWorld();
		seeded(world);
		const emails = stubResend();

		await endedWith(
			deliverUpdateNotice({ updateId: 1, now }),
			Context.merge(
				Context.make(MusicDb, world.db),
				liveStudioNoticeMail(partial<Env>({})),
			),
		);
		expect(emails).toHaveLength(0);
		expect(update(world)).toEqual({ notification_status: "failed" });
	});
});
