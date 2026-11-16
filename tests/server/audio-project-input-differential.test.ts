import { inspect } from "node:util";
import * as Predicate from "effect/Predicate";
import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import {
	readFileCommand,
	readOwnerMessageCommand,
	readPartQuery,
	readStudioMessageCommand,
	readUploadCommand,
} from "../../src/server/audio-project-input";
import {
	legacyReadFileCommand,
	legacyReadPartQuery,
	legacyReadUploadCommand,
} from "../fixtures/legacy-validators/audio-project-files";
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

type Answer = { readonly ok: boolean; readonly value?: RawValue };

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
	const entries: [string, RawValue][] = [["action", action]];

	for (const [field, pool] of Object.entries(pools))
		if (!random.chance(0.12)) entries.push([field, random.pick(pool)]);

	if (random.chance(0.15)) entries.push(["stray", random.pick(extras)]);

	// A shuffled key order, so the order the body was written in never leaks into the answer.
	for (let i = entries.length - 1; i > 0; i -= 1) {
		const j = random.below(i + 1);
		[entries[i], entries[j]] = [entries[j], entries[i]];
	}

	return Object.fromEntries(entries);
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

		const fields = Object.entries(pools).find(([name]) => name === action)?.[1];

		found.push(bodyFor(random, action, fields ?? pools.send));
	}

	return found;
}

