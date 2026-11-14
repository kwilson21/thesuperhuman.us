import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { JsonObject, JsonValue } from "../helpers/json";
import {
	compareCase,
	compareFixture,
	isWriteSql,
} from "../../scripts/golden-neutral.mjs";

// Hand-built cases in the shape the golden harness records. What a conversion may change is the D1 entries and nothing
// else; each test below changes one thing.

type Json = JsonObject;

const read = (sql: string, args: JsonValue[] = [], extra: Json = {}) => ({
	kind: "d1",
	db: "MUSIC_DB",
	via: "first",
	sql,
	args,
	outcome: { rows: 1, changes: null },
	step: 0,
	phase: "request",
	...extra,
});

const write = (sql: string, extra: Json = {}) => ({
	kind: "d1",
	db: "MUSIC_DB",
	via: "run",
	sql,
	args: [],
	outcome: { rows: 0, changes: 1 },
	step: 0,
	phase: "request",
	...extra,
});

const email = (extra: Json = {}) => ({
	kind: "fetch",
	host: "resend",
	url: "https://api.resend.com/emails",
	method: "POST",
	headers: { "content-type": "application/json" },
	body: '{"to":"a@example.test"}',
	hasSignal: false,
	answered: "200",
	step: 0,
	phase: "request",
	...extra,
});

const answer = (extra: Json = {}) => ({
	outcome: "response",
	status: 200,
	headers: { "content-type": "application/json" },
	setCookies: ["studio_session=a; Path=/"],
	body: '{"ok":true}',
	...extra,
});

const make = (
	name: string,
	over: {
		effects?: Json[];
		answer?: Json;
		state?: JsonValue;
		final?: JsonValue;
	} = {},
) => ({
	name,
	steps: [
		{
			request: { actor: "owner", method: "POST", path: "/x", body: null },
			answer: over.answer ?? answer(),
			state: over.state ?? { music: { items: [{ id: 1, value: "a" }] } },
		},
	],
	effects: over.effects ?? [
		read("SELECT * FROM items WHERE id = ?", [1]),
		write("UPDATE items SET value = 'b' WHERE id = 1"),
		email(),
	],
	final: over.final ?? { music: { items: [{ id: 1, value: "b" }] } },
});

const base = make("a case");

const compare = (changed: Json) => compareCase(base, changed);

describe("compareCase: what stays neutral", () => {
	it("an identical case is identical", () => {
		expect(compare(structuredClone(base)).status).toBe("identical");
	});

	it("a change to the SQL text, binds, statement count and results of D1 alone is neutral", () => {
		const got = compare(
			make("a case", {
				effects: [
					read("SELECT id FROM items", []),
					read("SELECT value FROM items WHERE id = ?", [1]),
					write("UPDATE items SET value = ? WHERE id = ? AND value = ?", {
						args: ["b", 1, "a"],
						outcome: { rows: 0, changes: 1 },
					}),
					email(),
				],
			}),
		);

		expect(got).toEqual({ status: "d1-only", shifts: [] });
	});

	it("batch boundaries may differ: a batch in place of single statements", () => {
		const got = compare(
			make("a case", {
				effects: [
					{
						kind: "d1-batch",
						db: "MUSIC_DB",
						result: "committed",
						error: null,
						statements: [
							{
								sql: "UPDATE items SET value = 'b'",
								args: [],
								outcome: { rows: 0, changes: 1 },
							},
						],
						step: 0,
						phase: "request",
					},
					email(),
				],
			}),
		);

		expect(got.status).toBe("d1-only");
	});

	it("the case name is not compared", () => {
		expect(compareCase(base, { ...base, name: "other" }).status).toBe(
			"identical",
		);
	});
});

