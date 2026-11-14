import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { digestDatabase } from "./digest";
import { freshMusicDb, freshPublicationDb } from "./db";
import { asVisitor, runCase, type Case, type Handler } from "./index";

// Every table of every database is digested after each step and at the end of a case, so a write to a table the case
// does not dump still shows in the record.

const env = (context: APIContext) => context.locals.runtime.env;

const case1 = (extra: Partial<Case> = {}): Case => ({
	name: "digest case",
	steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
	...extra,
});

const writing =
	(sql: string, ...args: (string | number)[]): Handler =>
	async (context) => {
		await env(context)
			.MUSIC_DB?.prepare(sql)
			.bind(...args)
			.run();

		return new Response("ok");
	};

const idle: Handler = () => new Response("ok");

describe("digestDatabase", () => {
	it("is the same for the same rows and lists only tables that hold rows", () => {
		const a = freshMusicDb();
		const b = freshMusicDb();

		expect(digestDatabase(a)).toEqual(digestDatabase(b));
		expect(Object.keys(digestDatabase(a).tables)).toEqual([
			"software_signing_settings",
		]);
	});

	it("changes when a row is added to any table, however obscure", () => {
		const sqlite = freshMusicDb();
		const before = digestDatabase(sqlite);

		sqlite
			.prepare(
				"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('r', 's', 1)",
			)
			.run();

		const after = digestDatabase(sqlite);

		expect(after.sha256).not.toBe(before.sha256);
		expect(after.tables.brief_suggestion_budget?.rows).toBe(1);
	});

	it("changes when a single column of a single row changes, and reads null, numbers, text and blobs apart", () => {
		const sqlite = freshPublicationDb();
		sqlite.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, v)");

		const digests = new Set<string>();

		for (const value of ["NULL", "1", "'1'", "1.5", "''", "x'31'", "'a;'"]) {
			sqlite.exec(`DELETE FROM probe; INSERT INTO probe VALUES (1, ${value})`);
			digests.add(digestDatabase(sqlite).tables.probe?.sha256 ?? "");
		}

		expect(digests.size).toBe(7);
	});

	it("does not depend on the order rows were inserted in, only on their primary keys", () => {
		const one = freshPublicationDb();
		const two = freshPublicationDb();

		for (const sqlite of [one, two])
			sqlite.exec("CREATE TABLE probe (id TEXT PRIMARY KEY, v)");

		one.exec(
			"INSERT INTO probe VALUES ('a', 1); INSERT INTO probe VALUES ('b', 2)",
		);
		two.exec(
			"INSERT INTO probe VALUES ('b', 2); INSERT INTO probe VALUES ('a', 1)",
		);

		expect(digestDatabase(one).sha256).toBe(digestDatabase(two).sha256);
	});
});

describe("the record of a case", () => {
	it("is format 2, with a digest per step and the final state of both databases, R2 and KV", async () => {
		const got = await runCase(idle, case1());

		expect(got.format).toBe(2);
		expect(Object.keys(got.steps[0]?.digest ?? {})).toEqual([
			"music",
			"publication",
			"r2",
			"kv",
		]);

		expect(Object.keys(got.finalState)).toEqual([
			"music",
			"publication",
			"r2",
			"kv",
		]);
	});

	it("shows a write to a table the case does not dump, at the step and at the end", async () => {
		const quiet = await runCase(idle, case1());

		const wrote = await runCase(
			writing(
				"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
				"r",
				"s",
				1,
			),
			case1(),
		);

		expect(wrote.steps[0]?.digest.music).not.toBe(quiet.steps[0]?.digest.music);
		expect(wrote.finalState.music.tables.brief_suggestion_budget?.rows).toBe(1);
		expect(wrote.steps[0]?.digest.publication).toBe(
			quiet.steps[0]?.digest.publication,
		);
	});

	it("shows an UPDATE that sets another column of an undumped table", async () => {
		const seeded = (handler: Handler) =>
			runCase(
				handler,
				case1({
					setup: (world) =>
						world.music.exec(
							"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('r', 's', 1)",
						),
				}),
			);

		const one = await seeded(
			writing(
				"UPDATE brief_suggestion_budget SET count = ? WHERE day = ?",
				2,
				"r",
			),
		);

		const two = await seeded(
			writing(
				"UPDATE brief_suggestion_budget SET scope = ? WHERE day = ?",
				"t",
				"r",
			),
		);

		expect(one.finalState.music.sha256).not.toBe(two.finalState.music.sha256);
	});

	it("shows a write that happens in the background after the response", async () => {
		const later: Handler = async (context) => {
			context.locals.runtime.ctx.waitUntil(
				(async () => {
					await env(context)
						.MUSIC_DB?.prepare(
							"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('r', 's', 1)",
						)
						.run();
				})(),
			);

			return new Response("ok");
		};

		const got = await runCase(later, case1());

		expect(got.finalState.music.tables.brief_suggestion_budget?.rows).toBe(1);
	});

	it("is identical across two runs, hooks and setup included", async () => {
		const c = case1({
			setup: (world) =>
				world.music.exec(
					"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('s', 's', 1)",
				),
			interleave: [
				{
					on: /INSERT INTO brief_suggestion_budget/,
					label: "a racing write",
					run: (sqlite) =>
						sqlite.exec(
							"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES ('race', 's', 1)",
						),
				},
			],
		});

		const handler = writing(
			"INSERT INTO brief_suggestion_budget (day, scope, count) VALUES (?, ?, ?)",
			"r",
			"s",
			1,
		);

		const first = await runCase(handler, c);
		const second = await runCase(handler, c);

		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		expect(first.finalState.music.tables.brief_suggestion_budget?.rows).toBe(3);
	});

	it("shows R2 and KV state", async () => {
		const puts: Handler = async (context) => {
			await env(context).AUDIO?.put("k", "v");
			await env(context).RATE_LIMIT?.put("k", "v");

			return new Response("ok");
		};

		const quiet = await runCase(idle, case1());
		const got = await runCase(puts, case1());

		expect(got.steps[0]?.digest.r2).not.toBe(quiet.steps[0]?.digest.r2);
		expect(got.steps[0]?.digest.kv).not.toBe(quiet.steps[0]?.digest.kv);
		expect(JSON.stringify(got.finalState.r2)).toContain('"k"');
	});
});

