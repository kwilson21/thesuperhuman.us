import { describe, expect, it } from "vitest";
import {
	proveFixture,
	proveFixtureDetailed,
} from "../../scripts/golden-format-proof.mjs";

// The proof for the format 3 to 4 re-record: only the table sets, the format number and the counts of reads that now say 0
// may differ. Everything else, trigger-hit entries and the older digests included, is compared exactly.

const hit = {
	kind: "trigger-hit",
	trigger: "failure",
	name: "n",
	db: "M",
	hits: [{ op: "UPDATE", table: "a", access: "write" }],
	step: 0,
	phase: "request",
};

const d1 = (sql: string, changes: number) => ({
	kind: "d1",
	sql,
	outcome: { rows: 0, changes },
	step: 0,
	phase: "request",
});

type Stated = { music: string; publication: string; touched?: string[] };

const stated = (touched?: string[]): Stated => {
	const state: Stated = { music: "m", publication: "p" };

	if (touched) state.touched = touched;

	return state;
};

const mail = (touched?: string[]) => ({
	kind: "fetch",
	url: "https://api.resend.com/emails",
	step: 0,
	phase: "request",
	state: stated(touched),
});

const step = (touched?: string[], extra = {}) => ({
	request: { path: "/x" },
	answer: { status: 200 },
	state: null,
	digest: {
		music: "end",
		publication: "p",
		r2: "r",
		kv: "k",
		atResponse: stated(touched),
	},
	...extra,
});

const oldCase = (effects: object[] = [hit, mail(), d1("SELECT 1", 1)]) => ({
	name: "a",
	format: 3,
	steps: [step()],
	effects,
	final: null,
	finalState: { music: { sha256: "x", tables: {} } },
});

const newCase = (
	effects: object[] = [hit, mail(["a"]), d1("SELECT 1", 0)],
	over = {},
) => ({
	...oldCase(),
	format: 4,
	steps: [step(["a"])],
	effects,
	...over,
});

describe("golden format proof, format 3 to 4", () => {
	it("accepts a re-record that only added the table sets and zeroed a read's count", () => {
		const got = proveFixtureDetailed([oldCase()], [newCase()]);

		expect(got).toEqual({ problems: [], counts: 1 });
	});

	it("an older recorder case, with no format, must be identical", () => {
		const legacy = {
			name: "legacy",
			answers: [],
			effects: [{ step: 0, kv: "K", op: "get" }],
		};

		expect(proveFixture([legacy], [legacy])).toEqual([]);

		expect(
			proveFixture(
				[legacy],
				[{ ...legacy, effects: [{ step: 0, kv: "K", op: "put" }] }],
			),
		).toHaveLength(1);
	});

	it("rejects a tampered pre-existing field", () => {
		const got = proveFixture(
			[oldCase()],
			[
				newCase(undefined, {
					steps: [{ ...step(["a"]), answer: { status: 201 } }],
				}),
			],
		);

		expect(got).toHaveLength(1);
		expect(got[0]).toContain("steps[0].answer.status");
	});

	it("compares trigger-hit entries exactly: a changed, removed or added one is rejected", () => {
		const other = {
			...hit,
			hits: [{ op: "SELECT", table: "a", access: "read" }],
		};

		for (const effects of [
			[other, mail(["a"]), d1("SELECT 1", 0)],
			[mail(["a"]), d1("SELECT 1", 0)],
			[hit, hit, mail(["a"]), d1("SELECT 1", 0)],
		])
			expect(proveFixture([oldCase()], [newCase(effects)])).toHaveLength(1);
	});

	it("compares the older digests exactly: a step digest, an effect state and the final state", () => {
		const digest = { ...step(["a"]).digest, music: "changed" };

		expect(
			proveFixture(
				[oldCase()],
				[newCase(undefined, { steps: [{ ...step(["a"]), digest }] })],
			),
		).toHaveLength(1);

		const state = {
			...mail(["a"]),
			state: { music: "changed", publication: "p", touched: ["a"] },
		};

		expect(
			proveFixture([oldCase()], [newCase([hit, state, d1("SELECT 1", 0)])]),
		).toHaveLength(1);

		expect(
			proveFixture(
				[oldCase()],
				[
					newCase(undefined, {
						finalState: { music: { sha256: "y", tables: {} } },
					}),
				],
			),
		).toHaveLength(1);
	});

	it("accepts only a sorted list of table names as the added set, and no other added field", () => {
		expect(
			proveFixture(
				[oldCase()],
				[newCase([hit, mail(["b", "a"]), d1("SELECT 1", 0)])],
			),
		).toHaveLength(1);

		const extra = {
			...mail(["a"]),
			state: { music: "m", publication: "p", touched: ["a"], more: 1 },
		};

		expect(
			proveFixture([oldCase()], [newCase([hit, extra, d1("SELECT 1", 0)])]),
		).toHaveLength(1);
		expect(
			proveFixture([oldCase()], [newCase(undefined, { surprise: true })]),
		).toHaveLength(1);
	});

	it("accepts a changed count only for a read that now says 0", () => {
		const was = (sql: string, changes: number) =>
			oldCase([hit, mail(), d1(sql, changes)]);

		const now = (sql: string, changes: number) =>
			newCase([hit, mail(["a"]), d1(sql, changes)]);

		expect(proveFixture([was("SELECT 1", 1)], [now("SELECT 1", 0)])).toEqual(
			[],
		);
		expect(
			proveFixture([was("SELECT 1", 1)], [now("SELECT 1", 2)]),
		).toHaveLength(1);
		expect(
			proveFixture(
				[was("UPDATE a SET x = 1", 1)],
				[now("UPDATE a SET x = 1", 0)],
			),
		).toHaveLength(1);
		expect(
			proveFixture(
				[was("UPDATE a SET x = 1", 1)],
				[now("UPDATE a SET x = 1", 2)],
			),
		).toHaveLength(1);
		expect(
			proveFixture(
				[was("UPDATE a SET x = 1", 1)],
				[now("UPDATE a SET x = 1", 1)],
			),
		).toEqual([]);
	});

	it("applies the same rule to the statements of a batch", () => {
		const batch = (changes: number) => ({
			kind: "d1-batch",
			result: "committed",
			statements: [
				{ sql: "SELECT 1", args: [], outcome: { rows: 1, changes } },
			],
			step: 0,
			phase: "request",
		});

		expect(
			proveFixtureDetailed(
				[oldCase([hit, mail(), batch(1)])],
				[newCase([hit, mail(["a"]), batch(0)])],
			),
		).toEqual({
			problems: [],
			counts: 1,
		});
	});

	it("rejects a case that is not format 3 before and format 4 after", () => {
		expect(
			proveFixture([oldCase()], [newCase(undefined, { format: 3 })]),
		).toHaveLength(1);
		expect(
			proveFixture([{ ...oldCase(), format: 2 }], [newCase()]),
		).toHaveLength(1);
	});

	it("rejects a removed, added, renamed or reordered case", () => {
		expect(proveFixture([oldCase()], [])).not.toEqual([]);
		expect(proveFixture([oldCase()], [newCase(), newCase()])).not.toEqual([]);
		expect(
			proveFixture([oldCase()], [newCase(undefined, { name: "b" })]),
		).not.toEqual([]);
	});
});
