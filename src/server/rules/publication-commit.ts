// The commit rule: what a delivered publication envelope does to a project's journal. It decides from facts read in ONE
// batch (the project's latest revision, the event stored under this event id, and the operations stored for this entry),
// and answers what to store, nothing to do (the same event again: the stored receipt stands), or a named refusal.
// Time and the receipt's time are not inputs: the database stamps `published_at` and the flow reads it back.
//
// The guard that re-checks it at write time is the table's `UNIQUE (project_id, revision)` and its primary key
// `(project_id, event_id)` (migrations/publication/0001_publication_journal.sql). Every accepted write takes the NEXT
// revision (`expectedRevision + 1`, and the rule only writes when `expectedRevision` is the latest), so two writers that
// read the same latest revision both aim at the same revision and the constraint lets one of them in: that single index
// is the compare-and-set for every fact the rule read (the event id, the entry's events, a withdrawal). The loser reads
// again and decides on the new facts (src/server/guarded-save.ts).
//
// Still written by a database trigger: `publication_outbox_withdraw` (migrations/publication/0002_publication_outbox.sql)
// clears the queued text of the entry in the private outbox when a withdrawal is inserted (issue #242).
import * as Data from "effect/Data";
import { canonicalPublication } from "../../lib/publication/canonical";
import type { Publication } from "../../lib/publication/contract";
import { alwaysWrites, rule, term, unless } from "../terms";

/** The envelope's expectedRevision leaves no room for a next revision: no revision can follow the largest safe integer. */
export class PublicationRejected extends Data.TaggedError(
	"PublicationRejected",
) {
	readonly say = "rejected";
}

/** The delivery disagrees with what is stored: a stale revision, an event id used for other content, an entry that is new or not. */
export class PublicationConflict extends Data.TaggedError(
	"PublicationConflict",
) {
	readonly say = "conflict";
}

/** The entry was withdrawn: a withdrawal blocks every later event for it, and replay cannot restore it. */
export class PublicationWithdrawn extends Data.TaggedError(
	"PublicationWithdrawn",
) {
	readonly say = "withdrawn";
}

/** What the commit needs from the envelope: the envelope, its canonical text and the SHA-256 of that text. */
export type CommitRequest = {
	readonly publication: Publication;
	readonly payload: string;
	readonly payloadHash: string;
};

/** The event stored under an event id: where it sits, when it was stored, and the hash of its content. */
export type StoredEvent = {
	readonly revision: number;
	readonly publishedAt: string;
	readonly payloadHash: string;
};

/** What a commit reads, in one batch. */
export type CommitFacts = {
	/** The project's latest revision; null when it has no event, which the rule reads as 0. */
	readonly latestRevision: number | null;
	/** The event stored for this project and event id, or null. */
	readonly sameEvent: StoredEvent | null;
	/** The operation of every event stored for this entry. */
	readonly entryOperations: readonly string[];
};

/** The row to insert. */
export type CommitWrite = {
	readonly projectId: string;
	readonly eventId: string;
	readonly entryId: string;
	readonly revision: number;
	readonly operation: Publication["operation"];
	readonly origin: Publication["origin"];
	readonly payloadHash: string;
	readonly payload: string;
	/** False for a retried withdrawal, whose event is already stored: only the erasure is written again. */
	readonly inserts: boolean;
	/** A withdrawal erases the content of every event of the entry, its own included; the hashes stay. */
	readonly erasesEntry: boolean;
};

/** The request as the flow builds it: the envelope with its canonical text. `hash` is the SHA-256 of `canonicalPublication`. */
export const requestOf = (
	publication: Publication,
	payloadHash: string,
): CommitRequest => ({
	publication,
	payload: canonicalPublication(publication),
	payloadHash,
});

/** Before anything is read: the revision after the envelope's must exist. */
export const admitPublication = alwaysWrites({
	name: "Admit a publication envelope",
	given: (publication: Publication, _facts: Record<string, never>) =>
		publication,
	refusals: [
		unless(
			term(
				"expectedRevision is below the largest safe integer",
				(p: Publication) => p.expectedRevision < Number.MAX_SAFE_INTEGER,
			),
			() => new PublicationRejected(),
		),
	],
	writes: (p) => p,
	writesText: "the envelope, unchanged",
});

type Given = {
	readonly p: Publication;
	readonly request: CommitRequest;
	readonly facts: CommitFacts;
	readonly sameContent: boolean;
	readonly withdrawn: boolean;
	readonly hasEvents: boolean;
	/** This very withdrawal is stored already. */
	readonly repeatsWithdrawal: boolean;
};

const given = (request: CommitRequest, facts: CommitFacts): Given => ({
	p: request.publication,
	request,
	facts,
	sameContent: facts.sameEvent?.payloadHash === request.payloadHash,
	withdrawn: facts.entryOperations.includes("withdraw"),
	hasEvents: facts.entryOperations.length > 0,
	repeatsWithdrawal:
		facts.sameEvent !== null &&
		facts.sameEvent.payloadHash === request.payloadHash &&
		request.publication.operation === "withdraw",
});

export const commitPublication = rule({
	name: "Commit a publication envelope to the journal",
	given,
	// The same publish or correction again: its stored receipt stands, unless the entry was withdrawn since (a withdrawn
	// entry is gone, even to a retry of the event that published it). A retried withdrawal is not "nothing to do": it
	// writes the erasure again, which changes no stored value but is what the journal has always done for it.
	nothingToDoIf: term(
		"this event is already stored with this content, it is not a withdrawal, and the entry is not withdrawn",
		(g: Given) =>
			g.facts.sameEvent !== null &&
			g.sameContent &&
			g.p.operation !== "withdraw" &&
			!g.withdrawn,
	),
	refusals: [
		unless(
			term(
				"no event is stored under this event id with other content",
				(g: Given) => g.facts.sameEvent === null || g.sameContent,
			),
			() => new PublicationConflict(),
		),
		unless(
			term(
				"the entry is not withdrawn (a retried withdrawal is the one event that may find it so)",
				(g: Given) => !g.withdrawn || g.repeatsWithdrawal,
			),
			() => new PublicationWithdrawn(),
		),
		unless(
			term(
				"expectedRevision is the project's latest revision, or the withdrawal is already stored",
				(g: Given) =>
					g.repeatsWithdrawal ||
					g.p.expectedRevision === (g.facts.latestRevision ?? 0),
			),
			() => new PublicationConflict(),
		),
		unless(
			term(
				"a withdrawal, a publish of a new entry, or a correction of an entry that has events",
				(g: Given) =>
					g.p.operation === "withdraw" ||
					(g.p.operation === "publish" && !g.hasEvents) ||
					(g.p.operation === "correct" && g.hasEvents),
			),
			() => new PublicationConflict(),
		),
	],
	writes: (g): CommitWrite => ({
		projectId: g.p.projectId,
		eventId: g.p.eventId,
		entryId: g.p.entryId,
		revision: g.p.expectedRevision + 1,
		operation: g.p.operation,
		origin: g.p.origin,
		payloadHash: g.request.payloadHash,
		payload: g.request.payload,
		inserts: !g.repeatsWithdrawal,
		erasesEntry: g.p.operation === "withdraw",
	}),
	writesText:
		"the event at the next revision (unless this withdrawal is stored already), and for a withdrawal the erased content of the entry",
});
