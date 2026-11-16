import { describe, expect, it } from "vitest";
import type { RawValue } from "../../src/lib/fields";
import { readPassInput, readSuggestInput } from "../../src/server/brief-input";
import { legacyReadPass } from "../fixtures/legacy-validators/brief-pass";
import { legacyReadSuggest } from "../fixtures/legacy-validators/brief-suggest";
import {
	differential,
	notStrings,
	seeded,
	texts,
	type Mismatch,
} from "../helpers/differential";

// The brief suggestion bodies: the Effect readers (src/server/brief-input.ts) must answer every input as the frozen Zod 3
// schemas (tests/fixtures/legacy-validators) do. An answer is the ok flag and, when ok, the value as JSON, key order
// included (the model's prompt is that JSON). Inputs come from a seeded random source, so a failure repeats.

type Answer =
	| { readonly ok: true; readonly value: RawValue }
	| { readonly ok: false };

type Random = ReturnType<typeof seeded>;

const show = (answer: Answer) =>
	answer.ok ? `ok ${JSON.stringify(answer.value)}` : "refused";

const notBodies: readonly RawValue[] = [
	...notStrings,
	"",
	"text",
	[],
	[{ question: "What happens today?" }],
	"{}",
];

const questions: readonly RawValue[] = [
	"What happens today?",
	"What’s the idea?",
	"Have a first result in mind?",
	"Have a first version in mind?",
	"What’s the website for?",
	"What should the app let people do?",
	"What's the idea?",
	"What's the website for?",
	"what happens today?",
	"What happens today? ",
	"What happens today?\n",
	"",
	"x".repeat(101),
	"What happens today?" + " ".repeat(90),
];

const paths: readonly RawValue[] = [
	"workflow",
	"idea",
	"website",
	"webapp",
	"other",
	"Workflow",
];

const TEXTS: readonly RawValue[] = [
	...texts(2000),
	...texts(2000).map((text) => `${text}\n`),
];

function earlier(random: Random): RawValue {
	const value: Record<string, RawValue> = {};

	if (random.chance(0.9)) value.path = random.pick(paths);

	if (random.chance(0.4)) value.today = random.pick(TEXTS);

	if (random.chance(0.4)) value.idea = random.pick(TEXTS);

	if (random.chance(0.3)) value.purpose = random.pick(TEXTS);

	if (random.chance(0.3)) value.appGoal = random.pick(TEXTS);

	if (random.chance(0.05)) value.extra = "x";

	if (random.chance(0.03)) value.today = random.pick(notStrings);

	return value;
}

function suggestBody(random: Random): RawValue {
	if (random.chance(0.02)) return random.pick(notBodies);
	const body: Record<string, RawValue> = {};

	if (random.chance(0.95)) body.question = random.pick(questions);

	if (random.chance(0.03)) body.question = random.pick(notStrings);

	if (random.chance(0.95)) body.text = random.pick(TEXTS);

	if (random.chance(0.02)) body.text = random.pick(notStrings);

	if (random.chance(0.95)) body.earlier = earlier(random);

	if (random.chance(0.03)) body.earlier = random.pick(notStrings);

	if (random.chance(0.04)) body.extra = true;

	return body;
}

function passBody(random: Random): RawValue {
	if (random.chance(0.02)) return random.pick(notBodies);
	const body: Record<string, RawValue> = {};

	const tokens: readonly RawValue[] = [
		"",
		"a",
		"token-1",
		"  token  ",
		"ключ-🎵",
		"t".repeat(2048),
		"t".repeat(2049),
	];

	if (random.chance(0.95)) body.token = random.pick(tokens);

	if (random.chance(0.02)) body.token = random.pick(notStrings);

	if (random.chance(0.04)) body.extra = true;

	return body;
}

function compare(
	name: string,
	generate: (random: Random) => RawValue,
	oracle: (body: RawValue) => Answer,
	subject: (body: RawValue) => Answer,
) {
	it(`answers every ${name} body as the Zod schema does`, () => {
		const random = seeded(0x51a7e);
		let accepted = 0;
		let refused = 0;
		// Both answers must be reached, or the comparison proves nothing about one of them.

		const check = differential(
			(body: RawValue) => {
				const answer = oracle(body);

				if (answer.ok) accepted += 1;
				else refused += 1;

				return answer;
			},
			subject,
			show,
		);

		for (let i = 0; i < 4000; i++) {
			check.run(generate(random));
		}

		const found: Mismatch[] = check.mismatches;

		expect(check.count).toBe(4000);
		expect(found.slice(0, 3)).toEqual([]);
		expect(accepted).toBeGreaterThan(100);
		expect(refused).toBeGreaterThan(100);
	});
}

describe("the brief suggestion readers", () => {
	compare("suggest", suggestBody, legacyReadSuggest, readSuggestInput);
	compare("pass", passBody, legacyReadPass, readPassInput);
});
