import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
	type EntryFacts,
	enterCode,
	NoCodeToTry,
	sameHash,
} from "../../src/server/rules/signin-complete";

// The entry rule (docs/plans/2026-11-studio-signin-conversion.md, section 2) over the cases tests/lib/signin-code-rules.test.ts
// held `decideComplete` to for a code the machine allows ENTER on (a live one). A code that is missing, used, expired or
// out of attempts never reaches the rule: the machine refuses it (tests/server/machines-signin-code.test.ts), and the
// flow answers NoCodeToTry. The database re-checks at write time what the rule relied on (C4 to C7).

const open = { requestId: "open", withdrawn: false };
const withdrawn = { requestId: "withdrawn", withdrawn: true };

const decide = (projects: EntryFacts["projects"], digest = "right") =>
	Effect.runSync(enterCode.decide({ digest }, { codeHash: "right", projects }));

describe("entering a live sign-in code", () => {
	const cases: [string, EntryFacts["projects"], string, unknown][] = [
		[
			"the right code, an open project",
			[open],
			"right",
			{ accept: true, auditRequestIds: ["open"] },
		],
		[
			"the right code, a withdrawn project only",
			[withdrawn],
			"right",
			{ accept: false, auditRequestIds: ["withdrawn"] },
		],
		[
			"the right code, no project",
			[],
			"right",
			{ accept: false, auditRequestIds: [] },
		],
		[
			"the right code, a withdrawn and an open project",
			[withdrawn, open],
			"right",
			{ accept: true, auditRequestIds: ["withdrawn", "open"] },
		],
		[
			"a wrong code is still counted",
			[open],
			"wrong",
			{ accept: false, auditRequestIds: ["open"] },
		],
		[
			"a typed hash that is longer is counted and not accepted",
			[open],
			"right-and-more",
			{ accept: false, auditRequestIds: ["open"] },
		],
		[
			"a typed hash that is shorter is counted and not accepted",
			[open],
			"righ",
			{ accept: false, auditRequestIds: ["open"] },
		],
	];

	for (const [name, projects, digest, expected] of cases)
		it(name, () => {
			expect(decide(projects, digest)).toEqual(expected);
		});

	it("names the refusal the flow gives when the machine refuses ENTER, with the one sentence of a wrong code", () => {
		const refusal = new NoCodeToTry();

		expect(refusal._tag).toBe("NoCodeToTry");
		expect(refusal.say).toBe(
			"That code is invalid or expired. Enter it in the browser where you asked for it, or request a new one here.",
		);
	});
});

describe("comparing hashes", () => {
	it("is equal only for the same text, whatever the length", () => {
		expect(sameHash("abcd", "abcd")).toBe(true);
		expect(sameHash("abcd", "abce")).toBe(false);
		expect(sameHash("abcd", "abc")).toBe(false);
		expect(sameHash("abc", "abcd")).toBe(false);
		expect(sameHash("", "")).toBe(true);
	});
});