describe("compareCase: what is not neutral", () => {
	it("a changed status", () => {
		const got = compare(make("a case", { answer: answer({ status: 409 }) }));

		expect(got.status).toBe("non-neutral");
		expect(got.difference).toMatchObject({
			area: "response",
			path: "case.steps[0].answer.status",
			expected: 200,
			actual: 409,
		});
	});

	it("a changed body", () => {
		const got = compare(
			make("a case", { answer: answer({ body: '{"ok":false}' }) }),
		);

		expect(got.difference).toMatchObject({
			path: "case.steps[0].answer.body",
			expected: '{"ok":true}',
			actual: '{"ok":false}',
		});
	});

	it("a changed header", () => {
		const got = compare(
			make("a case", {
				answer: answer({ headers: { "content-type": "text/html" } }),
			}),
		);

		expect(got.difference?.path).toBe(
			"case.steps[0].answer.headers.content-type",
		);
	});

	it("a changed cookie", () => {
		const got = compare(
			make("a case", { answer: answer({ setCookies: ["studio_session=b"] }) }),
		);

		expect(got.difference?.path).toBe("case.steps[0].answer.setCookies[0]");
	});

	it("a changed row value in the final database dump", () => {
		const got = compare(
			make("a case", { final: { music: { items: [{ id: 1, value: "c" }] } } }),
		);

		expect(got.difference).toMatchObject({
			area: "database or store state",
			path: "case.final.music.items[0].value",
		});
	});

	it("a missing row in a step's database dump", () => {
		const got = compare(make("a case", { state: { music: { items: [] } } }));

		expect(got.difference?.area).toBe("database or store state");
		expect(got.difference?.path).toBe("case.steps[0].state.music.items[0]");
	});

	it("an extra table in the final dump", () => {
		const got = compare(
			make("a case", {
				final: {
					music: { items: [{ id: 1, value: "b" }], audit: [{ id: 1 }] },
				},
			}),
		);

		expect(got.difference?.path).toBe("case.final.music.audit");
	});

	it("a changed non-D1 effect", () => {
		const got = compare(
			make("a case", {
				effects: [
					read("SELECT 1"),
					write("UPDATE items SET value = 'b'"),
					email({ body: '{"to":"b@example.test"}' }),
				],
			}),
		);

		expect(got.status).toBe("non-neutral");
		expect(got.difference?.area).toContain("an effect changed");
		expect(got.difference?.path).toBe("effects(without D1)[0].body");
	});

	it("an added non-D1 effect", () => {
		const got = compare(
			make("a case", {
				effects: [
					write("UPDATE items SET value = 'b'"),
					email(),
					email({ url: "https://api.resend.com/second" }),
				],
			}),
		);

		expect(got.difference?.area).toContain("an effect was added");
	});

	it("a removed non-D1 effect", () => {
		const got = compare(
			make("a case", { effects: [write("UPDATE items SET value = 'b'")] }),
		);

		expect(got.difference?.area).toContain("an effect was removed");
	});

	it("reordered non-D1 effects", () => {
		const two = make("a case", {
			effects: [
				write("UPDATE items SET value = 'b'"),
				email(),
				email({ url: "https://api.resend.com/second" }),
			],
		});

		const swapped = make("a case", {
			effects: [
				write("UPDATE items SET value = 'b'"),
				email({ url: "https://api.resend.com/second" }),
				email(),
			],
		});

		const got = compareCase(two, swapped);

		expect(got.status).toBe("non-neutral");
		expect(got.difference?.area).toContain("different order");
	});

	it("an effect that moved to another step or phase", () => {
		expect(
			compare(
				make("a case", {
					effects: [
						read("SELECT 1"),
						write("UPDATE items SET value = 'b'"),
						email({ phase: "background" }),
					],
				}),
			).status,
		).toBe("non-neutral");
	});
});

describe("compareCase: where a non-D1 effect sits among the writes", () => {
	const after = (effects: Json[]) => make("a case", { effects });

	it("an email that went out after the write and now goes out before it is reported", () => {
		const got = compare(
			after([email(), read("SELECT 1"), write("UPDATE items SET value = 'b'")]),
		);

		expect(got.status).toBe("d1-only");
		expect(got.shifts).toEqual([
			{
				step: 0,
				effect: "fetch POST https://api.resend.com/emails",
				from: "after the last write",
				to: "before the first write",
			},
		]);
	});

	it("an email between two writes that is now after both is reported", () => {
		const was = make("a case", {
			effects: [
				write("UPDATE a SET x = 1"),
				email(),
				write("UPDATE b SET x = 1"),
			],
		});

		const now = make("a case", {
			effects: [
				write("UPDATE a SET x = 1"),
				write("UPDATE b SET x = 1"),
				email(),
			],
		});

		expect(compareCase(was, now).shifts[0]).toMatchObject({
			from: "between the first and last write",
			to: "after the last write",
		});
	});

	it("a write that became a read-only statement moves the email into a step with no write", () => {
		const got = compare(after([read("SELECT 1"), email()]));

		expect(got.shifts[0]).toMatchObject({
			from: "after the last write",
			to: "in a step with no write",
		});
	});

	it("a failed write and a rolled-back batch are not writes", () => {
		const was = make("a case", {
			effects: [
				write("UPDATE items SET v = 1", { outcome: { threw: "d1 down" } }),
				email(),
			],
		});

		const now = make("a case", {
			effects: [
				{
					kind: "d1-batch",
					db: "MUSIC_DB",
					result: "rolled-back",
					error: "x",
					statements: [
						{
							sql: "UPDATE items SET v = 1",
							args: [],
							outcome: { threw: "x" },
						},
					],
					step: 0,
					phase: "request",
				},
				email(),
			],
		});

		expect(compareCase(was, now).shifts).toEqual([]);
	});

	it("moving D1 reads around without moving a write is not a shift", () => {
		const got = compare(
			after([
				write("UPDATE items SET value = 'b'"),
				read("SELECT 1"),
				read("SELECT 2"),
				email(),
			]),
		);

		expect(got.shifts).toEqual([]);
	});
});

