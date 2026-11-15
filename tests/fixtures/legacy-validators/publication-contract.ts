// FROZEN REFERENCE COPY. The hand-written publication envelope validator that src/lib/publication/contract.ts held before
// it became an Effect Schema reader. It is a reference for tests/server/validators-differential.test.ts only and is not
// product code: nothing under src/ or scripts/ imports it.
import type { RawValue } from "../../../src/lib/fields";

/** Any value a delivery can hold: JSON, or a value that is not (the reference reads both). */
export type LegacyInput = RawValue;

export type LegacyPublication = {
	version: 1;
	projectId: string;
	eventId: string;
	entryId: string;
	expectedRevision: number;
	operation: "publish" | "correct" | "withdraw";
	origin: "work" | "shutdown" | "backfill";
	occurredOn: string;
	threadId: string | null;
	milestoneId: string | null;
	story: {
		headline: string;
		summary: string;
		technicalDetail: string | null;
		delivery: "proposed" | "implemented" | "tested" | "available";
		basis: "agent-reported" | "repository-verified" | "human-confirmed";
	} | null;
};

function record(value: LegacyInput): value is object {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(fields: Map<string, unknown>, keys: string[]): boolean {
	return fields.size === keys.length && keys.every((key) => fields.has(key));
}

function oneOf<T extends string>(
	options: readonly T[],
	value: unknown,
): value is T {
	return options.some((option) => option === value);
}

function revision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function id(value: unknown): value is string {
	return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
}

function text(value: unknown, limit: number): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.length <= limit &&
		!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
	);
}

function day(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false;
	const parsed = new Date(value + "T00:00:00.000Z");

	return (
		Number.isFinite(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

/** Strict shape validation, NOT content sanitization or publication permission. */
export function legacyParsePublication(
	value: LegacyInput,
): LegacyPublication | null {
	if (!record(value)) return null;
	const fields = new Map<string, unknown>(Object.entries(value));

	if (
		!exact(fields, [
			"version",
			"projectId",
			"eventId",
			"entryId",
			"expectedRevision",
			"operation",
			"origin",
			"occurredOn",
			"threadId",
			"milestoneId",
			"story",
		])
	)
		return null;

	if (
		fields.get("version") !== 1 ||
		!id(fields.get("projectId")) ||
		!id(fields.get("eventId")) ||
		!id(fields.get("entryId")) ||
		!revision(fields.get("expectedRevision")) ||
		!day(fields.get("occurredOn")) ||
		(fields.get("threadId") !== null && !id(fields.get("threadId"))) ||
		(fields.get("milestoneId") !== null && !id(fields.get("milestoneId"))) ||
		!oneOf(["publish", "correct", "withdraw"], fields.get("operation")) ||
		!oneOf(["work", "shutdown", "backfill"], fields.get("origin"))
	)
		return null;
	const story = fields.get("story");

	if (fields.get("operation") === "withdraw") {
		if (story !== null) return null;
	} else {
		if (!record(story)) return null;
		const storyFields = new Map<string, unknown>(Object.entries(story));

		if (
			!exact(storyFields, [
				"headline",
				"summary",
				"technicalDetail",
				"delivery",
				"basis",
			]) ||
			!text(storyFields.get("headline"), 140) ||
			!text(storyFields.get("summary"), 1000) ||
			(storyFields.get("technicalDetail") !== null &&
				!text(storyFields.get("technicalDetail"), 4000)) ||
			!oneOf(
				["proposed", "implemented", "tested", "available"],
				storyFields.get("delivery"),
			) ||
			!oneOf(
				["agent-reported", "repository-verified", "human-confirmed"],
				storyFields.get("basis"),
			)
		)
			return null;
	}

	// SAFETY: the checks above validate every Publication field (exact keys, version, id and day formats, operation, origin, and the story for each operation), so the copy has that shape.
	// Detach from the caller so later mutations cannot change a prepared delivery.
	return JSON.parse(JSON.stringify(value)) as LegacyPublication;
}
