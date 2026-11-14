import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import { parsePublication } from "../../src/lib/publication/contract";
import {
	differential,
	notStrings,
	seeded,
	texts,
} from "../helpers/differential";
import type { JsonObject } from "../helpers/json";
import { legacyParsePublication } from "../fixtures/legacy-validators/publication-contract";

// The publication envelope reader (an Effect Schema reader in src/lib/publication/contract.ts) is held to the hand-written
// validator it replaced (frozen in tests/fixtures/legacy-validators/publication-contract.ts): the same value, key order
// included, or the same refusal, for thousands of seeded inputs made by changing one or two members of a valid envelope.

const story = (): JsonObject => ({
	headline: "Search is faster",
	summary: "Searching answers in under a second.",
	technicalDetail: null,
	delivery: "available",
	basis: "repository-verified",
});

const valid = (operation: string): JsonObject => ({
	version: 1,
	projectId: "threadline",
	eventId: "evt-1",
	entryId: "entry-1",
	expectedRevision: 3,
	operation,
	origin: "work",
	occurredOn: "2026-11-12",
	threadId: null,
	milestoneId: null,
	story: operation === "withdraw" ? null : story(),
});

const topKeys = Object.keys(valid("publish"));
const storyKeys = Object.keys(story());

const days = [
	"2026-11-12",
	"2026-02-30",
	"2024-02-29",
	"2026-13-01",
	"2026-1-01",
	"2026-11-12T00:00",
	"0000-01-01",
	"9999-12-31",
	"",
];

const numbers = [
	0,
	1,
	-1,
	1.5,
	0.0,
	-0,
	2 ** 53 - 1,
	2 ** 53,
	1e300,
	Number.NaN,
];

const ids = [
	"a",
	"A",
	"a_b-c",
	"-a",
	"a".repeat(80),
	"a".repeat(81),
	"",
	"a b",
	"a.b",
	"é",
];

const words = [
	"proposed",
	"implemented",
	"tested",
	"available",
	"agent-reported",
	"repository-verified",
	"human-confirmed",
	"publish",
	"correct",
	"withdraw",
	"work",
	"shutdown",
	"backfill",
	"Publish",
];

/** The members of an object story, or null when the story is not one. */
const storyObject = (input: JsonObject): JsonObject | null => {
	const held = input.story;

	if (
		held === null ||
		held === undefined ||
		Array.isArray(held) ||
		Object.getPrototypeOf(held) !== Object.prototype
	)
		return null;

	// SAFETY: a non-null, non-array value with the plain object prototype is a JSON object, and the only values this test puts in `story` are null, strings, arrays and objects.
	return held as JsonObject;
};

/** A member value from the pool, which holds values of every kind on purpose. */
const memberFrom = (pool: RawValue[], random: ReturnType<typeof seeded>) => {
	// SAFETY: the pool holds JSON and non-JSON values alike on purpose, and the reader and the frozen copy both take their input as unknown, so the declared type is only what the envelope builder's members are typed as.
	return random.pick(pool) as JsonObject;
};

describe("the publication envelope reader against the validator it replaced", () => {
	it("answers alike on thousands of seeded inputs", () => {
		const random = seeded(20261114);

		const pool: RawValue[] = [
			...notStrings,
			...ids,
			...days,
			...numbers,
			...words,
			...texts(140),
			...texts(1000),
			...texts(4000).slice(0, 30),
		];

		const run = differential(
			(input: RawValue) => ({ v: legacyParsePublication(input) }),
			(input: RawValue) => ({ v: parsePublication(input) }),
			(answer) => JSON.stringify(answer),
		);

		for (let i = 0; i < 6000; i += 1) {
			const input = valid(random.pick(["publish", "correct", "withdraw"]));
			const changes = 1 + random.below(2);

			for (let n = 0; n < changes; n += 1) {
				const inStory = random.chance(0.35) ? storyObject(input) : null;
				const target = inStory ?? input;
				const key = random.pick(inStory ? storyKeys : topKeys);
				const kind = random.below(5);

				if (kind === 0) delete target[key];
				else if (kind === 1)
					target[`extra${random.below(3)}`] = memberFrom(pool, random);
				else if (kind === 2 && !inStory)
					input.story = random.pick([null, story(), {}, [], "s"]);
				else target[key] = memberFrom(pool, random);
			}
			run.run(input);
		}

		for (const input of [...notStrings, [], [valid("publish")], "{}", null])
			run.run(input);

		expect(run.mismatches).toEqual([]);
		expect(run.count).toBeGreaterThan(6000);
	});

	it("accepts the same valid envelope, with members in the order they arrived", () => {
		for (const operation of ["publish", "correct", "withdraw"]) {
			const input = valid(operation);
			const reordered = Object.fromEntries(Object.entries(input).reverse());

			expect(JSON.stringify(parsePublication(reordered))).toBe(
				JSON.stringify(legacyParsePublication(reordered)),
			);
			expect(parsePublication(input)).not.toBeNull();
		}
	});
});
