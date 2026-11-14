import { describe, expect, it } from "vitest";
import {
	completeSignInCode,
	type CompleteFacts,
} from "../../src/server/rules/signin-complete";
import {
	issueSignInCode,
	type IssueFacts,
} from "../../src/server/rules/signin-issue";
import { answerOf, refuse, write } from "../helpers/rule-answers";

// The two sign-in decisions as pure rules, over the whole table of facts. The database only re-checks the facts a rule
// relied on when it writes (see src/lib/audio-client-access.ts).

const cap = 6;

const open = { requestId: "open", withdrawn: false };
const withdrawn = { requestId: "withdrawn", withdrawn: true };

describe("issuing a sign-in code", () => {
	const projectSets: [string, IssueFacts["projects"]][] = [
		["no project", []],
		["a withdrawn project only", [withdrawn]],
		["an open project", [open]],
		["an open and a withdrawn project", [open, withdrawn]],
	];

	for (const [name, projects] of projectSets)
		for (const liveOthers of [0, cap - 1, cap, cap + 1]) {
			const eligible = projects.some((project) => !project.withdrawn);

			const expected = !eligible
				? refuse("NoOpenProject", "No open studio project for this address.")
				: liveOthers >= cap
					? refuse(
							"AddressFull",
							"This address already has the most live codes.",
						)
					: write({
							auditRequestIds: projects.map((project) => project.requestId),
							liveOthersBelow: cap,
						});

			it(`${name}, ${liveOthers} other live codes`, () => {
				expect(
					answerOf(issueSignInCode.decide({ cap }, { projects, liveOthers })),
				).toEqual(expected);
			});
		}

	it("audits every project that is not closed, as the old audit did, even a withdrawn one next to an open one", () => {
		expect(
			answerOf(
				issueSignInCode.decide(
					{ cap },
					{ projects: [withdrawn, open], liveOthers: 0 },
				),
			),
		).toMatchObject({
			save: { auditRequestIds: ["withdrawn", "open"] },
		});
	});
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
		answerOf(completeSignInCode.decide({ limit, now, digest }, facts));

	const cases: [string, CompleteFacts, string, unknown][] = [
		[
			"no code row",
			{ code: null, projects: [open] },
			"right",
			refuse("NoCodeToTry", "There is no code to try."),
		],
		[
			"a used code",
			{ code: code({ usedAt: "2026-11-13T11:59:00.000Z" }), projects: [open] },
			"right",
			refuse("NoCodeToTry", "There is no code to try."),
		],
		[
			"a code that expires at this instant",
			{ code: code({ expiresAt: now }), projects: [open] },
			"right",
			refuse("NoCodeToTry", "There is no code to try."),
		],
		[
			"a code past its attempts",
			{ code: code({ attempts: limit }), projects: [open] },
			"right",
			refuse("NoCodeToTry", "There is no code to try."),
		],
		[
			"the right code, an open project",
			{ code: code(), projects: [open] },
			"right",
			write({ accept: true, auditRequestIds: ["open"] }),
		],
		[
			"the right code on the last attempt",
			{ code: code({ attempts: limit - 1 }), projects: [open] },
			"right",
			write({ accept: true, auditRequestIds: ["open"] }),
		],
		[
			"the right code, a withdrawn project only",
			{ code: code(), projects: [withdrawn] },
			"right",
			write({ accept: false, auditRequestIds: ["withdrawn"] }),
		],
		[
			"the right code, no project",
			{ code: code(), projects: [] },
			"right",
			write({ accept: false, auditRequestIds: [] }),
		],
		[
			"the right code, a withdrawn and an open project",
			{ code: code(), projects: [withdrawn, open] },
			"right",
			write({ accept: true, auditRequestIds: ["withdrawn", "open"] }),
		],
		[
			"a wrong code is still charged",
			{ code: code(), projects: [open] },
			"wrong",
			write({ accept: false, auditRequestIds: ["open"] }),
		],
		[
			"a wrong code of another length is charged and not accepted",
			{ code: code(), projects: [open] },
			"right-and-more",
			write({ accept: false, auditRequestIds: ["open"] }),
		],
	];

	for (const [name, facts, digest, expected] of cases)
		it(name, () => {
			expect(decide(facts, digest)).toEqual(expected);
		});
});
