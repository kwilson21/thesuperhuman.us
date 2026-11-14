import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { measureOf, verifyCount } from "./d1";
import { DatabaseDigester, digestDatabase } from "./digest";
import { freshMusicDb, freshPublicationDb } from "./db";
import {
	asVisitor,
	byHost,
	json,
	runCase,
	type Case,
	type Handler,
} from "./index";

// Every table of every database is digested after each step and at the end of a case, so a write to a table the case
// does not dump still shows in the record.

const env = (context: APIContext) => context.locals.runtime.env;

const mailOk = byHost({ resend: json(200, {}) });

const case1 = (extra: Partial<Case> = {}): Case => ({
	name: "digest case",
	fetches: mailOk,
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
		expect(Object.keys(digestDatabase(a).tables)).toContain(
			"software_signing_settings",
		);
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
	it("is format 4, with a digest per step and the final state of both databases, R2 and KV", async () => {
		const got = await runCase(idle, case1());

		expect(got.format).toBe(4);
		expect(Object.keys(got.steps[0]?.digest ?? {})).toEqual([
			"music",
			"publication",
			"r2",
			"kv",
			"atResponse",
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

describe("the state at every outside effect", () => {
	const settings = (sql: string) =>
		`UPDATE software_signing_settings SET ${sql}`;

	/** Two writes with an outgoing email between them. */
	const around =
		(before: string, after: string): Handler =>
		async (context) => {
			await env(context).MUSIC_DB?.prepare(before).run();
			await fetch("https://api.resend.com/emails", {
				method: "POST",
				body: "{}",
			});
			await env(context).MUSIC_DB?.prepare(after).run();

			return new Response("ok");
		};

	const mail = (got: Awaited<ReturnType<typeof runCase>>) =>
		got.effects.find((effect) => effect.kind === "fetch");

	it("two writes to the same table that swap places around an email leave the same end state and a different state at the email", async () => {
		const x = settings("updated_by = 'x'");
		const y = settings("software_signing_enabled = 1");

		const sendThenMark = await runCase(around(x, y), case1());
		const markThenSend = await runCase(around(y, x), case1());

		expect(sendThenMark.finalState.music.sha256).toBe(
			markThenSend.finalState.music.sha256,
		);
		expect(sendThenMark.steps[0]?.digest.music).toBe(
			markThenSend.steps[0]?.digest.music,
		);
		expect(mail(sendThenMark)?.state?.music).not.toBe(
			mail(markThenSend)?.state?.music,
		);
	});

	it("an outside effect carries the state of both databases; a D1 entry and a marker do not", async () => {
		const got = await runCase(
			around(settings("updated_by = 'x'"), settings("updated_by = 'y'")),
			case1({
				interleave: [{ on: /updated_by = 'y'/, label: "race", run: () => {} }],
			}),
		);

		const kinds = got.effects.map((effect) => [
			effect.kind,
			effect.state !== undefined,
		]);

		expect(kinds).toContainEqual(["fetch", true]);
		expect(kinds).toContainEqual(["d1", false]);
		expect(kinds).toContainEqual(["interleave", false]);
		expect(kinds).toContainEqual(["trigger-hit", false]);
	});

	it("an effect that happens before any write has the state the case started in, and an unchanged database gives an unchanged digest", async () => {
		const got = await runCase(async () => {
			await fetch("https://api.resend.com/emails", {
				method: "POST",
				body: "a",
			});
			await fetch("https://api.resend.com/emails", {
				method: "POST",
				body: "b",
			});

			return new Response("ok");
		}, case1());

		const states = got.effects
			.filter((effect) => effect.kind === "fetch")
			.map((effect) => effect.state);

		expect(states[0]).toEqual(states[1]);
	});

	it("the state at the response is taken before background work runs", async () => {
		const later: Handler = async (context) => {
			context.locals.runtime.ctx.waitUntil(
				(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 5));
					await env(context)
						.MUSIC_DB?.prepare(settings("updated_by = 'later'"))
						.run();
				})(),
			);

			return new Response("ok");
		};

		const quiet = await runCase(idle, case1());
		const got = await runCase(later, case1());
		const digest = got.steps[0]?.digest;

		expect(digest?.atResponse.music).toBe(quiet.steps[0]?.digest.music);
		expect(digest?.music).not.toBe(digest?.atResponse.music);
	});
});

describe("digest precision", () => {
	const table = () => {
		const sqlite = freshPublicationDb();
		sqlite.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, v)");

		return sqlite;
	};

	const digestOf = (value: string) => {
		const sqlite = table();
		sqlite.exec(`INSERT INTO probe VALUES (1, ${value})`);

		return digestDatabase(sqlite).tables.probe?.sha256;
	};

	it("an integer and a real of the same value differ", () => {
		expect(digestOf("1")).not.toBe(digestOf("1.0"));
	});

	it("integers above 2 to the 53rd keep every digit and never throw", () => {
		expect(digestOf("9007199254740993")).not.toBe(digestOf("9007199254740992"));
		expect(digestOf("9223372036854775807")).toBeDefined();
		expect(digestOf("-9223372036854775808")).toBeDefined();
	});

	it("column names are part of the digest, so a schema difference cannot hide in an empty table", () => {
		const one = freshPublicationDb();
		const two = freshPublicationDb();

		one.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, a)");
		two.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, b)");

		expect(digestDatabase(one).sha256).not.toBe(digestDatabase(two).sha256);
	});

	it("AUTOINCREMENT counters (sqlite_sequence) are part of the state", () => {
		const one = freshPublicationDb();
		const two = freshPublicationDb();

		for (const sqlite of [one, two])
			sqlite.exec("CREATE TABLE seq (id INTEGER PRIMARY KEY AUTOINCREMENT, v)");

		one.exec("INSERT INTO seq (v) VALUES (1)");
		two.exec(
			"INSERT INTO seq (v) VALUES (1); DELETE FROM seq; INSERT INTO seq (v) VALUES (1)",
		);

		// The same rows in both tables except the id, which the counter explains.
		expect(Object.keys(digestDatabase(one).tables)).toContain(
			"sqlite_sequence",
		);
		expect(digestDatabase(one).sha256).not.toBe(digestDatabase(two).sha256);
	});

	it("negative zero, text that looks like a number and blobs are all told apart", () => {
		const seen = new Set(
			["-0.0", "0.0", "'0'", "x'30'", "NULL", "0"].map((value) =>
				digestOf(value),
			),
		);

		expect(seen.size).toBe(6);
	});
});

