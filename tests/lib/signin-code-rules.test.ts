import { describe, expect, it } from "vitest";
import {
	decideComplete,
	decideIssue,
	sameHash,
	type CompleteFacts,
	type IssueFacts,
} from "~/lib/signin-code-rules";

// The two sign-in decisions as pure functions, over the whole table of facts. The database only re-checks the facts a
// decision relied on when it writes (src/lib/audio-client-access.ts).

const cap = 6;

const open = { requestId: "open", withdrawn: false };
const withdrawn = { requestId: "withdrawn", withdrawn: true };

describe("issuing a sign-in code", () => {
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

			const expected = !eligible
				? { kind: "refuse", refusal: "NoOpenProject" }
				: liveOthers >= cap
					? { kind: "refuse", refusal: "AddressFull" }
					: {
							kind: "issue",
							// Every project that is not closed is audited, a withdrawn one included.
							auditRequestIds: projects.map((project) => project.requestId),
							liveOthersBelow: cap,
						};

			it(`${name}, ${liveOthers} other live codes`, () => {
				expect(decideIssue({ projects, liveOthers }, cap)).toEqual(expected);
			});
		}
});

describe("completing a sign-in", () => {
	const now = "2026-11-13T12:00:00.000Z";
	const limit = 5;

	const code = (over: Partial<NonNullable<CompleteFacts["code"]>> = {}) => ({
		attempts: 0,
		usedAt: null,
		expiresAt: "2026-11-13T12:10:00.000Z",
		codeHash: "right",
		...over,
	});

	const decide = (facts: CompleteFacts, digest = "right") =>
		decideComplete(facts, { limit, now, digest });

	const refused = { kind: "refuse", refusal: "NoCodeToTry" };

	const cases: [string, CompleteFacts, string, unknown][] = [
		["no code row", { code: null, projects: [open] }, "right", refused],
		[
			"a used code",
			{ code: code({ usedAt: "2026-11-13T11:59:00.000Z" }), projects: [open] },
			"right",
			refused,
		],
		[
			"a code that expires at this instant",
			{ code: code({ expiresAt: now }), projects: [open] },
			"right",
			refused,
		],
		[
			"a code past its attempts",
			{ code: code({ attempts: limit }), projects: [open] },
			"right",
			refused,
		],
		[
			"the right code, an open project",
			{ code: code(), projects: [open] },
			"right",
			{ kind: "count", accept: true, auditRequestIds: ["open"] },
		],
		[
			"the right code on the last attempt",
			{ code: code({ attempts: limit - 1 }), projects: [open] },
			"right",
			{ kind: "count", accept: true, auditRequestIds: ["open"] },
		],
		[
			"the right code, a withdrawn project only",
			{ code: code(), projects: [withdrawn] },
			"right",
			{ kind: "count", accept: false, auditRequestIds: ["withdrawn"] },
		],
		[
			"the right code, no project",
			{ code: code(), projects: [] },
			"right",
			{ kind: "count", accept: false, auditRequestIds: [] },
		],
		[
			"the right code, a withdrawn and an open project",
			{ code: code(), projects: [withdrawn, open] },
			"right",
			{ kind: "count", accept: true, auditRequestIds: ["withdrawn", "open"] },
		],
		[
			"a wrong code is still counted",
			{ code: code(), projects: [open] },
			"wrong",
			{ kind: "count", accept: false, auditRequestIds: ["open"] },
		],
		[
			"a typed hash that is longer is counted and not accepted",
			{ code: code(), projects: [open] },
			"right-and-more",
			{ kind: "count", accept: false, auditRequestIds: ["open"] },
		],
	];

	for (const [name, facts, digest, expected] of cases)
		it(name, () => {
			expect(decide(facts, digest)).toEqual(expected);
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