describe("the message commands", () => {
	it("the owner's reader accepts and refuses every generated body as the Zod schema did, with the same value", () => {
		const found = differential(
			(input: RawValue): Answer => legacyReadOwnerMessage(input),
			(input: RawValue): Answer => readOwnerMessageCommand(input),
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
			(input: RawValue): Answer => legacyReadStudioMessage(input),
			(input: RawValue): Answer => readStudioMessageCommand(input),
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
			read.ok && Predicate.isObject(read.value) ? Object.keys(read.value) : [];

		for (const body of [
			{ action: "send", body: undefined },
			{ action: "send" },
		]) {
			expect(keys(readOwnerMessageCommand(body))).toEqual(
				keys(legacyReadOwnerMessage(body)),
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

// The file routes' commands and the PUT's query, held to the frozen Zod 4 copies the same way.

const uploadIds: readonly RawValue[] = [
	"11111111-1111-4111-8111-111111111111",
	"11111111-1111-1111-1111-111111111111",
	"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
	"ffffffff-ffff-ffff-ffff-ffffffffffff",
	"00000000-0000-0000-0000-000000000000",
	"00000000-0000-4000-8000-000000000001",
	"AAAAAAAA-AAAA-4AAA-BAAA-AAAAAAAAAAAA",
	"aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa",
	"aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa",
	"aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa",
	" 00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000001\n",
	"00000000-0000-4000-8000-00000000000",
	"not-a-uuid",
	"",
	...notStrings,
];

const displayNames: readonly RawValue[] = [
	"Mix v1",
	"  padded  ",
	"x".repeat(160),
	"x".repeat(161),
	"😀".repeat(160),
	"😀".repeat(161),
	" ".repeat(5),
	"\u00a0\ufeff",
	"",
	...texts(160),
	...notStrings,
];

const byteSizes: readonly RawValue[] = [
	1,
	12,
	10 * 1024 * 1024,
	1024 * 1024 * 1024,
	1024 * 1024 * 1024 + 1,
	0,
	-1,
	1.5,
	2 ** 53,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	"12",
	null,
	undefined,
	10n,
];

const etags: readonly RawValue[] = [
	"a".repeat(32),
	"a",
	"",
	"a".repeat(256),
	"a".repeat(257),
	"😀".repeat(256),
	"😀".repeat(257),
	" ",
	...notStrings,
];

const partNumbers: readonly RawValue[] = [
	1,
	2,
	0,
	-1,
	1.5,
	2 ** 53,
	Number.NaN,
	"1",
	null,
	undefined,
];

function partLists(random: Random): RawValue {
	if (random.chance(0.1)) return random.pick(notStrings);
	const length = random.pick([0, 1, 2, 3, 102, 103, 104]);

	return Array.from({ length }, () => {
		const entry: { [name: string]: RawValue } = {};

		if (!random.chance(0.1)) entry.partNumber = random.pick(partNumbers);
		if (!random.chance(0.1)) entry.etag = random.pick(etags);
		if (random.chance(0.1)) entry.stray = 1;

		return entry;
	});
}

function peakLists(random: Random): RawValue {
	if (random.chance(0.15)) return random.pick(notStrings);
	const length = random.pick([0, 15, 16, 17, 399, 400, 401]);
	const bad: readonly RawValue[] = [-1, 101, 1.5, "1", null, Number.NaN];

	return Array.from({ length }, () =>
		random.chance(0.03) ? random.pick(bad) : random.below(101),
	);
}

const mediaTypes: readonly RawValue[] = [
	"audio/mpeg",
	"audio/wav",
	"audio/mp3",
	"Audio/Wav",
	"",
	...notStrings,
];

const versions: readonly RawValue[] = [
	"review",
	"final",
	"Review",
	"",
	...notStrings,
];

const notes: readonly RawValue[] = [
	"Take two.",
	"  trimmed  ",
	"a".repeat(1000),
	"a".repeat(1001),
	" ".repeat(1001),
	"",
	"   ",
	...texts(1000),
	...notStrings,
];

const uploadActions = ["start", "complete", "abort", "recover"];

function uploadBody(random: Random): RawValue {
	const action = random.chance(0.9)
		? random.pick(uploadActions)
		: random.pick(actions);

	const entries: [string, RawValue][] = [["action", action]];
	const maybe = (name: string, value: RawValue) => {
		if (!random.chance(0.1)) entries.push([name, value]);
	};

	if (action === "start") {
		maybe("version", random.pick(versions));
		maybe("displayName", random.pick(displayNames));
		maybe("mediaType", random.pick(mediaTypes));
		maybe("byteSize", random.pick(byteSizes));
	} else if (action === "complete") {
		maybe("uploadId", random.pick(uploadIds));
		maybe("parts", partLists(random));
		if (random.chance(0.6)) entries.push(["peaks", peakLists(random)]);
		else if (random.chance(0.3)) entries.push(["peaks", undefined]);
	} else maybe("uploadId", random.pick(uploadIds));

	if (random.chance(0.15)) entries.push(["stray", random.pick(extras)]);

	for (let i = entries.length - 1; i > 0; i -= 1) {
		const j = random.below(i + 1);
		[entries[i], entries[j]] = [entries[j], entries[i]];
	}

	return Object.fromEntries(entries);
}

function fileBody(random: Random): RawValue {
	const action = random.chance(0.9)
		? random.pick(["publish", "revoke"])
		: random.pick(actions);

	const entries: [string, RawValue][] = [["action", action]];

	if (!random.chance(0.08)) entries.push(["note", random.pick(notes)]);

	if (!random.chance(0.1))
		entries.push([
			"downloadable",
			random.pick([true, false, 1, 0, "true", null, undefined]),
		]);

	if (random.chance(0.15)) entries.push(["stray", random.pick(extras)]);

	return Object.fromEntries(entries);
}

describe("the file routes' commands", () => {
	it("the uploads reader accepts and refuses every generated body as the Zod schema did, with the same value", () => {
		const found = differential(
			(input: RawValue): Answer => legacyReadUploadCommand(input),
			(input: RawValue): Answer => readUploadCommand(input),
			show,
		);

		let accepted = 0;
		const random = seeded(20261118);

		for (const body of [
			...notBodies,
			...Array.from({ length: 9000 }, () => uploadBody(random)),
		]) {
			found.run(body);

			if (legacyReadUploadCommand(body).ok) accepted += 1;
		}

		expect(found.count).toBeGreaterThan(9000);
		expect(accepted).toBeGreaterThan(300);
		expect(found.mismatches.slice(0, 4)).toEqual([]);
	}, 60_000);

	it("the file reader accepts and refuses every generated body as the Zod schema did, with the same value", () => {
		const found = differential(
			(input: RawValue): Answer => legacyReadFileCommand(input),
			(input: RawValue): Answer => readFileCommand(input),
			show,
		);

		let accepted = 0;
		const random = seeded(20261119);

		for (const body of [
			...notBodies,
			...Array.from({ length: 6000 }, () => fileBody(random)),
		]) {
			found.run(body);

			if (legacyReadFileCommand(body).ok) accepted += 1;
		}

		expect(found.count).toBeGreaterThan(6000);
		expect(accepted).toBeGreaterThan(1000);
		expect(found.mismatches.slice(0, 4)).toEqual([]);
	}, 60_000);

	it("refuses an upload id of no valid variant and the upper case max UUID, as Zod 4 did", () => {
		for (const uploadId of [
			"11111111-1111-1111-1111-111111111111",
			"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
		]) {
			expect(readUploadCommand({ action: "abort", uploadId }).ok).toBe(false);
			expect(legacyReadUploadCommand({ action: "abort", uploadId }).ok).toBe(
				false,
			);
			expect(readPartQuery(uploadId, "1", true).ok).toBe(false);
		}

		for (const uploadId of [
			"ffffffff-ffff-ffff-ffff-ffffffffffff",
			"00000000-0000-0000-0000-000000000000",
		])
			expect(readUploadCommand({ action: "abort", uploadId }).ok).toBe(true);
	});

	it("reads the PUT's query as the route did, an empty or a missing part as 0", () => {
		const id = "00000000-0000-4000-8000-000000000001";

		const parts: (string | null)[] = [
			"1",
			"2",
			"0",
			"",
			null,
			" 3 ",
			"1.5",
			"-1",
			"1e3",
			"0x10",
			"abc",
			"Infinity",
			"NaN",
			"9007199254740993",
		];

		for (const uploadId of [id, null, "", "nope"])
			for (const part of parts)
				for (const hasBody of [true, false])
					expect(readPartQuery(uploadId, part, hasBody)).toEqual(
						legacyReadPartQuery(uploadId, part, hasBody),
					);

		expect(readPartQuery(id, "", true)).toEqual({
			ok: true,
			value: { uploadId: id, part: 0 },
		});
		expect(readPartQuery(id, null, true)).toEqual({
			ok: true,
			value: { uploadId: id, part: 0 },
		});
	});
});
