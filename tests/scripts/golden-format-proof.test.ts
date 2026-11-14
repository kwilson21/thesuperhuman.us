import { describe, expect, it } from "vitest";
import {
	proveFixture,
	proveFixtureDetailed,
} from "../../scripts/golden-format-proof.mjs";
import type { JsonObject } from "../helpers/json";
import {
	digestOf,
	finalStateOf,
	sha,
	stateOf,
} from "../helpers/golden-records";

// The proof for the format 3 to 4 re-record: only the table sets, the format number and the counts of reads that now say 0
// may differ, the later record must have the whole shape format 4 requires, and everything else (trigger-hit entries and
// the older digests included) is compared exactly.

/** Format 3 recorded the same states without `touched`. */
const withoutTouched = <T extends { touched: string[] }>(state: T) => {
	const { touched: _touched, ...rest } = state;

	return rest;
};

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

const mail = (state: JsonObject) => ({
	kind: "fetch",
	url: "https://api.resend.com/emails",
	step: 0,
	phase: "request",
	state,
});

const step = (digest: JsonObject, extra = {}) => ({
	request: { path: "/x" },
	answer: { status: 200 },
	state: null,
	digest,
	...extra,
});

const oldDigest = () => {
	const { atResponse, ...rest } = digestOf();

	return { ...rest, atResponse: withoutTouched(atResponse) };
};

const oldCase = (
	effects: object[] = [hit, mail(withoutTouched(stateOf())), d1("SELECT 1", 1)],
) => ({
	name: "a",
	format: 3,
	steps: [step(oldDigest())],
	effects,
	final: null,
	finalState: finalStateOf(),
});

const newCase = (
	effects: object[] = [hit, mail(stateOf("m", ["a"])), d1("SELECT 1", 0)],
	over = {},
) => ({
	...oldCase(),
	format: 4,
	steps: [step(digestOf("m", ["a"]))],
	effects,
	...over,
});

describe("golden format proof, format 3 to 4", () => {
	it("accepts a re-record that only added the table sets and zeroed a read's count", () => {
		expect(proveFixtureDetailed([oldCase()], [newCase()])).toEqual({
			problems: [],
			counts: 1,
			touched: [],
			phases: {
				cases: 0,
				relabelled: 0,
				atResponse: 0,
				waitUntilState: 0,
				moved: 0,
			},
		});
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
					steps: [step(digestOf("m", ["a"]), { answer: { status: 201 } })],
				}),
			],
		);

		expect(got).toHaveLength(1);
		expect(got[0]).toContain("steps[0].answer.status");
	});

	it("compares trigger-hit entries exactly: a changed, removed or added one is rejected", () => {
		const state = mail(stateOf("m", ["a"]));

		const other = {
			...hit,
			hits: [{ op: "SELECT", table: "a", access: "read" }],
		};

		for (const effects of [
			[other, state, d1("SELECT 1", 0)],
			[state, d1("SELECT 1", 0)],
			[hit, hit, state, d1("SELECT 1", 0)],
		])
			expect(proveFixture([oldCase()], [newCase(effects)])).toHaveLength(1);
	});

	it("compares the older digests exactly: a step digest, an effect state and the final state", () => {
		const changed = { ...digestOf("m", ["a"]), music: sha("changed") };

		expect(
			proveFixture(
				[oldCase()],
				[newCase(undefined, { steps: [step(changed)] })],
			),
		).toHaveLength(1);

		expect(
			proveFixture(
				[oldCase()],
				[newCase([hit, mail(stateOf("changed", ["a"])), d1("SELECT 1", 0)])],
			),
		).toHaveLength(1);

		expect(
			proveFixture(
				[oldCase()],
				[
					newCase(undefined, {
						finalState: { ...finalStateOf(), r2: { k: 1 } },
					}),
				],
			),
		).toHaveLength(1);
	});

	it("REQUIRES the fields format 4 mandates: a later record without touched, atResponse or a state is rejected", () => {
		const noTouched = [hit, mail(withoutTouched(stateOf())), d1("SELECT 1", 0)];

		expect(proveFixture([oldCase()], [newCase(noTouched)])).toHaveLength(1);

		const noAtResponse = { ...digestOf("m", ["a"]), atResponse: undefined };

		expect(
			proveFixture(
				[oldCase()],
				[newCase(undefined, { steps: [step(noAtResponse)] })],
			),
		).toHaveLength(1);

		const noState = [
			hit,
			{ ...mail(stateOf()), state: undefined },
			d1("SELECT 1", 0),
		];

		expect(proveFixture([oldCase()], [newCase(noState)])).toHaveLength(1);
		expect(
			proveFixture(
				[oldCase()],
				[newCase(undefined, { finalState: undefined })],
			),
		).toHaveLength(1);
	});

	it("accepts only a sorted list of table names as the added set, and no other added field", () => {
		expect(
			proveFixture(
				[oldCase()],
				[newCase([hit, mail(stateOf("m", ["b", "a"])), d1("SELECT 1", 0)])],
			),
		).toHaveLength(1);

		const extra = { ...stateOf("m", ["a"]), more: 1 };

		expect(
			proveFixture(
				[oldCase()],
				[newCase([hit, mail(extra), d1("SELECT 1", 0)])],
			),
		).toHaveLength(1);
		expect(
			proveFixture([oldCase()], [newCase(undefined, { surprise: true })]),
		).toHaveLength(1);
	});

	it("accepts a changed count only for a read that now says 0", () => {
		const was = (sql: string, changes: number) =>
			oldCase([hit, mail(withoutTouched(stateOf())), d1(sql, changes)]);

		const now = (sql: string, changes: number) =>
			newCase([hit, mail(stateOf("m", ["a"])), d1(sql, changes)]);

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
				[oldCase([hit, mail(withoutTouched(stateOf())), batch(1)])],
				[newCase([hit, mail(stateOf("m", ["a"])), batch(0)])],
			),
		).toMatchObject({ problems: [], counts: 1, touched: [] });
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