describe("isWriteSql", () => {
	it.each([
		["INSERT INTO t VALUES (1)", true],
		["  update t set a = 1", true],
		["DELETE FROM t", true],
		["REPLACE INTO t VALUES (1)", true],
		["CREATE TABLE t (a)", true],
		["-- note\nUPDATE t SET a = 1", true],
		["WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", true],
		["SELECT replace(a, 'x', 'y') FROM t", false],
		["SELECT updated_at FROM t WHERE a = 'delete me'", false],
		["WITH x AS (SELECT 1) SELECT * FROM x", false],
	])("%s", (sql, expected) => {
		expect(isWriteSql(sql)).toBe(expected);
	});
});

describe("compareFixture", () => {
	const named = (name: string, over = {}) => make(name, over);

	it("counts identical, D1-only and non-neutral cases", () => {
		const before = [named("a"), named("b"), named("c")];

		const after = [
			named("a"),
			named("b", { effects: [write("UPDATE items SET value = 'b'"), email()] }),
			named("c", { answer: answer({ status: 500 }) }),
		];

		const result = compareFixture(before, after);

		expect(result.identical).toEqual(["a"]);
		expect(result.d1Only).toEqual(["b"]);
		expect(result.nonNeutral.map((item) => item.name)).toEqual(["c"]);
		expect(result.neutral).toBe(false);
	});

	it("is neutral when every case is identical or D1-only", () => {
		const result = compareFixture(
			[named("a"), named("b")],
			[
				named("a"),
				named("b", { effects: [write("UPDATE items SET a = 1"), email()] }),
			],
		);

		expect(result.neutral).toBe(true);
	});

	it("an added case is reported and does not fail", () => {
		const result = compareFixture([named("a")], [named("a"), named("new")]);

		expect(result.added).toEqual(["new"]);
		expect(result.neutral).toBe(true);
	});

	it("a removed case is not neutral", () => {
		const result = compareFixture([named("a"), named("gone")], [named("a")]);

		expect(result.removed).toEqual(["gone"]);
		expect(result.neutral).toBe(false);
	});

	it("a renamed case without a mapping is a removed one and an added one", () => {
		const result = compareFixture([named("old")], [named("new")]);

		expect(result.removed).toEqual(["old"]);
		expect(result.added).toEqual(["new"]);
		expect(result.neutral).toBe(false);
	});

	it("a renamed case with a mapping is compared as a pair, and is neutral when the pair is", () => {
		const result = compareFixture([named("old")], [named("new")], {
			renames: { old: "new" },
		});

		expect(result.renamed).toEqual([
			{ from: "old", to: "new", status: "identical" },
		]);

		expect(result.removed).toEqual([]);
		expect(result.added).toEqual([]);
		expect(result.neutral).toBe(true);
	});

	it("a renamed pair that is not neutral fails, and is listed under both names", () => {
		const result = compareFixture(
			[named("old")],
			[named("new", { answer: answer({ status: 500 }) })],
			{ renames: { old: "new" } },
		);

		expect(result.nonNeutral[0]?.name).toBe("old -> new");
		expect(result.neutral).toBe(false);
	});

	it("a mapping that names no case, or a name taken twice, is an error", () => {
		expect(() =>
			compareFixture([named("a")], [named("b")], { renames: { zzz: "b" } }),
		).toThrow(/names no case in the earlier revision/);

		expect(() =>
			compareFixture([named("a")], [named("b")], { renames: { a: "zzz" } }),
		).toThrow(/names no case in the later revision/);

		expect(() =>
			compareFixture([named("a"), named("b")], [named("b")], {
				renames: { a: "b" },
			}),
		).toThrow(/earlier revision has that name too/);
	});

	describe("the relative-position class", () => {
		const moved = [named("mail"), named("other")];

		const movedAfter = [
			named("mail", {
				effects: [email(), write("UPDATE items SET value = 'b'")],
			}),
			named("other"),
		];

		it("fails when the case is not allowed", () => {
			const result = compareFixture(moved, movedAfter);

			expect(result.shifted).toHaveLength(1);
			expect(result.shifted[0]?.reason).toBeNull();
			expect(result.neutral).toBe(false);
		});

		it("passes when the case is allowed with a reason", () => {
			const result = compareFixture(moved, movedAfter, {
				allowShifts: {
					mail: "the mail now waits for the claim, owner decided 2026-11-13",
				},
			});

			expect(result.shifted[0]?.reason).toContain("owner decided");
			expect(result.neutral).toBe(true);
		});

		it("an allowance with no reason is an error", () => {
			expect(() =>
				compareFixture(moved, movedAfter, { allowShifts: { mail: " " } }),
			).toThrow(/has no reason/);
		});

		it("an allowance for a case that did not move fails, so the list cannot go stale", () => {
			const result = compareFixture(moved, moved, {
				allowShifts: { other: "stale" },
			});

			expect(result.unusedAllowances).toEqual(["other"]);
			expect(result.neutral).toBe(false);
		});
	});
});

