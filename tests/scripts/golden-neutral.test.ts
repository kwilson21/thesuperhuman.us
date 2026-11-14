import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { JsonObject, JsonValue } from "../helpers/json";
import { compareCase, compareFixture } from "../../scripts/golden-neutral.mjs";
import { statementOf } from "../../scripts/sql-effects.mjs";

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

		expect(got).toEqual({ status: "d1-only" });
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

describe("compareCase: the state when an outside effect happened", () => {
	/** A format 3 case: every outside effect carries the digest of the databases as they were when it happened. */
	const stated = (effects: Json[], over: Json = {}) => ({
		...make("a case", { effects }),
		format: 3,
		...over,
	});

	const at = (music: string) => ({ state: { music, publication: "p" } });

	it("two writes to the same table that swap places around an email are not neutral, though the end state is the same", () => {
		// "mark as sent, then send" against "send, then mark as sent".
		const markThenSend = stated([
			write("UPDATE a SET y = 1"),
			email(at("after-y")),
			write("UPDATE a SET x = 1"),
		]);

		const sendThenMark = stated([
			write("UPDATE a SET x = 1"),
			email(at("after-x")),
			write("UPDATE a SET y = 1"),
		]);

		const got = compareCase(markThenSend, sendThenMark);

		expect(got.status).toBe("non-neutral");
		expect(got.difference?.area).toContain("a write moved or changed");
		expect(got.difference?.path).toBe("effects(without D1)[0].state.music");
		expect(got.difference?.effect).toBe(
			"fetch POST https://api.resend.com/emails (step 0, request)",
		);
	});

	it("an email moved before a write is not neutral", () => {
		const was = stated([write("UPDATE a SET x = 1"), email(at("written"))]);
		const now = stated([email(at("start")), write("UPDATE a SET x = 1")]);

		expect(compareCase(was, now).status).toBe("non-neutral");
	});

	it("any other outside effect carries the state too: an R2 or KV call or a console line", () => {
		const r2 = (music: string) => ({
			kind: "r2",
			bucket: "AUDIO",
			op: "put",
			key: "k",
			detail: null,
			step: 0,
			phase: "request",
			...at(music),
		});

		expect(compareCase(stated([r2("one")]), stated([r2("two")])).status).toBe(
			"non-neutral",
		);
	});

	it("a write that moved across the response boundary leaves a different database at the response", () => {
		const response = (music: string) => ({
			steps: [
				{
					...base.steps[0],
					digest: {
						music: "end",
						publication: "p",
						r2: "r",
						kv: "k",
						atResponse: { music, publication: "p" },
					},
				},
			],
		});

		const got = compareCase(
			stated(
				[write("UPDATE a SET x = 1"), email(at("same"))],
				response("written"),
			),
			stated(
				[
					write("UPDATE a SET x = 1", { phase: "background" }),
					email(at("same")),
				],
				response("not yet written"),
			),
		);

		expect(got.status).toBe("non-neutral");
		expect(got.difference?.area).toBe("table, R2 and KV digests");
		expect(got.difference?.path).toBe("case.steps[0].digest.atResponse.music");
	});

	it("one UPDATE replaced by a DELETE and an INSERT of the same row is neutral when every state is the same", () => {
		const was = stated([
			write("UPDATE a SET x = 1 WHERE id = 1"),
			email(at("s")),
		]);

		const now = stated([
			write("DELETE FROM a WHERE id = 1"),
			write("INSERT INTO a (id, x) VALUES (1, 1)"),
			email(at("s")),
		]);

		expect(compareCase(was, now).status).toBe("d1-only");
	});

	it("INSERT OR REPLACE in place of an INSERT and an UPDATE is neutral when every state is the same", () => {
		const was = stated([
			write("INSERT INTO a (id, x) VALUES (1, 1) ON CONFLICT DO NOTHING"),
			write("UPDATE a SET x = 1 WHERE id = 1"),
			email(at("s")),
		]);

		const now = stated([
			write("INSERT OR REPLACE INTO a (id, x) VALUES (1, 1)"),
			email(at("s")),
		]);

		expect(compareCase(was, now).status).toBe("d1-only");
	});

	it("an upsert turned into an UPDATE is neutral when every state is the same", () => {
		const was = stated([
			write(
				"INSERT INTO a (id, x) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET x = 1",
			),
			email(at("s")),
		]);

		const now = stated([
			write("UPDATE a SET x = 1 WHERE id = 1"),
			email(at("s")),
		]);

		expect(compareCase(was, now).status).toBe("d1-only");
	});

	it("reads, zero-row writes and the split of a statement into a read and a guarded write are neutral", () => {
		const was = stated([write("UPDATE a SET x = 1"), email(at("s"))]);

		const now = stated([
			read("SELECT x FROM a WHERE id = ?"),
			write("UPDATE a SET x = 1 WHERE 0", { outcome: { rows: 0, changes: 0 } }),
			write("UPDATE a SET x = 1 WHERE id = ? AND x IS NULL"),
			email(at("s")),
		]);

		expect(compareCase(was, now).status).toBe("d1-only");
	});

	it("writes to different tables between the same two effects may be reordered", () => {
		const was = stated([
			write("UPDATE a SET x = 1"),
			write("UPDATE b SET x = 1"),
			email(at("s")),
		]);

		const now = stated([
			write("UPDATE b SET x = 1"),
			write("UPDATE a SET x = 1"),
			email(at("s")),
		]);

		expect(compareCase(was, now).status).toBe("d1-only");
	});

	it("an effect in an older recorder case (no kind, no D1) is read too", () => {
		const legacy = (extra: Json = {}): Json => ({
			name: "legacy",
			answers: [{ outcome: "response", status: 200, headers: {}, body: "" }],
			effects: [
				{ step: 0, kv: "RATE_LIMIT", op: "get", key: "k", type: null },
				{
					step: 0,
					fetch: { url: "https://api.resend.com/emails", method: "POST" },
				},
			],
			...extra,
		});

		expect(compareCase(legacy(), legacy()).status).toBe("identical");

		const got = compareCase(
			legacy(),
			legacy({ effects: [{ step: 0, kv: "RATE_LIMIT", op: "put", key: "k" }] }),
		);

		expect(got.status).toBe("non-neutral");
	});

	it("a trigger that, after a conversion, hits a different table or a read is not neutral", () => {
		const marker = (extra: Json = {}) => ({
			kind: "trigger-hit",
			trigger: "failure",
			name: "d1 down",
			db: "MUSIC_DB",
			hits: [{ op: "UPDATE", table: "a", access: "write" }],
			step: 0,
			phase: "request",
			...extra,
		});

		const was = stated([marker(), write("UPDATE a SET x = 1")]);

		expect(
			compareCase(
				was,
				stated([
					marker({ hits: [{ op: "SELECT", table: "a", access: "read" }] }),
				]),
			).status,
		).toBe("non-neutral");

		expect(
			compareCase(
				was,
				stated([
					marker({ hits: [{ op: "UPDATE", table: "audit", access: "write" }] }),
				]),
			).status,
		).toBe("non-neutral");
	});
});

