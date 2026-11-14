import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/** Public transport only. Audience review happens before constructing this envelope. */
export interface Story {
	headline: string;
	summary: string;
	technicalDetail: string | null;
	delivery: "proposed" | "implemented" | "tested" | "available";
	basis: "agent-reported" | "repository-verified" | "human-confirmed";
}

interface PublicationBase {
	version: 1;
	projectId: string;
	eventId: string;
	entryId: string;
	expectedRevision: number;
	origin: "work" | "shutdown" | "backfill";
	occurredOn: string;
	threadId: string | null;
	milestoneId: string | null;
}

export type Publication = PublicationBase &
	(
		| { operation: "publish" | "correct"; story: Story }
		| { operation: "withdraw"; story: null }
	);

/**
 * What the journal guarantees (src/server/flows/publication-commit.ts): deduplication, expectedRevision comparison, history,
 * current-view changes and the receipt are one atomic per-project operation: the read, the decision and the guarded write
 * agree on the revision, and a write that finds the revision taken reads and decides again (src/server/flows/publication-commit.ts).
 * Event IDs are opaque source-outcome identities shared by backfill and live work.
 * Duplicate IDs with different payloads are conflicts, never successful retries.
 * Withdrawals tombstone entryId and erase served content; replay cannot restore it.
 * Backfill records history without changing current state; timestamps never order writes.
 * The receiver assigns receipt time/revision; the caller cannot claim acceptance. A receipt is that assignment.
 */
export interface Receipt {
	projectId: string;
	eventId: string;
	revision: number;
	publishedAt: string;
}

const id = Schema.String.check(
	Schema.makeFilter((value: string) =>
		/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value),
	),
);

/** Text that is not blank, within the limit, and holds no control character except tab, line feed and carriage return. */
const text = (limit: number) =>
	Schema.String.check(
		Schema.makeFilter(
			(value: string) =>
				value.trim().length > 0 &&
				value.length <= limit &&
				!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
		),
	);

const revision = Schema.Number.check(
	Schema.makeFilter(
		(value: number) => Number.isSafeInteger(value) && value >= 0,
	),
);

/** A real calendar day, written YYYY-MM-DD. */
const day = Schema.String.check(
	Schema.makeFilter((value: string) => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const parsed = new Date(value + "T00:00:00.000Z");

		return (
			Number.isFinite(parsed.getTime()) &&
			parsed.toISOString().slice(0, 10) === value
		);
	}),
);

const story = Schema.Struct({
	headline: text(140),
	summary: text(1000),
	technicalDetail: Schema.NullOr(text(4000)),
	delivery: Schema.Literals(["proposed", "implemented", "tested", "available"]),
	basis: Schema.Literals([
		"agent-reported",
		"repository-verified",
		"human-confirmed",
	]),
});

const base = {
	version: Schema.Literal(1),
	projectId: id,
	eventId: id,
	entryId: id,
	expectedRevision: revision,
	origin: Schema.Literals(["work", "shutdown", "backfill"]),
	occurredOn: day,
	threadId: Schema.NullOr(id),
	milestoneId: Schema.NullOr(id),
};

/** The version-1 envelope, exactly: every member present, none extra, a story for publish and correct and none for withdraw. */
const publication = Schema.Union([
	Schema.Struct({
		...base,
		operation: Schema.Literals(["publish", "correct"]),
		story,
	}),
	Schema.Struct({
		...base,
		operation: Schema.Literal("withdraw"),
		story: Schema.Null,
	}),
]);

/**
 * Strict shape validation, NOT content sanitization or publication permission. The Effect Schema reader of the envelope:
 * the value, as a copy detached from the caller (so later mutations cannot change a prepared delivery), or null.
 */
export function parsePublication(value: unknown): Publication | null {
	const read = Schema.decodeUnknownResult(publication)(value, {
		onExcessProperty: "error",
	});

	if (!Result.isSuccess(read)) return null;

	// SAFETY: the Schema accepted exactly this shape (every member of the envelope, and of the story when there is one, and no other), so a copy of the input, which keeps the order its members arrived in (the stored payload is canonical and the feed shows it in that order), has the type the Schema decodes to.
	return JSON.parse(JSON.stringify(value)) as Publication;
}
