import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import { hashValue } from "../../src/lib/client-portal";
import {
	answerLatestReview,
	markClientMessageReadByOwner,
	markOwnerMessageReadByClient,
	sendClientMessage,
	sendOwnerMessage,
} from "../../src/server/flows/audio-project-messages";
import { MusicDb } from "../../src/server/services";
import { musicWorld } from "../helpers/music-world";

// The message flows as stories: the owner and the client write to one thread, answer a review, and mark each other's messages
// read. Each story runs the real flows against the real schema, with the session and the project seeded by plain inserts.

type World = ReturnType<typeof musicWorld>;

const AT = new Date("2026-11-13T12:00:00.000Z");
const TOKEN = "a".repeat(72);
const OWNER = "owner@example.com";
const CLIENT = "artist@example.com";

/** What a flow ended in, in a story's words: its answer, or the name of the refusal or failure. */
const ended = async <A, E extends { readonly _tag: string }>(
	world: World,
	flow: Effect.Effect<A, E, MusicDb>,
) =>
	Effect.runPromise(
		flow.pipe(
			Effect.map((value) => ({ done: value })),
			Effect.catch((failure) => Effect.succeed({ refused: failure._tag })),
			Effect.provide(Context.make(MusicDb, world.db)),
		),
	);

const seeded = async (world: World, request = "song-1", email = CLIENT) => {
	world.sql
		.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES (?,'service',?,'A song','new',?,?)`)
		.run(request, email, AT.toISOString(), AT.toISOString());
	world.sql
		.prepare(
			`INSERT OR IGNORE INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)`,
		)
		.run(
			await hashValue(TOKEN),
			email,
			AT.toISOString(),
			"2026-12-13T12:00:00.000Z",
			AT.toISOString(),
		);
};

const now =
	(offsetMs = 0) =>
	() =>
		new Date(AT.getTime() + offsetMs);

const send = (world: World, body: RawValue, offsetMs = 0, id = "song-1") =>
	ended(
		world,
		sendClientMessage({ id, token: TOKEN, body, now: now(offsetMs) }),
	);

const publish = (world: World, id: string, at: string) =>
	world.sql
		.prepare(`INSERT INTO audio_project_files
      (id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at)
      VALUES (?,'song-1','review',?,'Mix.wav','audio/wav',10,'published',?,?)`)
		.run(id, `key-${id}`, at, at);

const stage = (world: World, value: string) =>
	world.sql
		.prepare("UPDATE audio_projects SET stage=? WHERE request_id='song-1'")
		.run(value);

const rounds = (world: World, count: number) => {
	for (let i = 0; i < count; i += 1)
		world.sql
			.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone)
        VALUES ('song-1','progress','Revising.',?,?,'revision_started')`)
			.run(OWNER, `2026-11-1${i}T12:00:00.000Z`);
};

const answer = (
	world: World,
	reviewId: string,
	decision: "approved" | "changes" | "stopped",
	body: RawValue = null,
) =>
	ended(
		world,
		answerLatestReview({
			id: "song-1",
			token: TOKEN,
			reviewId,
			decision,
			body,
			now: now(),
		}),
	);

const messages = (world: World) =>
	world.sql
		.prepare(
			"SELECT actor,body,review_decision,read_at FROM audio_project_messages ORDER BY id",
		)
		.all();

