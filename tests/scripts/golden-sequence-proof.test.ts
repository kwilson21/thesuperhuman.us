import { describe, expect, it } from "vitest";
import {
	allowed,
	missingFixtures,
	refusals,
} from "../../scripts/golden-sequence-proof.mjs";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

type Case = {
	name: string;
	steps: {
		state: Record<string, Record<string, Record<string, string>[]>>;
		digest: { music: string; atResponse: { music: string; touched: string[] } };
	}[];
	effects: { state: { music: string; touched: string[] } }[];
	finalState: {
		music: {
			sha256: string;
			tables: Record<string, { rows: number; sha256: string }>;
		};
	};
};

function fixtureCase(change: (value: Case) => void = () => undefined): Case {
	const value: Case = {
		name: "case",
		steps: [
			{
				state: {
					music: { audio_project_messages: [{ id: "m1", body: "hello" }] },
				},
				digest: {
					music: HASH,
					atResponse: { music: HASH, touched: ["audio_project_messages"] },
				},
			},
		],
		effects: [{ state: { music: HASH, touched: ["audio_project_messages"] } }],
		finalState: {
			music: {
				sha256: HASH,
				tables: {
					audio_project_messages: { rows: 1, sha256: HASH },
					sqlite_sequence: { rows: 2, sha256: HASH },
				},
			},
		},
	};

	change(value);

	return value;
}

describe("the counter-row proof", () => {
	it.each([
		".steps[0].digest.music",
		".steps[12].digest.kv",
		".steps[0].digest.atResponse.music",
		".effects[2].state.music",
		".finalState.music.sha256",
		".finalState.music.tables.sqlite_sequence",
		".finalState.music.tables.sqlite_sequence.rows",
		".finalState.music.tables.sqlite_sequence.sha256",
	])("allows a digest path (%s)", (path) => {
		expect(allowed(path)).toBe(true);
	});

	it.each([
		".steps[0].response.body",
		".steps[0].state.music.audio_project_messages[0].body",
		".steps[0].state.music",
		".steps[0].digest.atResponse.touched[0]",
		".steps[0].digest.atResponse.touched",
		".effects[2].state.touched[0]",
		".effects[2].sql",
		".steps[0].dump.music.audio_project_messages",
		".finalState.music.tables.audio_project_messages.sha256",
		".finalState.music.tables",
		".finalState.music.tables.audio_project_messages",
		".finalState.music.tables.sqlite_sequence.extra",
		".finalState.r2.agreements/a1/signed.pdf.sha256",
	])("refuses any other path (%s)", (path) => {
		expect(allowed(path)).toBe(false);
	});

	it("accepts a re-record that changed only digests and dropped the counter record", () => {
		const before = fixtureCase();

		const after = fixtureCase((value) => {
			value.steps[0].digest.music = OTHER;
			value.steps[0].digest.atResponse.music = OTHER;
			value.effects[0].state.music = OTHER;
			value.finalState.music.sha256 = OTHER;
			value.finalState.music.tables.sqlite_sequence = {
				rows: 1,
				sha256: OTHER,
			};
		});

		expect(refusals("f", "case", before, after)).toEqual([]);

		const dropped = fixtureCase((value) => {
			value.finalState.music.sha256 = OTHER;
			delete value.finalState.music.tables.sqlite_sequence;
		});

		expect(refusals("f", "case", before, dropped)).toEqual([]);
	});

	it("refuses a dumped row whose body changed", () => {
		const after = fixtureCase((value) => {
			value.steps[0].state.music.audio_project_messages[0].body = "changed";
		});

		expect(refusals("f", "case", fixtureCase(), after)).toEqual([
			'f: "case" differs at .steps[0].state.music.audio_project_messages[0].body',
		]);
	});

	it("refuses a dumped row that was deleted", () => {
		const after = fixtureCase((value) => {
			value.steps[0].state.music.audio_project_messages = [];
		});

		const found = refusals("f", "case", fixtureCase(), after);

		expect(found.length).toBeGreaterThan(0);
		expect(found[0]).toContain(".steps[0].state.music.audio_project_messages");
	});

	it("refuses a changed touched list", () => {
		const after = fixtureCase((value) => {
			value.steps[0].digest.atResponse.touched[0] = "audio_client_sessions";
		});

		expect(refusals("f", "case", fixtureCase(), after)).toEqual([
			'f: "case" differs at .steps[0].digest.atResponse.touched[0]',
		]);
	});

	it("refuses a counter above 0 that changed value", () => {
		const before = fixtureCase((value) => {
			value.finalState.music.tables.sqlite_sequence = {
				rows: 1,
				sha256: HASH,
			};
		});

		const after = fixtureCase((value) => {
			value.finalState.music.tables.sqlite_sequence = {
				rows: 1,
				sha256: OTHER,
			};
		});

		expect(refusals("f", "case", before, after)).toEqual([
			'f: "case" changed a counter value in music',
		]);
	});

	it("refuses a counter hash that changed while the rows stayed the same", () => {
		const after = fixtureCase((value) => {
			value.finalState.music.tables.sqlite_sequence.sha256 = OTHER;
		});

		expect(refusals("f", "case", fixtureCase(), after)).toEqual([
			'f: "case" changed a counter value in music',
		]);
	});

	it("refuses a counter row that appeared", () => {
		const after = fixtureCase((value) => {
			value.finalState.music.tables.sqlite_sequence = {
				rows: 3,
				sha256: OTHER,
			};
		});

		expect(refusals("f", "case", fixtureCase(), after)).toEqual([
			'f: "case" gained a counter row in music',
		]);
	});

	it("refuses a table other than the counters", () => {
		const after = fixtureCase((value) => {
			value.finalState.music.tables.audio_project_messages.sha256 = OTHER;
		});

		expect(refusals("f", "case", fixtureCase(), after)).toEqual([
			'f: "case" differs at .finalState.music.tables.audio_project_messages.sha256',
		]);
	});

	it("refuses a fixture that exists in only one revision", () => {
		expect(missingFixtures(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual([
			"a: the fixture is not in both revisions",
			"c: the fixture is not in both revisions",
		]);
		expect(missingFixtures(new Set(["a"]), new Set(["a"]))).toEqual([]);
	});
});