describe("golden format proof, format 4 to 4 (the table sets are derived differently)", () => {
	const four = (touched: string[], over = {}) => ({
		...newCase([hit, mail(stateOf("m", touched)), d1("SELECT 1", 0)], {
			steps: [step(digestOf("m", touched))],
		}),
		...over,
	});

	it("accepts a re-record where only the table sets differ, and lists the cases", () => {
		const got = proveFixtureDetailed([four(["a"])], [four(["a", "b"])]);

		expect(got.problems).toEqual([]);
		expect(got.touched).toEqual(["a"]);
	});

	it("accepts an identical re-record with no changed set", () => {
		expect(proveFixtureDetailed([four(["a"])], [four(["a"])])).toMatchObject({
			problems: [],
			touched: [],
		});
	});

	it("rejects any other difference: a digest, a state, a trigger-hit, a count, the final state", () => {
		const base = four(["a"]);

		for (const changed of [
			four(["a"], {
				steps: [step({ ...digestOf("m", ["a"]), music: sha("x") })],
			}),
			four(["a"], {
				effects: [hit, mail(stateOf("other", ["a"])), d1("SELECT 1", 0)],
			}),
			four(["a"], { effects: [mail(stateOf("m", ["a"])), d1("SELECT 1", 0)] }),
			four(["a"], {
				effects: [hit, mail(stateOf("m", ["a"])), d1("SELECT 1", 1)],
			}),
			four(["a"], { finalState: { ...finalStateOf(), r2: { k: 1 } } }),
		])
			expect(proveFixture([base], [changed])).toHaveLength(1);
	});

	it("still requires the whole shape of the later record", () => {
		expect(
			proveFixture([four(["a"])], [four(["a"], { finalState: undefined })]),
		).toHaveLength(1);
	});

	it("a format 4 to 4 pair may not be mixed with a format 3 to 4 count change", () => {
		const was = four(["a"], {
			effects: [hit, mail(stateOf("m", ["a"])), d1("SELECT 1", 1)],
		});

		expect(proveFixture([was], [four(["a"])])).toHaveLength(1);
	});
});

describe("golden format proof, format 4 to 5 (the phase is what the response waited for)", () => {
	const wait = (state: JsonObject, phase = "request") => ({
		kind: "waitUntil",
		id: 1,
		step: 0,
		phase,
		state,
	});

	const log = (phase: string, over: object[] = []) => [
		wait(stateOf("m", ["a"])),
		{ ...mail(stateOf("m", ["a"])), phase },
		...over,
	];

	const five = (effects: object[], over = {}) => ({
		...newCase(effects, { steps: [step(digestOf("m", ["a"]))] }),
		format: 5,
		...over,
	});

	const four = (effects: object[], over = {}) =>
		five(effects, { format: 4, ...over });

	it("accepts a relabel from request to background, with the digest at the response and a waitUntil state", () => {
		const was = four(log("request"), {
			steps: [step(digestOf("early", ["a"]))],
		});

		const now = five(
			[
				wait(stateOf("before", ["a"])),
				{ ...mail(stateOf("m", ["a"])), phase: "background" },
			],
			{ steps: [step({ ...digestOf("m", ["a"]) })] },
		);

		const got = proveFixtureDetailed([was], [now]);

		expect(got.problems).toEqual([]);

		expect(got.phases).toEqual({
			cases: 1,
			relabelled: 1,
			atResponse: 1,
			waitUntilState: 1,
			moved: 0,
		});
	});

	it("counts a written line that sits at another place among the effects", () => {
		const was = four([mail(stateOf("m", ["a"])), wait(stateOf("m", ["a"]))]);
		const now = five([wait(stateOf("m", ["a"])), mail(stateOf("m", ["a"]))]);

		expect(proveFixtureDetailed([was], [now]).phases.moved).toBe(1);
		expect(proveFixtureDetailed([was], [now]).problems).toEqual([]);
	});

	it("rejects a relabel from background to request", () => {
		expect(
			proveFixture([four(log("background"))], [five(log("request"))]),
		).toHaveLength(1);
	});

	it("rejects every other difference: an effect's state or order, a D1 statement, a count, the answer, the final state", () => {
		const base = four([...log("request"), d1("SELECT 1", 0)]);

		for (const changed of [
			five([...log("request"), d1("SELECT 2", 0)]),
			five([...log("request"), d1("SELECT 1", 0)].reverse()),
			five([
				wait(stateOf("m", ["a"])),
				{ ...mail(stateOf("other", ["a"])), phase: "request" },
				d1("SELECT 1", 0),
			]),
			five([...log("request")]),
			five([...log("request"), d1("SELECT 1", 0)], {
				steps: [step(digestOf("m", ["a"]), { answer: { status: 201 } })],
			}),
			five([...log("request"), d1("SELECT 1", 0)], {
				finalState: { ...finalStateOf(), r2: { k: 1 } },
			}),
			five([...log("request"), d1("SELECT 1", 0)], {
				steps: [step({ ...digestOf("m", ["a"]), music: sha("changed") })],
			}),
		])
			expect(proveFixture([base], [changed]).length).toBeGreaterThan(0);
	});

	it("lets only a waitUntil entry change its state, not a console line's", () => {
		const line = (state: JsonObject) => ({
			kind: "console",
			level: "error",
			args: [],
			step: 0,
			phase: "request",
			state,
		});

		expect(
			proveFixture(
				[four([line(stateOf("m", ["a"]))])],
				[five([line(stateOf("n", ["a"]))])],
			),
		).toHaveLength(1);
	});
});
