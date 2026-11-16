import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import {
	readOwnerMessageCommand,
	readStudioMessageCommand,
} from "../../src/server/audio-project-input";
import {
	legacyReadOwnerMessage,
	legacyReadStudioMessage,
} from "../fixtures/legacy-validators/audio-project-messages";
import {
	differential,
	notStrings,
	seeded,
	texts,
} from "../helpers/differential";

// The message commands of the owner's and the client's routes: the Effect readers (src/server/audio-project-input.ts) must
// answer every input as the frozen Zod 4 schemas (tests/fixtures/legacy-validators/audio-project-messages.ts) do. An answer
// is the ok flag and, when ok, the value with its keys in order, key presence included. Inputs come from a seeded random
// source, so a failure repeats.

type Answer =
	| { readonly ok: true; readonly value: RawValue }
	| { readonly ok: false };

type Random = ReturnType<typeof seeded>;

const show = (answer: Answer) =>
	answer.ok
		? `ok ${inspect(answer.value, { depth: 6, breakLength: 400, compact: true })}`
		: "refused";

const notBodies: readonly RawValue[] = [
	...notStrings,
	"",
	"text",
	[],
	[{ action: "send", body: "x" }],
	"send",
];

const actions: readonly RawValue[] = [
	"send",
	"read",
	"respond",
	"Send",
	" send",
	"send ",
	"",
	"__proto__",
	"constructor",
	"toString",
	...notStrings,
];

const messageIds: readonly RawValue[] = [
	1,
	2,
	7,
	0,
	-1,
	-0,
	1.5,
	0.5,
	1e21,
	2 ** 31,
	2 ** 53 - 1,
	2 ** 53,
	2 ** 53 + 2,
	2 ** 60,
	Number.MAX_SAFE_INTEGER,
	Number.MAX_VALUE,
	Number.MIN_VALUE,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	"1",
	"",
	null,
	undefined,
	true,
	[],
	[1],
	{},
	10n,
];

const reviewIds: readonly RawValue[] = [
	"f1",
	"a",
	"",
	" ",
	"x".repeat(99),
	"x".repeat(100),
	"x".repeat(101),
	"😀".repeat(50),
	"😀".repeat(51),
	"é".repeat(100),
	"é".repeat(100),
	"é".repeat(101),
	" f1 ",
	...texts(100),
	...notStrings,
];

const decisions: readonly RawValue[] = [
	"approved",
	"changes",
	"stopped",
	"Approved",
	" approved",
	"approved ",
	"approve",
	"",
	"toString",
	"constructor",
	...notStrings,
];

const messageBodies: readonly RawValue[] = [
	"Hello",
	"",
	"   ",
	"https://example.com",
	"a".repeat(4001),
	...notStrings,
	{ nested: { deep: [1, 2, { a: null }] } },
];

const extras: readonly RawValue[] = [
	"extra",
	1,
	null,
	{ a: 1 },
	[1],
	undefined,
];

/** A body for `action` built from the pools: a field is left out sometimes and a stray key is added sometimes. */
function bodyFor(
	random: Random,
	action: RawValue,
	pools: { readonly [field: string]: readonly RawValue[] },
): RawValue {
	const body: { [key: string]: RawValue } = { action };

	for (const [field, pool] of Object.entries(pools))
		if (!random.chance(0.12)) body[field] = random.pick(pool);

	if (random.chance(0.15)) body.stray = random.pick(extras);

	if (random.chance(0.05)) body.__proto__ = random.pick(extras);
	const keys = Object.keys(body);

	// A shuffled key order, so the order the body was written in never leaks into the answer.
	for (let i = keys.length - 1; i > 0; i -= 1) {
		const j = random.below(i + 1);
		[keys[i], keys[j]] = [keys[j], keys[i]];
	}

	return Object.fromEntries(keys.map((key) => [key, body[key]]));
}

const ownerPools = {
	send: { body: messageBodies },
	read: { messageId: messageIds },
};

const studioPools = {
	...ownerPools,
	respond: {
		reviewId: reviewIds,
		decision: decisions,
		body: messageBodies,
	},
};

function inputs(random: Random, count: number, withRespond: boolean) {
	const found: RawValue[] = [...notBodies];
	const pools = withRespond ? studioPools : ownerPools;
	const named = Object.keys(pools);

	for (let i = 0; i < count; i += 1) {
		const action = random.chance(0.85)
			? random.pick(named)
			: random.pick(actions);
		const fields =
			action === "send" || action === "read" || action === "respond"
				? pools[action as keyof typeof pools]
				: pools.send;

		found.push(bodyFor(random, action, fields ?? {}));
	}

	return found;
}

describe("the message commands", () => {
	it("the owner's reader accepts and refuses every generated body as the Zod schema did, with the same value", () => {
		const found = differential(
			(input: RawValue) => legacyReadOwnerMessage(input) as Answer,
			(input: RawValue) => readOwnerMessageCommand(input) as Answer,
			show,
		);

		let accepted = 0;

		for (const body of inputs(seeded(20261116), 6000, false)) {
			found.run(body);

			if (legacyReadOwnerMessage(body).ok) accepted += 1;
		}

		expect(found.count).toBeGreaterThan(6000);
		expect(accepted).toBeGreaterThan(2000);
		expect(found.mismatches.slice(0, 4)).toEqual([]);
	}, 60_000);

	it("the client's reader accepts and refuses every generated body as the Zod schema did, with the same value", () => {
		const found = differential(
			(input: RawValue) => legacyReadStudioMessage(input) as Answer,
			(input: RawValue) => readStudioMessageCommand(input) as Answer,
			show,
		);

		let accepted = 0;

		for (const body of inputs(seeded(20261117), 9000, true)) {
			found.run(body);

			if (legacyReadStudioMessage(body).ok) accepted += 1;
		}

		expect(found.count).toBeGreaterThan(9000);
		expect(accepted).toBeGreaterThan(2000);
		expect(found.mismatches.slice(0, 4)).toEqual([]);
	}, 60_000);

	it("keeps a body the client set to undefined and refuses one with no body key, as Zod 4 did", () => {
		const keys = (read: Answer) =>
			read.ok && typeof read.value === "object" && read.value !== null
				? Object.keys(read.value)
				: [];

		for (const body of [
			{ action: "send", body: undefined },
			{ action: "send" },
		]) {
			expect(keys(readOwnerMessageCommand(body) as Answer)).toEqual(
				keys(legacyReadOwnerMessage(body) as Answer),
			);
		}
	});

	it("refuses the numbers and the review ids the design names, as Zod 4 did", () => {
		for (const messageId of [2 ** 53, Number.POSITIVE_INFINITY, 1.5, 0, -1]) {
			const body = { action: "read", messageId };

			expect(readOwnerMessageCommand(body).ok).toBe(false);
			expect(legacyReadOwnerMessage(body).ok).toBe(false);
		}

		const respond = (reviewId: string) => ({
			action: "respond",
			reviewId,
			decision: "approved",
			body: null,
		});

		expect(readStudioMessageCommand(respond("")).ok).toBe(false);
		expect(readStudioMessageCommand(respond("x".repeat(101))).ok).toBe(false);
		expect(readStudioMessageCommand(respond("x".repeat(100))).ok).toBe(true);
	});
});