describe("the cached digest equals the full one", () => {
	it("after statements, exec, triggers, hooks and a schema change alike", () => {
		const sqlite = freshPublicationDb();
		const digester = new DatabaseDigester(sqlite);

		const agree = () =>
			expect(digester.current().sha256).toBe(digestDatabase(sqlite).sha256);

		agree();
		sqlite.exec(
			"CREATE TABLE a (id INTEGER PRIMARY KEY, v); CREATE TABLE log (n)",
		);
		agree();
		sqlite.exec(
			"CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO log VALUES (new.id); END",
		);
		agree();
		sqlite.prepare("INSERT INTO a (v) VALUES (?)").run(1);
		agree();
		agree();
		sqlite.exec("UPDATE a SET v = 2");
		agree();
		sqlite.exec("DELETE FROM log");
		agree();
		sqlite.exec("ALTER TABLE a ADD COLUMN w");
		agree();
		// An ignored INSERT moves the AUTOINCREMENT counter without changing a row.
		sqlite.exec(
			"CREATE TABLE seq (id INTEGER PRIMARY KEY AUTOINCREMENT, k UNIQUE)",
		);
		sqlite.exec("INSERT INTO seq (k) VALUES ('a')");
		agree();
		sqlite.exec("INSERT OR IGNORE INTO seq (k) VALUES ('a')");
		agree();
	});
});

describe("D1 change counts", () => {
	const effect = async (sql: string, via: "first" | "all" | "run") => {
		const got = await runCase(async (context) => {
			const statement = env(context).MUSIC_DB?.prepare(sql);

			await (via === "first"
				? statement?.first()
				: via === "all"
					? statement?.all()
					: statement?.run());

			return new Response("ok");
		}, case1());

		return got.effects.find((entry) => entry.kind === "d1");
	};

	it("a write run through first() or all() without RETURNING records its real row count, not null", async () => {
		const update = "UPDATE software_signing_settings SET updated_by = 'z'";

		for (const via of ["first", "all", "run"] as const)
			expect(await effect(update, via)).toMatchObject({
				outcome: { changes: 1 },
			});
	});

	it("a write that changes no row records 0, and a read records 0 even straight after a write", async () => {
		expect(
			await effect(
				"UPDATE software_signing_settings SET updated_by = 'z' WHERE 0",
				"first",
			),
		).toMatchObject({ outcome: { changes: 0 } });

		const got = await runCase(async (context) => {
			await env(context)
				.MUSIC_DB?.prepare(
					"UPDATE software_signing_settings SET updated_by = 'z'",
				)
				.run();

			await env(context)
				.MUSIC_DB?.prepare("SELECT * FROM software_signing_settings")
				.all();

			return new Response("ok");
		}, case1());

		const reads = got.effects.filter((entry) => entry.kind === "d1");

		expect(reads[1]).toMatchObject({ outcome: { changes: 0 } });
	});

	it("a batch statement that returns rows records its real count too", async () => {
		const got = await runCase(async (context) => {
			const db = env(context).MUSIC_DB;

			await db?.batch([
				db.prepare(
					"UPDATE software_signing_settings SET updated_by = 'z' RETURNING id",
				),
				db.prepare("SELECT id FROM software_signing_settings"),
			]);

			return new Response("ok");
		}, case1());

		const batch = got.effects.find((entry) => entry.kind === "d1-batch");

		expect(batch).toMatchObject({
			statements: [{ outcome: { changes: 1 } }, { outcome: { changes: 0 } }],
		});
	});
});

