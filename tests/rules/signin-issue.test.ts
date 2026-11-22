import { describe, expect, it } from "vitest";
import { CODE_ON_ITS_WAY } from "../../src/lib/studio-signin";
import {
	type AddressCode,
	type IssueFacts,
	issueCode,
	LIVE_CODES_PER_ADDRESS,
} from "../../src/server/rules/signin-issue";
import { outcome, run, wrote } from "../helpers/offer-rules";

// The issue rule (docs/plans/2026-11-studio-signin-conversion.md, section 2) over the whole table of facts, the cases
// tests/lib/signin-code-rules.test.ts held `decideIssue` to: whether an address with these projects and this many other
// live codes is issued a code, and which codes count as live. The database only re-checks, at write time, the two facts
// the rule relied on (C1 and C2, src/server/studio-signin-store.ts).

const cap = LIVE_CODES_PER_ADDRESS;
const now = "2026-11-13T12:00:00.000Z";
const later = "2026-11-13T12:10:00.000Z";
const address = "artist@example.com";
const own = "own";

const open = { requestId: "open", withdrawn: false };
const withdrawn = { requestId: "withdrawn", withdrawn: true };

const row = (nonceHash: string, over: Partial<AddressCode> = {}) => ({
	nonceHash,
	email: address,
	codeHash: `code-${nonceHash}`,
	usedAt: null,
	expiresAt: later,
	...over,
});

const decide = (
	projects: IssueFacts["projects"],
	codes: IssueFacts["codes"] = [],
) =>
	run(
		issueCode.decide({ address, ownNonceHash: own, now }, { projects, codes }),
	);

describe("issuing a sign-in code", () => {
	it("allows six live codes besides the browser's own", () => {
		expect(cap).toBe(6);
	});

	const projectSets: [string, IssueFacts["projects"]][] = [
		["no project", []],
		["a withdrawn project only", [withdrawn]],
		["an open project", [open]],
		["an open and a withdrawn project", [open, withdrawn]],
		["a withdrawn and an open project", [withdrawn, open]],
	];

	for (const [name, projects] of projectSets)
		for (const liveOthers of [0, cap - 1, cap, cap + 1]) {
			const eligible = projects.some((project) => !project.withdrawn);

			it(`${name}, ${liveOthers} other live codes`, () => {
				const codes = Array.from({ length: liveOthers }, (_, index) =>
					row(`other${index}`),
				);

				const answer = decide(projects, codes);

				if (!eligible) expect(outcome(answer)).toBe("NoOpenProject");
				else if (liveOthers >= cap) expect(outcome(answer)).toBe("AddressFull");
				else
					expect(wrote(answer)).toEqual({
						// Every project that is not closed is audited, a withdrawn one included.
						auditRequestIds: projects.map((project) => project.requestId),
						liveOthersBelow: cap,
					});
			});
		}

	it("refuses no open project before a full address", () => {
		const full = Array.from({ length: cap }, (_, index) => row(`o${index}`));

		expect(outcome(decide([withdrawn], full))).toBe("NoOpenProject");
	});

	it("answers both refusals with the sentence every code request gives", () => {
		const full = Array.from({ length: cap }, (_, index) => row(`o${index}`));

		for (const answer of [decide([]), decide([open], full)])
			expect("refusal" in answer && answer.refusal.say).toBe(CODE_ON_ITS_WAY);
	});

	describe("which codes are live for the cap", () => {
		// Five other live codes, then the one asked about: it is live when the address is then full.
		const countsAs = (code: AddressCode) =>
			outcome(
				decide(
					[open],
					[
						...Array.from({ length: cap - 1 }, (_, index) =>
							row(`five${index}`),
						),
						code,
					],
				),
			) === "AddressFull"
				? "live"
				: "not live";

		it("counts an unused, unexpired code of the address", () => {
			expect(countsAs(row("a"))).toBe("live");
		});

		it("does not count a used code", () => {
			expect(countsAs(row("a", { usedAt: now }))).toBe("not live");
		});

		it("does not count a code that expires at this instant, and counts one that expires a millisecond later", () => {
			expect(countsAs(row("a", { expiresAt: now }))).toBe("not live");
			expect(
				countsAs(row("a", { expiresAt: "2026-11-13T12:00:00.001Z" })),
			).toBe("live");
		});

		it("does not count the browser's own code, or another address's code", () => {
			expect(countsAs(row(own))).toBe("not live");
			expect(countsAs(row("a", { email: "other@example.com" }))).toBe(
				"not live",
			);
		});
	});
});
