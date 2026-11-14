import { describe, expect, it } from "vitest";
import {
	decideComplete,
	decideDiscard,
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
	const now = "2026-11-13T12:00:00.000Z";
	const later = "2026-11-13T12:10:00.000Z";
	const address = "artist@example.com";
	const own = "own";

	const row = (
		nonceHash: string,
		over: Partial<IssueFacts["codes"][number]> = {},
	) => ({
		nonceHash,
		email: address,
		codeHash: `code-${nonceHash}`,
		usedAt: null,
		expiresAt: later,
		...over,
	});

	const facts = (
		projects: IssueFacts["projects"],
		codes: IssueFacts["codes"] = [],
	): IssueFacts => ({ address, ownNonceHash: own, now, projects, codes });

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
				? {
						kind: "refuse",
						refusal: "NoOpenProject",
						clearEarlierEmail: null,
						expiredCodes: [],
					}
				: liveOthers >= cap
					? {
							kind: "refuse",
							refusal: "AddressFull",
							clearEarlierEmail: null,
							expiredCodes: [],
						}
					: {
							kind: "issue",
							// Every project that is not closed is audited, a withdrawn one included.
							auditRequestIds: projects.map((project) => project.requestId),
							liveOthersBelow: cap,
							clearEarlierEmail: null,
							expiredCodes: [],
						};

			it(`${name}, ${liveOthers} other live codes`, () => {
				const codes = Array.from({ length: liveOthers }, (_, index) =>
					row(`other${index}`),
				);

				expect(decideIssue(facts(projects, codes), cap)).toEqual(expected);
			});
		}

	describe("which codes are live for the cap", () => {
		const countsAs = (codes: IssueFacts["codes"]) =>
			decideIssue(facts([open], codes), 1).kind === "refuse"
				? "live"
				: "not live";

		it("counts an unused, unexpired code of the address", () => {
			expect(countsAs([row("a")])).toBe("live");
		});

		it("does not count a used code", () => {
			expect(countsAs([row("a", { usedAt: now })])).toBe("not live");
		});

		it("does not count a code that expires at this instant, and counts one that expires a millisecond later", () => {
			expect(countsAs([row("a", { expiresAt: now })])).toBe("not live");
			expect(
				countsAs([row("a", { expiresAt: "2026-11-13T12:00:00.001Z" })]),
			).toBe("live");
		});

		it("does not count the browser's own code, or another address's code", () => {
			expect(countsAs([row(own)])).toBe("not live");
			expect(countsAs([row("a", { email: "other@example.com" })])).toBe(
				"not live",
			);
		});
	});

	it("names the expired rows it was given, whatever the answer is", () => {
		const codes = [
			row("old", { expiresAt: now }),
			row("older", { expiresAt: "2026-11-13T11:00:00.000Z" }),
			row("live"),
		];

		for (const projects of [[open], []])
			expect(decideIssue(facts(projects, codes), cap)).toMatchObject({
				expiredCodes: [
					{ nonceHash: "old", codeHash: "code-old" },
					{ nonceHash: "older", codeHash: "code-older" },
				],
			});
	});

	describe("the browser's earlier code", () => {
		it("is cleared when it is for a different address, whatever the answer is", () => {
			const earlier = row(own, { email: "other@example.com" });
			const full = Array.from({ length: cap }, (_, index) => row(`o${index}`));

			for (const [projects, codes] of [
				[[open], [earlier]],
				[[], [earlier]],
				[[open], [earlier, ...full]],
			] as const)
				expect(decideIssue(facts(projects, codes), cap)).toMatchObject({
					clearEarlierEmail: "other@example.com",
				});
		});

		it("is left alone when it is for the same address, or when there is none", () => {
			expect(decideIssue(facts([], [row(own)]), cap)).toMatchObject({
				kind: "refuse",
				clearEarlierEmail: null,
			});
			expect(decideIssue(facts([open], []), cap)).toMatchObject({
				clearEarlierEmail: null,
			});
		});
	});
});

describe("discarding an undelivered code", () => {
	it("discards a code that is still unused, and audits every project that is not closed", () => {
		expect(
			decideDiscard({
				code: { usedAt: null },
				projects: [withdrawn, open],
			}),
		).toEqual({ kind: "discard", auditRequestIds: ["withdrawn", "open"] });
	});

	it("has nothing to do for a used code or a missing one", () => {
		expect(
			decideDiscard({
				code: { usedAt: "2026-11-13T11:59:00.000Z" },
				projects: [open],
			}),
		).toEqual({ kind: "refuse", refusal: "NothingToDiscard" });
		expect(decideDiscard({ code: null, projects: [open] })).toEqual({
			kind: "refuse",
			refusal: "NothingToDiscard",
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
