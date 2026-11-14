import { describe, expect, it } from "vitest";
import {
	proveFixture,
	withoutAdded,
} from "../../scripts/golden-format-proof.mjs";

// The proof that a fixture format change only added fields: every pre-existing field is byte-identical.

const step = (extra = {}) => ({
	request: { path: "/x" },
	answer: { status: 200 },
	state: null,
	...extra,
});

const d1 = (sql = "SELECT 1", changes: number | null = null) => ({
	kind: "d1",
	sql,
	outcome: { rows: 0, changes },
	step: 0,
	phase: "request",
});

const mail = (extra = {}) => ({
	kind: "fetch",
	url: "https://api.resend.com/emails",
	step: 0,
	phase: "request",
	...extra,
});

const hit = {
	kind: "trigger-hit",
	trigger: "failure",
	name: "n",
	db: "M",
	hits: [],
	step: 0,
	phase: "request",
};

const oldCase = () => ({
	name: "a",
	steps: [step()],
	effects: [d1()],
	final: null,
});

const newCase = (over = {}) => ({
	name: "a",
	format: 2,
	steps: [step({ digest: { music: "abc" } })],
	effects: [hit, d1()],
	final: null,
	finalState: { music: { sha256: "x", tables: {} } },
	...over,
});

describe("golden format proof", () => {
	it("accepts a case that only gained the listed fields", () => {
		expect(proveFixture([oldCase()], [newCase()])).toEqual([]);
	});

	it("a case that did not change at all is fine (the older recorder fixtures stay as they are)", () => {
		expect(proveFixture([oldCase()], [oldCase()])).toEqual([]);
	});

	it("rejects a tampered pre-existing field", () => {
		const got = proveFixture(
			[oldCase()],
			[
				newCase({
					steps: [step({ digest: { music: "abc" }, answer: { status: 201 } })],
				}),
			],
		);

		expect(got).toHaveLength(1);
		expect(got[0]).toContain("steps[0].answer.status");
	});

	it("rejects a changed D1 statement, a dropped effect and a changed final dump", () => {
		for (const bad of [
			newCase({ effects: [hit, d1("SELECT 2")] }),
			newCase({ effects: [] }),
			newCase({ final: { music: {} } }),
		])
			expect(proveFixture([oldCase()], [bad])).toHaveLength(1);
	});

	it("rejects an added field that is not on the list", () => {
		expect(
			proveFixture([oldCase()], [newCase({ surprise: true })]),
		).toHaveLength(1);

		expect(
			proveFixture(
				[oldCase()],
				[newCase({ steps: [step({ digest: { music: "abc" }, more: 1 })] })],
			),
		).toHaveLength(1);
	});

	it("rejects an added effect of any other kind", () => {
		const console = {
			kind: "console",
			level: "error",
			args: [],
			step: 0,
			phase: "request",
		};

		expect(
			proveFixture([oldCase()], [newCase({ effects: [hit, d1(), console] })]),
		).toHaveLength(1);
	});

	it("rejects a removed, added, renamed or reordered case", () => {
		expect(proveFixture([oldCase()], [])).not.toEqual([]);
		expect(proveFixture([oldCase()], [newCase(), newCase()])).not.toEqual([]);
		expect(proveFixture([oldCase()], [newCase({ name: "b" })])).not.toEqual([]);
	});

	it("an effect may gain the database state it happened in, and nothing else about it may change", () => {
		const was = { ...oldCase(), effects: [mail(), d1()] };

		expect(
			proveFixture(
				[was],
				[
					newCase({
						effects: [
							hit,
							{ ...mail(), state: { music: "m", publication: "p" } },
							d1(),
						],
					}),
				],
			),
		).toEqual([]);

		expect(
			proveFixture(
				[was],
				[
					newCase({
						effects: [
							hit,
							{ ...mail({ url: "x" }), state: { music: "m" } },
							d1(),
						],
					}),
				],
			),
		).toHaveLength(1);
	});

	it("a change count that was null may become a real number, and nothing else about the outcome may change", () => {
		const was = { ...oldCase(), effects: [d1("UPDATE a SET x = 1", null)] };

		const now = (changes: number | null, sql = "UPDATE a SET x = 1") =>
			newCase({ effects: [hit, d1(sql, changes)] });

		expect(proveFixture([was], [now(1)])).toEqual([]);
		expect(proveFixture([was], [now(0)])).toEqual([]);
		expect(proveFixture([was], [now(-1)])).toHaveLength(1);
		expect(proveFixture([was], [now(1, "UPDATE a SET x = 2")])).toHaveLength(1);
	});

	it("a change count that was a number may not change, nor become null", () => {
		const was = { ...oldCase(), effects: [d1("UPDATE a SET x = 1", 1)] };

		const now = (changes: number | null) =>
			newCase({ effects: [hit, d1("UPDATE a SET x = 1", changes)] });

		expect(proveFixture([was], [now(1)])).toEqual([]);
		expect(proveFixture([was], [now(2)])).toHaveLength(1);
		expect(proveFixture([was], [now(null)])).toHaveLength(1);
	});

	it("a batch statement's null change count may be filled in too", () => {
		const batch = (changes: number | null) => ({
			kind: "d1-batch",
			result: "committed",
			statements: [
				{ sql: "SELECT 1", args: [], outcome: { rows: 1, changes } },
			],
			step: 0,
			phase: "request",
		});

		const was = { ...oldCase(), effects: [batch(null)] };

		expect(
			proveFixture([was], [newCase({ effects: [hit, batch(0)] })]),
		).toEqual([]);
	});

	it("withoutAdded keeps everything else", () => {
		expect(withoutAdded(newCase())).toEqual(oldCase());
	});
});
