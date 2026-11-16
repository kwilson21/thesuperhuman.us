import { describe, expect, it } from "vitest";
import { readAgreementLinkInput } from "../../src/server/agreement-input";
import { legacyAgreementLinkSchema } from "../fixtures/legacy-validators/agreement-link";

// The Effect reader answers every body as the Zod schema it replaced did: the same accept and refuse, and for an accepted
// body the same values. Seeded, so a failure reproduces.

const TEXTS = [
	"",
	" ",
	"a",
	"ada@example.test",
	"  padded  ",
	"x".repeat(319),
	"x".repeat(320),
	"x".repeat(321),
	"y".repeat(2048),
	"y".repeat(2049),
];

type Value =
	| string
	| number
	| boolean
	| null
	| undefined
	| string[]
	| { x: string };

type Body = {
	email?: Value;
	turnstileToken?: Value;
	extra?: Value;
	"cf-turnstile-response"?: Value;
};

function generator(seed: number) {
	let state = seed >>> 0;

	const next = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

		return state / 0x100000000;
	};

	const pick = <T>(values: readonly T[]): T => {
		const index = Math.floor(next() * values.length);

		// SAFETY: next() is below 1, so index is a position of values; the list is never empty.
		return values[index] as T;
	};

	const value = (): Value => {
		const kind = next();

		if (kind < 0.55) return pick(TEXTS);

		if (kind < 0.65) return pick([0, 1, -1, 1.5, Number.NaN]);

		if (kind < 0.72) return pick([null, undefined, true, false]);

		if (kind < 0.8) return [pick(TEXTS)];

		if (kind < 0.85) return { x: pick(TEXTS) };

		return undefined;
	};

	const body = (): Body => {
		const made: Body = {};

		if (next() < 0.7) made.email = value();

		if (next() < 0.7) made.turnstileToken = value();

		if (next() < 0.7) made.extra = value();

		if (next() < 0.7) made["cf-turnstile-response"] = value();

		return made;
	};

	return { body };
}

describe("the Effect reader for an agreement link body", () => {
	it("accepts and refuses every seeded body as the Zod schema does", () => {
		const { body } = generator(20261114);

		for (let index = 0; index < 2000; index++) {
			const sent = body();
			const legacy = legacyAgreementLinkSchema.safeParse(sent);
			const current = readAgreementLinkInput(sent);

			expect(current.ok, JSON.stringify(sent)).toBe(legacy.success);

			if (legacy.success && current.ok)
				expect(current.value).toEqual(legacy.data);
		}
	});

	it.each([null, undefined, "text", 42, [], ["email"]])(
		"refuses a body that is not an object: %j",
		(sent) => {
			expect(readAgreementLinkInput(sent).ok).toBe(false);
			expect(legacyAgreementLinkSchema.safeParse(sent).success).toBe(false);
		},
	);
});
