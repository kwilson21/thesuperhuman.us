import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { Publication } from "../../src/lib/publication/contract";
import { commit } from "../../src/server/flows/publication-commit";
import { readFeed } from "../../src/server/flows/publication-feed";
import { answerOfRun } from "../helpers/rule-answers";
import {
	publicationWorld,
	type PublicationWorld,
} from "../helpers/publication-world";

// The commit and feed flows as stories on the real schema: a project's journal over time, retries, writers that get there
// first, and a database that fails. Nothing is mocked; the database is SQLite running the migrations.

const base: Publication = {
	version: 1,
	projectId: "threadline",
	eventId: "one",
	entryId: "first",
	expectedRevision: 0,
	operation: "publish",
	origin: "work",
	occurredOn: "2026-09-05",
	threadId: null,
	milestoneId: null,
	story: {
		headline: "Return to work with context",
		summary: "A clearer view of the work underway.",
		technicalDetail: null,
		delivery: "implemented",
		basis: "repository-verified",
	},
};

const withdrawal = (
	over: Partial<Omit<Publication, "operation" | "story">> = {},
): Publication => ({
	...base,
	operation: "withdraw",
	story: null,
	...over,
});

const deliver = (world: PublicationWorld, publication: Publication) =>
	answerOfRun(commit(publication).pipe(Effect.provideContext(world.services)));

const feed = (world: PublicationWorld, project = "threadline") =>
	Effect.runPromise(
		readFeed(project).pipe(Effect.provideContext(world.services)),
	);

const status = async (world: PublicationWorld, publication: Publication) => {
	const answer = await deliver(world, publication);

	return answer.kind === "done" ? answer.value.status : answer.type;
};

describe("a project's journal", () => {
	it("keeps old backfill out of current focus and clears withdrawn current work", async () => {
		const world = publicationWorld();

		expect(await feed(world)).toEqual({
			projectId: "threadline",
			revision: 0,
			current: null,
			history: [],
		});
		await deliver(world, base);
		await deliver(world, {
			...base,
			entryId: "past",
			eventId: "past",
			origin: "backfill",
			occurredOn: "2026-09-01",
			expectedRevision: 1,
		});
		const shown = await feed(world);

		expect(shown.current?.entryId).toBe("first");
		expect(shown.history.map((e) => e.entryId)).toEqual(["first", "past"]);
		expect(shown.history[1].backfilled).toBe(true);
		await deliver(
			world,
			withdrawal({ eventId: "remove", expectedRevision: 2 }),
		);
		expect((await feed(world)).current).toBeNull();
		expect((await feed(world)).history.map((e) => e.entryId)).toEqual(["past"]);
	});

	it("applies corrections without moving focus, and a backfill correction never changes current", async () => {
		const world = publicationWorld();

		await deliver(world, base);
		await deliver(world, {
			...base,
			entryId: "next",
			eventId: "next",
			expectedRevision: 1,
		});
		await deliver(world, {
			...base,
			operation: "correct",
			eventId: "fix",
			expectedRevision: 2,
			occurredOn: "2026-10-01",
		});
		expect((await feed(world)).current?.entryId).toBe("next");
		const history = (await feed(world)).history;

		expect(history.map((e) => e.entryId)).toEqual(["next", "first"]);
		expect(history.find((e) => e.entryId === "first")?.occurredOn).toBe(
			"2026-09-05",
		);
		await deliver(world, {
			...base,
			entryId: "next",
			operation: "correct",
			eventId: "historical-fix",
			origin: "backfill",
			expectedRevision: 3,
			story: { ...base.story!, headline: "Historical correction" },
		});
		expect((await feed(world)).current?.story.headline).toBe(
			base.story?.headline,
		);
		expect((await feed(world, "other")).history).toEqual([]);
	});

	it("returns the same receipt for a reordered exact retry, and a conflict for changed content", async () => {
		const world = publicationWorld();
		const first = await deliver(world, base);

		// SAFETY: reversing the entries of base keeps each property with its value, so it still has the Publication shape; only the key order changes, which the journal ignores (it canonicalizes by sorting keys) and this test checks.
		const reordered = Object.fromEntries(
			Object.entries(base).reverse(),
		) as Publication;

		const again = await deliver(world, reordered);

		expect(first).toMatchObject({
			kind: "done",
			value: { status: "accepted" },
		});
		expect(again).toMatchObject({
			kind: "done",
			value: { status: "duplicate" },
		});
		expect(again.kind === "done" && again.value.receipt).toEqual(
			first.kind === "done" && first.value.receipt,
		);
		expect(await status(world, { ...base, occurredOn: "2026-09-04" })).toBe(
			"PublicationConflict",
		);
	});

	it("redacts every revision of a withdrawn entry and never restores it", async () => {
		const world = publicationWorld();

		await deliver(world, base);
		const remove = withdrawal({ eventId: "remove", expectedRevision: 1 });

		expect(await status(world, remove)).toBe("accepted");
		expect(await status(world, remove)).toBe("duplicate");
		expect(await status(world, base)).toBe("PublicationWithdrawn");
		expect(
			await status(world, {
				...base,
				eventId: "backfill",
				origin: "backfill",
				expectedRevision: 2,
			}),
		).toBe("PublicationWithdrawn");
		expect(
			world.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM publication_events WHERE payload IS NOT NULL",
				)
				.get(),
		).toEqual({ n: 0 });
	});

	it("tombstones an unseen entry, and refuses a correction with no target", async () => {
		const world = publicationWorld();

		expect(await status(world, { ...base, operation: "correct" })).toBe(
			"PublicationConflict",
		);
		expect(await status(world, withdrawal())).toBe("accepted");
		expect(
			await status(world, { ...base, eventId: "later", expectedRevision: 1 }),
		).toBe("PublicationWithdrawn");
	});

	it("rejects an expectedRevision that leaves no next revision before it reads anything", async () => {
		const world = publicationWorld();

		expect(
			await status(world, {
				...base,
				expectedRevision: Number.MAX_SAFE_INTEGER,
			}),
		).toBe("PublicationRejected");
		expect(world.batches).toEqual([]);
	});
});