describe("a client's and the owner's messages", () => {
	it("keeps both sides in one thread, marks what each reached, and hides the project from another client", async () => {
		const world = musicWorld();
		await seeded(world);
		await seeded(world, "other-song", "other@example.com");

		const first = await send(world, "I updated the Drive link.");

		expect(first).toMatchObject({
			done: { actor: "client", body: "I updated the Drive link." },
		});
		// Another client's project is the hidden 404, never a refusal that names it.
		expect(await send(world, "Not my song.", 0, "other-song")).toEqual({
			refused: "ProjectHidden",
		});

		const reply = await ended(
			world,
			sendOwnerMessage({
				id: "song-1",
				ownerEmail: OWNER,
				body: "Thanks, I have it.",
				now: now(),
			}),
		);

		expect(reply).toMatchObject({ done: { actor: "owner" } });

		await ended(
			world,
			markClientMessageReadByOwner({ id: "song-1", messageId: 1, now: now() }),
		);
		await ended(
			world,
			markOwnerMessageReadByClient({
				id: "song-1",
				token: TOKEN,
				messageId: 2,
				now: now(),
			}),
		);
		// A message the reader did not receive is left alone.
		await ended(
			world,
			markOwnerMessageReadByClient({
				id: "song-1",
				token: TOKEN,
				messageId: 1,
				now: now(),
			}),
		);

		expect(messages(world).map((row) => row.read_at)).toEqual([
			AT.toISOString(),
			AT.toISOString(),
		]);

		world.sql
			.prepare("UPDATE audio_client_sessions SET revoked_at=?")
			.run(AT.toISOString());
		expect(await send(world, "After revocation.")).toEqual({
			refused: "ProjectHidden",
		});
	});

	it("refuses a message the text rules refuse, before any count", async () => {
		const world = musicWorld();
		await seeded(world);

		expect(await send(world, "http://example.com/file")).toEqual({
			refused: "MessageTextInvalid",
		});
		expect(await send(world, "x".repeat(4001))).toEqual({
			refused: "MessageTextInvalid",
		});
		expect(await send(world, 42)).toEqual({ refused: "MessageTextInvalid" });
	});

	it("closes replies when a project completes, its access closes or the request is withdrawn, but not a read", async () => {
		const world = musicWorld();
		await seeded(world);
		await send(world, "Hello");
		stage(world, "complete");

		expect(await send(world, "Late")).toEqual({
			refused: "MessageNotAccepted",
		});
		expect(
			await ended(
				world,
				sendOwnerMessage({
					id: "song-1",
					ownerEmail: OWNER,
					body: "Late",
					now: now(),
				}),
			),
		).toEqual({ refused: "MessageNotAccepted" });

		stage(world, "in_progress");
		world.sql.prepare("UPDATE owner_requests SET status='withdrawn'").run();

		// A withdrawn request is hidden from the client and refused to the owner.
		expect(await send(world, "Withdrawn")).toEqual({
			refused: "ProjectHidden",
		});
		expect(
			await ended(
				world,
				sendOwnerMessage({
					id: "song-1",
					ownerEmail: OWNER,
					body: "Withdrawn",
					now: now(),
				}),
			),
		).toEqual({ refused: "MessageNotAccepted" });
		expect(
			await ended(
				world,
				markClientMessageReadByOwner({
					id: "song-1",
					messageId: 1,
					now: now(),
				}),
			),
		).toEqual({ done: undefined });
		expect(
			await ended(
				world,
				sendOwnerMessage({
					id: "missing",
					ownerEmail: OWNER,
					body: "Hi",
					now: now(),
				}),
			),
		).toEqual({ refused: "ProjectHidden" });
	});

	it("takes one answer per published review and starts over when a new review is shared", async () => {
		const world = musicWorld();
		await seeded(world);
		stage(world, "review_ready");

		// No answer before a review is shared, even at the right stage.
		expect(await answer(world, "review-1", "approved")).toEqual({
			refused: "ReviewNotAnswerable",
		});
		publish(world, "review-1", "2026-11-13T11:00:00.000Z");

		expect(
			await answer(world, "review-1", "changes", "More air in the vocal."),
		).toMatchObject({
			done: { review_decision: "changes", body: "More air in the vocal." },
		});
		expect(await answer(world, "review-1", "approved")).toEqual({
			refused: "ReviewNotAnswerable",
		});

		publish(world, "review-2", "2026-11-13T12:30:00.000Z");
		// The old review is no longer the one that answers.
		expect(await answer(world, "review-1", "approved")).toEqual({
			refused: "ReviewNotAnswerable",
		});
		expect(await answer(world, "review-2", "approved")).toMatchObject({
			done: { review_decision: "approved", body: "I approve this mix." },
		});
	});

	it("allows changes only while revision rounds remain, and stopping only once they are used, and a stop closes the project", async () => {
		const world = musicWorld();
		await seeded(world);
		stage(world, "review_ready");
		publish(world, "review-1", "2026-11-13T11:00:00.000Z");

		expect(await answer(world, "review-1", "stopped")).toEqual({
			refused: "ReviewNotAnswerable",
		});
		expect(await answer(world, "review-1", "changes")).toEqual({
			refused: "ChangesNeedNotes",
		});

		rounds(world, 2);
		expect(await answer(world, "review-1", "changes", "More")).toEqual({
			refused: "ReviewNotAnswerable",
		});
		expect(await answer(world, "review-1", "stopped")).toMatchObject({
			done: {
				review_decision: "stopped",
				body: "I’m stopping the project here.",
			},
		});
		expect(
			world.sql
				.prepare(
					"SELECT revoked_at FROM audio_projects WHERE request_id='song-1'",
				)
				.get(),
		).toEqual({ revoked_at: AT.toISOString() });
		expect(
			world.sql
				.prepare(
					"SELECT action,actor FROM audio_project_audit WHERE action='revoked'",
				)
				.all(),
		).toEqual([{ action: "revoked", actor: "client-stopped" }]);
		expect(await send(world, "After the stop")).toEqual({
			refused: "ProjectHidden",
		});
	});

	it("counts messages in the rolling window: the thirteenth at once is the 429, and one after the window is taken", async () => {
		const world = musicWorld();
		await seeded(world);

		const sends = await Promise.all(
			Array.from({ length: 13 }, (_, index) => send(world, `Note ${index}`)),
		);

		expect(sends.filter((sent) => "done" in sent)).toHaveLength(12);
		expect(sends.filter((sent) => "refused" in sent)).toEqual([
			{ refused: "ClientRateLimited" },
		]);
		expect(await send(world, "Too soon", 31_000)).toEqual({
			refused: "ClientRateLimited",
		});
		expect(await send(world, "Later note", 300_001)).toMatchObject({
			done: { body: "Later note" },
		});
	});

	it("answers 429 before any other refusal after the lookup", async () => {
		const world = musicWorld();
		await seeded(world);

		for (let i = 0; i < 12; i += 1) await send(world, `Note ${i}`);
		stage(world, "complete");

		expect(await send(world, "Late")).toEqual({ refused: "ClientRateLimited" });
	});

	it("refuses the write when the session ends between the lookup and the write", async () => {
		const world = musicWorld();
		await seeded(world);
		world.sql
			.prepare("UPDATE audio_client_sessions SET expires_at=?")
			.run(new Date(AT.getTime() + 1000).toISOString());

		// The lookup reads the clock first (the session is open); the write and the recount read it again, after the end.
		const reads = [0, 2000, 2000];
		const clock = () => new Date(AT.getTime() + (reads.shift() ?? 2000));

		expect(
			await ended(
				world,
				sendClientMessage({
					id: "song-1",
					token: TOKEN,
					body: "Just in time",
					now: clock,
				}),
			),
		).toEqual({ refused: "MessageNotAccepted" });
		expect(messages(world)).toEqual([]);
	});

	it("leaves an owner's message unread when the session expires after lookup", async () => {
		const world = musicWorld();
		await seeded(world);
		await ended(
			world,
			sendOwnerMessage({
				id: "song-1",
				ownerEmail: OWNER,
				body: "Ready for you",
				now: now(),
			}),
		);
		world.sql
			.prepare("UPDATE audio_client_sessions SET expires_at=?")
			.run(new Date(AT.getTime() + 1000).toISOString());
		const reads = [0, 2000];
		await ended(
			world,
			markOwnerMessageReadByClient({
				id: "song-1",
				token: TOKEN,
				messageId: 1,
				now: () => new Date(AT.getTime() + (reads.shift() ?? 2000)),
			}),
		);
		expect(messages(world)[0]?.read_at).toBeNull();
	});

	it("refuses a review answer when the session ends between the lookup and the write", async () => {
		const world = musicWorld();
		await seeded(world);
		stage(world, "review_ready");
		publish(world, "review-1", "2026-11-13T11:00:00.000Z");
		world.sql
			.prepare("UPDATE audio_client_sessions SET expires_at=?")
			.run(new Date(AT.getTime() + 1000).toISOString());

		const reads = [0, 2000, 2000];
		const clock = () => new Date(AT.getTime() + (reads.shift() ?? 2000));

		expect(
			await ended(
				world,
				answerLatestReview({
					id: "song-1",
					token: TOKEN,
					reviewId: "review-1",
					decision: "approved",
					body: null,
					now: clock,
				}),
			),
		).toEqual({ refused: "ReviewNotAnswerable" });
		expect(messages(world)).toEqual([]);
	});

	it("takes the answer that the write's own lookup picks among reviews published at the same time, and refuses the other", async () => {
		const world = musicWorld();
		await seeded(world);
		stage(world, "review_ready");
		publish(world, "review-a", "2026-11-13T11:00:00.000Z");
		publish(world, "review-b", "2026-11-13T11:00:00.000Z");

		const picked = world.sql
			.prepare(
				`SELECT id FROM audio_project_files WHERE request_id='song-1' AND version='review' AND status='published'
          ORDER BY published_at DESC LIMIT 1`,
			)
			.get();

		const chosen = String(picked?.id);
		const other = chosen === "review-a" ? "review-b" : "review-a";

		// The rule lets either tied review be named; the write takes only the one it picks, and a refusal of the other is
		// the same answer as for any review that is not the latest.
		expect(await answer(world, other, "approved")).toEqual({
			refused: "ReviewNotAnswerable",
		});
		expect(await answer(world, chosen, "approved")).toMatchObject({
			done: { review_decision: "approved" },
		});
	});
});
