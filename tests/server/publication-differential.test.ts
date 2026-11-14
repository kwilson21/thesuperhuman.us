import { describe, expect, it } from "vitest";
import { parsePublication } from "../../src/lib/publication/contract";
import { differential, notStrings, seeded, texts } from "../helpers/differential";
import { legacyParsePublication } from "../fixtures/legacy-validators/publication-contract";

// The publication envelope reader (an Effect Schema reader in src/lib/publication/contract.ts) is held to the hand-written
// validator it replaced (frozen in tests/fixtures/legacy-validators/publication-contract.ts): the same value, key order
// included, or the same refusal, for thousands of seeded inputs made by changing one or two members of a valid envelope.

type Value = { [name: string]: unknown };

const valid = (operation: string): Value => ({
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
	story:
		operation === "withdraw"
			? null
			: {
					headline: "Search is faster",
					summary: "Searching answers in under a second.",
					technicalDetail: null,
					delivery: "available",
					basis: "repository-verified",
				},
});

const topKeys = Object.keys(valid("publish"));
const storyKeys = Object.keys(valid("publish").story as Value);

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

const numbers = [0, 1, -1, 1.5, 0.0, -0, 2 ** 53 - 1, 2 ** 53, 1e300, Number.NaN];
const ids = ["a", "A", "a_b-c", "-a", "a".repeat(80), "a".repeat(81), "", "a b", "a.b", "é"];
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

describe("the publication envelope reader against the validator it replaced", () => {
	it("answers alike on thousands of seeded inputs", () => {
		const random = seeded(20261114);

		const pool: unknown[] = [
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
			(input: unknown) => ({ v: legacyParsePublication(input) }),
			(input: unknown) => ({ v: parsePublication(input) }),
			(answer) => JSON.stringify(answer),
		);

		for (let i = 0; i < 6000; i += 1) {
			const operation = random.pick(["publish", "correct", "withdraw"]);
			const input = valid(operation);
			const changes = 1 + random.below(2);

			for (let n = 0; n < changes; n += 1) {
				const target =
					random.chance(0.35) &&
					typeof input.story === "object" &&
					input.story !== null &&
					!Array.isArray(input.story)
						? // SAFETY: just checked to be a plain object; the test builds it from the valid envelope above.
							(input.story as Value)
						: input;

				const keys = target === input ? topKeys : storyKeys;
				const key = random.pick(keys);
				const kind = random.below(5);

				if (kind === 0) delete target[key];
				else if (kind === 1) target[`extra${random.below(3)}`] = random.pick(pool);
				else if (kind === 2 && target === input) input.story = random.pick([null, valid("publish").story, {}, [], "s"]);
				else target[key] = random.pick(pool);
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