describe("trigger-hit markers", () => {
	const reads: Handler = async (context) => {
		try {
			await env(context)
				.MUSIC_DB?.prepare("SELECT id FROM owner_requests WHERE id = ?")
				.bind("r1")
				.all();
		} catch {
			return new Response("failed", { status: 500 });
		}

		return new Response("ok");
	};

	it("names what a failure hit by operation, table and access, and never the SQL or the pattern", async () => {
		const got = await runCase(
			reads,
			case1({ failures: [{ on: /FROM owner_requests/, message: "d1 down" }] }),
		);

		const marker = got.effects.find((effect) => effect.kind === "trigger-hit");

		expect(marker).toEqual({
			kind: "trigger-hit",
			trigger: "failure",
			name: "d1 down",
			db: "MUSIC_DB",
			hits: [{ op: "SELECT", table: "owner_requests", access: "read" }],
			step: 0,
			phase: "request",
		});

		expect(JSON.stringify(marker)).not.toContain("WHERE");
		expect(JSON.stringify(marker)).not.toContain("owner_requests/");
	});

	it("shows a trigger that, after a conversion, hits a different table or a read instead of a write", async () => {
		const hitting = async (sql: string) => {
			const got = await runCase(
				async (context) => {
					await env(context).MUSIC_DB?.prepare(sql).all();

					return new Response("ok");
				},
				case1({
					interleave: [{ on: /owner_requests/, label: "race", run: () => {} }],
				}),
			);

			return got.effects.find((effect) => effect.kind === "trigger-hit");
		};

		const write = await hitting(
			"UPDATE owner_requests SET status = 'x' WHERE 0",
		);

		const read = await hitting("SELECT * FROM owner_requests");

		expect(write).toMatchObject({ hits: [{ op: "UPDATE", access: "write" }] });
		expect(read).toMatchObject({ hits: [{ op: "SELECT", access: "read" }] });
	});
});

describe("must-not-fire triggers", () => {
	const reads: Handler = async (context) => {
		await env(context).MUSIC_DB?.prepare("SELECT id FROM owner_requests").all();

		return new Response("ok");
	};

	const control = (on: RegExp) =>
		case1({
			failures: [{ on, message: "boom" }],
			mustNotFire: [
				{
					trigger: `d1 failure on ${on}`,
					reason: "a control that proves it is never reached",
				},
			],
		});

	it("passes when the trigger stays quiet", async () => {
		await expect(
			runCase(reads, control(/DELETE FROM nothing/)),
		).resolves.toBeDefined();
	});

	it("fails when the trigger fires", async () => {
		await expect(
			runCase(reads, control(/FROM owner_requests/)),
		).rejects.toThrow("declared never to fire");
	});

	it("fails for a blank reason or a trigger the case does not declare", async () => {
		await expect(
			runCase(
				reads,
				case1({
					mustNotFire: [{ trigger: "d1 failure on /x/", reason: "why" }],
				}),
			),
		).rejects.toThrow("matches no declared trigger");
	});
});