describe("D1 change counts under parallel calls", () => {
	it("a read that runs beside a write is recorded with its own count, not the write's", async () => {
		const got = await runCase(async (context) => {
			const db = env(context).MUSIC_DB;

			await Promise.all([
				db?.prepare("SELECT * FROM software_signing_settings").all(),
				db
					?.prepare("UPDATE software_signing_settings SET updated_by = 'z'")
					.run(),
			]);

			return new Response("ok");
		}, case1());

		const counts = got.effects
			.filter((entry) => entry.kind === "d1")
			.map((entry) => [entry.sql.split(" ")[0], entry.outcome]);

		expect(counts).toEqual([
			["SELECT", { rows: 1, changes: 0 }],
			["UPDATE", { rows: 0, changes: 1 }],
		]);
	});

	it("two writes that run beside each other each keep their own count", async () => {
		const got = await runCase(async (context) => {
			const db = env(context).MUSIC_DB;

			await Promise.all([
				db
					?.prepare(
						"UPDATE software_signing_settings SET updated_by = 'a' RETURNING id",
					)
					.first(),
				db
					?.prepare(
						"UPDATE software_signing_settings SET updated_by = 'b' WHERE 0",
					)
					.all(),
			]);

			return new Response("ok");
		}, case1());

		const counts = got.effects
			.filter((entry) => entry.kind === "d1")
			.map((entry) =>
				"changes" in entry.outcome ? entry.outcome.changes : -1,
			);

		expect(counts).toEqual([1, 0]);
	});
});

describe("KV state", () => {
	it("holds each key's expiry and metadata, so a TTL change shows in state and not only in the log", async () => {
		const putting = (options: { expirationTtl?: number; metadata?: string }) =>
			runCase(async (context) => {
				await env(context).RATE_LIMIT?.put("k", "v", options);

				return new Response("ok");
			}, case1());

		const short = await putting({ expirationTtl: 60 });
		const long = await putting({ expirationTtl: 3600 });
		const meta = await putting({ expirationTtl: 60, metadata: "m" });

		expect(short.steps[0]?.digest.kv).not.toBe(long.steps[0]?.digest.kv);
		expect(short.steps[0]?.digest.kv).not.toBe(meta.steps[0]?.digest.kv);
		expect(JSON.stringify(short.finalState.kv)).toContain("expiresAt");
	});
});

describe("the verification of recorded change counts", () => {
	const table = () => {
		const sqlite = freshMusicDb();

		return sqlite;
	};

	it("a read must be recorded as 0 and measure 0", () => {
		const sqlite = table();

		expect(() => verifyCount(sqlite, "SELECT 1", 0, 0)).not.toThrow();
		expect(() => verifyCount(sqlite, "SELECT 1", 1, 0)).toThrow(
			/does not agree/,
		);
		expect(() => verifyCount(sqlite, "SELECT 1", 0, 1)).toThrow(
			/does not agree/,
		);
	});

	it("a write on a plain table must be recorded as exactly the rows SQLite counted", () => {
		const sqlite = table();
		const update = "UPDATE software_signing_settings SET updated_by = 'z'";

		expect(() => verifyCount(sqlite, update, 1, 1)).not.toThrow();
		expect(() => verifyCount(sqlite, update, 0, 1)).toThrow(/does not agree/);
		expect(() => verifyCount(sqlite, update, 2, 1)).toThrow(/does not agree/);
	});

	it("a write on a table with a trigger may be counted higher by SQLite, but a row must have changed exactly when SQLite says so", () => {
		const sqlite = table();
		const remove = "DELETE FROM music_events WHERE session_id = 's'";

		expect(() => verifyCount(sqlite, remove, 1, 2)).not.toThrow();
		expect(() => verifyCount(sqlite, remove, 0, 2)).toThrow(/does not agree/);
		expect(() => verifyCount(sqlite, remove, 3, 2)).toThrow(/does not agree/);
		expect(() => verifyCount(sqlite, remove, 0, 0)).not.toThrow();
	});

	it("a count that was not measured is an error, never a recorded 0", () => {
		expect(() => measureOf(undefined, "UPDATE a SET x = 1")).toThrow(
			/no change count was measured/,
		);
		expect(
			measureOf({ count: 2, delta: 0, tables: [] }, "UPDATE a SET x = 1").count,
		).toBe(2);
	});
});
