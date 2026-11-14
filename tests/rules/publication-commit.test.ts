import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { Publication } from "../../src/lib/publication/contract";
import {
	admitPublication,
	commitPublication,
	requestOf,
	type CommitFacts,
} from "../../src/server/rules/publication-commit";
import { answerOf, nothingToDo, refuse, write } from "../helpers/rule-answers";

// The commit rule as a table: every combination of what is stored (the latest revision, the event under this id, the
// operations of the entry) and what is delivered (publish, correct or withdraw, at some expected revision).

const publication = (over: Partial<Publication> = {}): Publication => ({
	version: 1,
	projectId: "threadline",
	eventId: "evt",
	entryId: "entry",
	expectedRevision: 2,
	operation: "publish",
	origin: "work",
	occurredOn: "2026-11-12",
	threadId: null,
	milestoneId: null,
	story: {
		headline: "h",
		summary: "s",
		technicalDetail: null,
		delivery: "available",
		basis: "repository-verified",
	},
	...over,
});

const none: CommitFacts = {
	latestRevision: 2,
	sameEvent: null,
	entryOperations: [],
};

const decide = (p: Publication, facts: CommitFacts, hash = "h1") =>
	answerOf(commitPublication.decide(requestOf(p, hash), facts));

const stored = (hash = "h1") => ({
	revision: 1,
	publishedAt: "t",
	payloadHash: hash,
});

describe("what a delivery does to the journal", () => {
	it("stores a publish of a new entry at the next revision", () => {
		expect(decide(publication(), none)).toMatchObject(
			write({
				revision: 3,
				inserts: true,
				erasesEntry: false,
				operation: "publish",
			}),
		);
	});

	it("stores a correction of an entry that has events, and a withdrawal that also erases", () => {
		const facts = { ...none, entryOperations: ["publish"] };

		expect(decide(publication({ operation: "correct" }), facts)).toMatchObject(
			write({ revision: 3, inserts: true, erasesEntry: false }),
		);
		expect(
			decide(publication({ operation: "withdraw", story: null }), facts),
		).toMatchObject(write({ revision: 3, inserts: true, erasesEntry: true }));
	});

	it("tombstones an entry that has no events", () => {
		expect(
			decide(publication({ operation: "withdraw", story: null }), none),
		).toMatchObject(write({ erasesEntry: true }));
	});

	it("refuses with a conflict: a stale or future revision, a new publish of a known entry, a correction of an unknown one", () => {
		expect(decide(publication({ expectedRevision: 1 }), none)).toEqual(
			refuse("PublicationConflict", "conflict"),
		);
		expect(decide(publication({ expectedRevision: 5 }), none)).toEqual(
			refuse("PublicationConflict", "conflict"),
		);
		expect(
			decide(publication(), { ...none, entryOperations: ["publish"] }),
		).toEqual(refuse("PublicationConflict", "conflict"));
		expect(decide(publication({ operation: "correct" }), none)).toEqual(
			refuse("PublicationConflict", "conflict"),
		);
	});

	it("refuses every event for a withdrawn entry as withdrawn, even a stale one", () => {
		const facts = { ...none, entryOperations: ["publish", "withdraw"] };

		for (const operation of ["publish", "correct"] as const)
			expect(decide(publication({ operation }), facts)).toEqual(
				refuse("PublicationWithdrawn", "withdrawn"),
			);
		expect(
			decide(publication({ operation: "withdraw", story: null }), facts),
		).toEqual(refuse("PublicationWithdrawn", "withdrawn"));
		expect(decide(publication({ expectedRevision: 0 }), facts)).toEqual(
			refuse("PublicationWithdrawn", "withdrawn"),
		);
	});

	it("an event id used for other content is a conflict, before anything else is judged", () => {
		const facts = {
			...none,
			sameEvent: stored("other"),
			entryOperations: ["withdraw"],
		};

		expect(decide(publication(), facts)).toEqual(
			refuse("PublicationConflict", "conflict"),
		);
	});

	it("the same publish or correction again is nothing to do; after a withdrawal it is withdrawn", () => {
		const facts = {
			...none,
			sameEvent: stored(),
			entryOperations: ["publish"],
		};

		expect(decide(publication({ expectedRevision: 0 }), facts)).toEqual(
			nothingToDo(),
		);
		expect(
			decide(publication({ expectedRevision: 0 }), {
				...facts,
				entryOperations: ["publish", "withdraw"],
			}),
		).toEqual(refuse("PublicationWithdrawn", "withdrawn"));
	});

	it("the same withdrawal again writes only the erasure, whatever the revision now is", () => {
		const facts = {
			latestRevision: 9,
			sameEvent: stored(),
			entryOperations: ["publish", "withdraw"],
		};

		expect(
			decide(
				publication({
					operation: "withdraw",
					story: null,
					expectedRevision: 0,
				}),
				facts,
			),
		).toMatchObject(write({ inserts: false, erasesEntry: true }));
	});

	it("refuses an expectedRevision with no revision after it, before any fact is read", () => {
		const refusal = Effect.runSync(
			Effect.flip(
				admitPublication.decide(
					publication({ expectedRevision: Number.MAX_SAFE_INTEGER }),
					{},
				),
			),
		);

		expect(refusal._tag).toBe("PublicationRejected");
	});
});