describe("golden:neutral on the command line", () => {
	const folder = mkdtempSync(join(tmpdir(), "golden-neutral-"));
	const fixtures = join(folder, "tests/golden/fixtures");

	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: folder, stdio: "ignore" });

	const save = (fixture: string, cases: Json[]) =>
		writeFileSync(
			join(fixtures, `${fixture}.json.gz`),
			gzipSync(JSON.stringify(cases)),
		);

	const script = fileURLToPath(
		new URL("../../scripts/golden-neutral.mjs", import.meta.url),
	);

	const run = (...args: string[]) =>
		spawnSync(process.execPath, [script, ...args], {
			cwd: folder,
			encoding: "utf8",
		});

	mkdirSync(fixtures, { recursive: true });

	for (const args of [
		["init", "-q"],
		["config", "user.email", "test@example.test"],
		["config", "user.name", "Test"],
		["config", "commit.gpgsign", "false"],
	])
		git(...args);

	save("one", [make("a"), make("b")]);
	save("two", [make("c")]);
	git("add", "-A");
	git("commit", "-q", "-m", "before");
	git("tag", "before");

	save("one", [
		make("a", { effects: [write("UPDATE items SET value = ?"), email()] }),
		make("b2"),
	]);

	save("two", [make("c", { answer: answer({ status: 500 }) })]);
	git("add", "-A");
	git("commit", "-q", "-m", "after");

	writeFileSync(
		join(folder, "renames.json"),
		JSON.stringify({ one: { b: "b2" } }),
	);

	writeFileSync(join(folder, "empty.json"), "{}");

	afterAll(() => rmSync(folder, { recursive: true, force: true }));

	it("exits 0 and says NEUTRAL when every case is neutral (a rename mapped)", () => {
		const got = run("one", "before", "HEAD", "--allow-renames", "renames.json");

		expect(got.status).toBe(0);
		expect(got.stdout).toContain(
			"1 identical, 1 neutral with D1 changes, 0 NOT neutral",
		);
		expect(got.stdout).toContain("renamed case: b -> b2 (identical)");
		expect(got.stdout).toContain("golden:neutral: NEUTRAL");
	});

	it("exits 1 for a removed case when the rename is not mapped", () => {
		const got = run("one", "before", "HEAD");

		expect(got.status).toBe(1);
		expect(got.stdout).toContain("removed case (NOT neutral): b");
	});

	it("--all runs every fixture, prints the first differing field and exits 1", () => {
		const got = run(
			"--all",
			"before",
			"HEAD",
			"--allow-renames",
			"renames.json",
		);

		expect(got.status).toBe(1);
		expect(got.stdout).toContain(
			"two: 0 identical, 0 neutral with D1 changes, 1 NOT neutral",
		);
		expect(got.stdout).toContain("case.steps[0].answer.status");
		expect(got.stdout).toContain("2 of 2 fixtures differ");
	});

	it("--all leaves out a fixture that did not change", () => {
		const got = run("--all", "HEAD", "HEAD");

		expect(got.status).toBe(0);
		expect(got.stdout).toContain("0 of 2 fixtures differ");
	});

	it("exits 2 with a message for a bad revision, a bad allow file and a missing argument", () => {
		expect(run("one", "no-such-branch").status).toBe(2);
		expect(run("one", "--allow-renames").status).toBe(2);
		expect(
			run("one", "before", "HEAD", "--allow-renames", "missing.json").stderr,
		).toContain("cannot read");
		expect(run().status).toBe(2);
	});
});