describe("compareCase: the fixture format", () => {
	const v2 = (extra: Json = {}) => ({ ...base, format: 2, ...extra });

	it("format 1 against format 2 is not comparable", () => {
		const got = compareCase(base, v2());

		expect(got.status).toBe("not-comparable");
		expect(got.difference).toMatchObject({ expected: 1, actual: 2 });
	});

	it("two format 2 cases are compared, digests included", () => {
		const step = (digest: string) => ({
			...base.steps[0],
			digest: { music: digest },
		});

		const got = compareCase(
			v2({ steps: [step("a")] }),
			v2({ steps: [step("b")] }),
		);

		expect(got.status).toBe("non-neutral");
		expect(got.difference?.area).toBe("table, R2 and KV digests");
	});

	it("a changed final digest of an undumped table is not neutral", () => {
		const final = (sha: string) =>
			v2({
				finalState: {
					music: {
						sha256: "x",
						tables: { audit_log: { rows: 1, sha256: sha } },
					},
				},
			});

		expect(compareCase(final("a"), final("b")).difference?.area).toBe(
			"table, R2 and KV digests",
		);
	});
});

describe("statementOf", () => {
	it.each([
		["INSERT INTO t VALUES (1)", "INSERT", "t", true],
		['INSERT OR IGNORE INTO "t" (a) VALUES (1)', "INSERT", "t", true],
		["  update t set a = 1", "UPDATE", "t", true],
		["UPDATE OR ROLLBACK t SET a = 1", "UPDATE", "t", true],
		["DELETE FROM t WHERE a = 1", "DELETE", "t", true],
		["REPLACE INTO t VALUES (1)", "REPLACE", "t", true],
		["WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "INSERT", "t", true],
		["SELECT a FROM t JOIN u ON t.a = u.a", "SELECT", "t", false],
		["SELECT replace(a, 'x', 'y') FROM t", "SELECT", "t", false],
		["WITH x AS (SELECT 1) SELECT * FROM x", "SELECT", "x", false],
		["SELECT 1", "SELECT", null, false],
		["-- note\nUPDATE t SET a = 'delete from nothing'", "UPDATE", "t", true],
	])("%s", (sql, op, table, write) => {
		expect(statementOf(sql)).toEqual({ op, table, write });
	});

	it("a write whose table cannot be read throws, never a shared unknown table", () => {
		expect(() => statementOf("UPDATE")).toThrow(/cannot read the table/);
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

	it("a rename map must name real cases and keep every old name's case", () => {
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
		).toThrow(/earlier revision has a case of that name too/);

		expect(() =>
			compareFixture([named("a")], [named("a"), named("b")], {
				renames: { a: "b" },
			}),
		).toThrow(/later revision still has a case of that name/);
	});

	it("two old cases mapped to one new case is an error, since one would be hidden", () => {
		expect(() =>
			compareFixture([named("a"), named("b")], [named("z")], {
				renames: { a: "z", b: "z" },
			}),
		).toThrow(/two earlier cases are mapped to it/);
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

	const file = (name: string, content: JsonValue) =>
		writeFileSync(join(folder, name), JSON.stringify(content));

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
	save("three", [{ ...make("d"), format: 1 }]);
	save("empty", []);
	git("add", "-A");
	git("commit", "-q", "-m", "before");
	git("tag", "before");

	save("one", [
		make("a", { effects: [write("UPDATE items SET value = ?"), email()] }),
		make("b2"),
	]);

	save("two", [make("c", { answer: answer({ status: 500 }) })]);
	save("three", [{ ...make("d"), format: 2 }]);
	git("add", "-A");
	git("commit", "-q", "-m", "after");

	file("renames.json", { one: { b: "b2" } });
	file("array.json", [1]);
	file("unknown-fixture.json", { nosuch: { x: "y" } });
	file("shape.json", { one: { a: "not an object" } });

	afterAll(() => rmSync(folder, { recursive: true, force: true }));

	const mapped = ["--allow-renames", "renames.json"];

	it("exits 0 and says NEUTRAL when every case is neutral (a rename mapped), with both commits and the counts", () => {
		const got = run("one", "before", "HEAD", ...mapped);

		expect(got.status).toBe(0);
		expect(got.stdout).toMatch(
			/from before \([0-9a-f]{12}\) to HEAD \([0-9a-f]{12}\)/,
		);
		expect(got.stdout).toContain(
			"1 identical, 1 neutral with D1 changes, 0 NOT neutral",
		);
		expect(got.stdout).toContain("renamed case: b -> b2 (identical)");
		expect(got.stdout).toContain("compared 1 fixture and 2 cases");
		expect(got.stdout).toContain("golden:neutral: NEUTRAL");
	});

	it("exits 1 for a removed case when the rename is not mapped", () => {
		const got = run("one", "before", "HEAD");

		expect(got.status).toBe(1);
		expect(got.stdout).toContain("removed case (NOT neutral): b");
	});

	it("--all runs every fixture, prints the first differing field and exits 1", () => {
		const got = run("--all", "before", "HEAD", ...mapped);

		expect(got.status).toBe(1);
		expect(got.stdout).toContain(
			"two: 0 identical, 0 neutral with D1 changes, 1 NOT neutral",
		);
		expect(got.stdout).toContain("case.steps[0].answer.status");
	});

	it("format 1 against format 2 is NOT COMPARABLE: loud, and exit 1", () => {
		const got = run("three", "before", "HEAD");

		expect(got.status).toBe(1);
		expect(got.stdout).toContain("NOT COMPARABLE");
		expect(got.stdout).toContain(
			"neutrality cannot be shown across a format change",
		);
		expect(got.stdout).toContain("golden:neutral: NOT NEUTRAL");
	});

	it("a fixture identical in both revisions says so and exits 0", () => {
		const got = run("one", "HEAD", "HEAD");

		expect(got.status).toBe(0);
		expect(got.stdout).toContain("golden:neutral: identical, 2 cases");
	});

	it("--all leaves out a fixture that did not change", () => {
		const got = run("--all", "HEAD", "HEAD");

		expect(got.status).toBe(0);
		expect(got.stdout).toContain("0 of 4 fixtures differ");
	});

	it("refuses a fixture name that exists in neither revision (a misspelling)", () => {
		const got = run("onne", "before", "HEAD");

		expect(got.status).toBe(2);
		expect(got.stderr).toContain('no fixture named "onne" in either revision');
	});

	it("refuses an unknown flag, such as a misspelled --all, and extra arguments", () => {
		expect(run("--al", "before", "HEAD").status).toBe(2);
		expect(run("one", "before", "HEAD", "--allow-position", "x").status).toBe(
			2,
		);
		expect(run("one", "before", "HEAD", "extra").status).toBe(2);
		expect(run("--all", "before", "HEAD", "extra").status).toBe(2);
		expect(run("one", "before", "--all").status).toBe(2);
	});

	it("refuses a revision that does not resolve", () => {
		const got = run("one", "no-such-branch", "HEAD");

		expect(got.status).toBe(2);
		expect(got.stderr).toContain('"no-such-branch" is not a revision');
	});

	it("exits 2 when no case was compared (an empty fixture)", () => {
		const got = run("empty", "before", "HEAD");

		expect(got.status).toBe(2);
		expect(got.stderr).toContain("no case was compared");
	});

	it("refuses a rename file that is an array, has a wrong shape or cannot be read", () => {
		for (const name of ["array.json", "shape.json"])
			expect(run("one", "before", "HEAD", "--allow-renames", name).status).toBe(
				2,
			);

		expect(
			run("one", "before", "HEAD", "--allow-renames", "missing.json").stderr,
		).toContain("cannot read");
	});

	it("refuses a rename file that names a fixture that was not compared, in both modes", () => {
		for (const args of [
			["one", "before", "HEAD"],
			["--all", "before", "HEAD"],
		]) {
			const got = run(...args, "--allow-renames", "unknown-fixture.json");

			expect(got.status).toBe(2);
			expect(got.stderr).toContain("is not a fixture that was compared");
		}

		expect(
			run("two", "before", "HEAD", "--allow-renames", "renames.json").status,
		).toBe(2);
	});

	it("the position allowance of an earlier version is an unknown flag now", () => {
		expect(
			run("one", "before", "HEAD", "--allow-positions", "renames.json").status,
		).toBe(2);
	});

	it("exits 2 with a message when there is no argument", () => {
		expect(run().status).toBe(2);
	});
});