describe("writers that get there first", () => {
	it("a writer who takes the revision first makes this delivery a conflict, after one more read", async () => {
		const world = publicationWorld();

		world.before(/INSERT INTO publication_events/, async () => {
			await deliver(world, {
				...base,
				eventId: "rival",
				entryId: "rival-entry",
			});
		});
		expect(await status(world, base)).toBe("PublicationConflict");
		expect(
			world.sql.prepare("SELECT COUNT(*) AS n FROM publication_events").get(),
		).toEqual({ n: 1 });
		// two reads (one before the rival, one after) and the rival's own two batches, and one failed insert
		expect(
			world.batches.filter((b) => b.some((q) => /SELECT operation/.test(q))),
		).toHaveLength(3);
	});

	it("the same event delivered at once is stored once and answered as a duplicate", async () => {
		const world = publicationWorld();

		world.before(/INSERT INTO publication_events/, async () => {
			await deliver(world, base);
		});
		expect(await status(world, base)).toBe("duplicate");
		expect(
			world.sql.prepare("SELECT COUNT(*) AS n FROM publication_events").get(),
		).toEqual({ n: 1 });
	});

	it("a correction loses to a withdrawal of its entry", async () => {
		const world = publicationWorld();

		await deliver(world, base);
		world.before(/INSERT INTO publication_events/, async () => {
			await deliver(
				world,
				withdrawal({ eventId: "rival", expectedRevision: 1 }),
			);
		});
		expect(
			await status(world, {
				...base,
				operation: "correct",
				eventId: "fix",
				expectedRevision: 1,
			}),
		).toBe("PublicationWithdrawn");
	});

	it("a second rival while it reads again still ends as a conflict, never a store failure", async () => {
		const world = publicationWorld();
		let rivals = 0;

		const rival = () => {
			rivals += 1;
			world.before(/INSERT INTO publication_events/, async () => {
				await deliver(world, {
					...base,
					eventId: `rival-${rivals}`,
					entryId: `rival-entry-${rivals}`,
					expectedRevision: rivals - 1,
				});

				if (rivals < 3) rival();
			});
		};

		rival();
		// The rule judges each try on fresh facts: after the first rival the revision has moved, so the second try is a conflict.
		expect(await status(world, base)).toBe("PublicationConflict");
	});
});

describe("a failing database", () => {
	it("a failed write is a named failure that carries no text, and stores nothing", async () => {
		const world = publicationWorld();

		world.failing(/INSERT INTO publication_events/);
		const answer = await deliver(world, base);

		expect(answer).toEqual({
			kind: "refuse",
			type: "PublicationStoreFailed",
			facts: {},
		});
		expect(JSON.stringify(answer)).not.toContain("private");
		world.failing(null);
		expect(await status(world, base)).toBe("accepted");
	});

	it("a failed read of the facts is the same named failure", async () => {
		const world = publicationWorld();

		world.failing(/SELECT operation/);
		expect(await status(world, base)).toBe("PublicationStoreFailed");
	});

	it("a stored story that is not a publication makes the feed refuse", async () => {
		const world = publicationWorld();

		await deliver(world, base);
		world.sql.exec("UPDATE publication_events SET payload='not json'");
		await expect(feed(world)).rejects.toThrow();
	});
});
