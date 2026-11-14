import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import {
	assertCompleteRecord,
	compareCase,
	UNSTATED_KINDS,
} from "../../../scripts/golden-neutral.mjs";
import { UNSTATED } from "./log";
import { asVisitor, byHost, json, runCase, type Handler } from "./index";

// Pairs of handlers recorded through the real harness and judged by golden:neutral: what a conversion must keep (the
// state when an outside effect happened) and what it may change (the statements that got there). Each pair writes the
// same final state; they differ in what is written before or after an email.

const env = (context: APIContext) => context.locals.runtime.env;

const TABLE = "brief_suggestion_budget";

/** A handler that runs these steps in order: a statement, or the email. */
const steps =
	(...list: ("email" | string)[]): Handler =>
	async (context) => {
		for (const step of list) {
			if (step === "email")
				await fetch("https://api.resend.com/emails", {
					method: "POST",
					body: "{}",
				});
			else await env(context).MUSIC_DB?.prepare(step).all();
		}

		return new Response("ok");
	};

const record = (handler: Handler) =>
	runCase(handler, {
		name: "pair",
		fetches: byHost({ resend: json(200, {}) }),
		setup: (world) =>
			world.music.exec(
				`INSERT INTO ${TABLE} (day, scope, count) VALUES ('d', 's', 1)`,
			),
		steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
	});

const verdict = async (before: Handler, after: Handler) =>
	compareCase(await record(before), await record(after)).status;

const SAME = "UPDATE software_signing_settings SET updated_by = 'migration'";
const LOCK = `INSERT INTO ${TABLE} (day, scope, count) VALUES ('lock', 'x', 1)`;
const UNLOCK = `DELETE FROM ${TABLE} WHERE day = 'lock'`;

const SET5 = `UPDATE ${TABLE} SET count = 5 WHERE day = 'd'`;
const DELETE = `DELETE FROM ${TABLE} WHERE day = 'd'`;
const INSERT5 = `INSERT INTO ${TABLE} (day, scope, count) VALUES ('d', 's', 5)`;

describe("what golden:neutral says about pairs recorded through the harness", () => {
	it("(a) a same-value UPDATE moved across an email is NOT neutral", async () => {
		expect(await verdict(steps(SAME, "email"), steps("email", SAME))).toBe(
			"non-neutral",
		);
	});

	it("(b) an insert and delete of a lock row moved wholly across an email is NOT neutral", async () => {
		expect(
			await verdict(steps(LOCK, UNLOCK, "email"), steps("email", LOCK, UNLOCK)),
		).toBe("non-neutral");

		// The lock held while the email went out is NOT neutral either.
		expect(
			await verdict(steps(LOCK, "email", UNLOCK), steps(LOCK, UNLOCK, "email")),
		).toBe("non-neutral");
	});

	it("(c1) one UPDATE rewritten as a DELETE and an INSERT of the same row is neutral", async () => {
		expect(
			await verdict(steps(SET5, "email"), steps(DELETE, INSERT5, "email")),
		).toBe("d1-only");
	});

	it("(c2) a DELETE and an INSERT rewritten as INSERT OR REPLACE is neutral", async () => {
		expect(
			await verdict(
				steps(DELETE, INSERT5, "email"),
				steps(
					`INSERT OR REPLACE INTO ${TABLE} (day, scope, count) VALUES ('d', 's', 5)`,
					"email",
				),
			),
		).toBe("d1-only");
	});

	it("(c3) an upsert turned into an UPDATE is neutral", async () => {
		expect(
			await verdict(
				steps(
					`INSERT INTO ${TABLE} (day, scope, count) VALUES ('d', 's', 5) ON CONFLICT (day, scope) DO UPDATE SET count = excluded.count`,
					"email",
				),
				steps(SET5, "email"),
			),
		).toBe("d1-only");
	});

	it("(d) a write that changes no row, moved across an email, is neutral: a limit, documented in the README", async () => {
		const none = `UPDATE ${TABLE} SET count = 9 WHERE day = 'nothing'`;

		expect(await verdict(steps(none, "email"), steps("email", none))).toBe(
			"d1-only",
		);
	});

	it("(e) an email moved past a read only is neutral: a limit, documented in the README", async () => {
		const read = `SELECT * FROM ${TABLE}`;

		expect(await verdict(steps(read, "email"), steps("email", read))).toBe(
			"d1-only",
		);
	});

	it("the same statements in the same places are identical", async () => {
		expect(await verdict(steps(SET5, "email"), steps(SET5, "email"))).toBe(
			"identical",
		);
	});

	it("an email that moved across a real write is NOT neutral (the digests see it)", async () => {
		expect(await verdict(steps(SET5, "email"), steps("email", SET5))).toBe(
			"non-neutral",
		);
	});
});

describe("touched is noted when the statement runs, and describes the same instant as the state", () => {
	const UPDATE = "UPDATE software_signing_settings SET updated_by = 'z'";

	const mailBeside =
		(statement: "mail first" | "write first"): Handler =>
		async (context) => {
			const mail = () =>
				fetch("https://api.resend.com/emails", { method: "POST", body: "{}" });

			const write = () => env(context).MUSIC_DB?.prepare(UPDATE).run();

			await Promise.all(
				statement === "mail first" ? [mail(), write()] : [write(), mail()],
			);

			return new Response("ok");
		};

	it.each(["mail first", "write first"] as const)(
		"with the email and the write called in parallel, %s, the state at the email and its touched set agree",
		async (order) => {
			const quiet = await record(steps());
			const got = await record(mailBeside(order));
			const mail = got.effects.find((effect) => effect.kind === "fetch");

			const changed = mail?.state?.music !== quiet.steps[0]?.digest.music;

			expect(changed).toBe(true);
			expect(mail?.state?.touched).toEqual(["software_signing_settings"]);
		},
	);

	it("a batch's tables are noted when the batch commits, not before, and never when it rolls back", async () => {
		const batch =
			(failing: boolean): Handler =>
			async (context) => {
				const db = env(context).MUSIC_DB;

				try {
					await db?.batch([
						db.prepare(UPDATE),
						db.prepare(
							failing ? "INSERT INTO no_such_table VALUES (1)" : "SELECT 1",
						),
					]);
				} catch {
					// the batch rolled back
				}

				await fetch("https://api.resend.com/emails", {
					method: "POST",
					body: "{}",
				});

				return new Response("ok");
			};

		const committed = await record(batch(false));
		const rolledBack = await record(batch(true));

		const mailOf = (got: Awaited<ReturnType<typeof record>>) =>
			got.effects.find((effect) => effect.kind === "fetch");

		expect(mailOf(committed)?.state?.touched).toEqual([
			"software_signing_settings",
		]);
		expect(mailOf(rolledBack)?.state?.touched).toEqual([]);

		// A rolled-back batch leaves the database as it was, and the cached digest must know it (total_changes() does not).
		const quiet = await record(steps("email"));

		expect(mailOf(rolledBack)?.state?.music).toBe(mailOf(quiet)?.state?.music);
	});
});

describe("tables written by a trigger are in touched, whoever wrote them", () => {
	const EVENT =
		"INSERT INTO music_events (release_id, recording_id, session_id, medium, event, occurred_at) VALUES ('r', 'c', 's', 'audio', 'start', '2026-11-13T10:00:00.000Z')";

	const UPSERT =
		"INSERT INTO music_event_daily (day, release_id, recording_id, medium, event, count) VALUES ('2026-11-13', 'r', 'c', 'audio', 'start', 1) ON CONFLICT (day, release_id, recording_id, medium, event) DO UPDATE SET count = count + 1";

	const DELETE = "DELETE FROM music_events WHERE session_id = 's'";

	const recordWorld = (handler: Handler, dropTrigger: boolean) =>
		runCase(handler, {
			name: "trigger pair",
			fetches: byHost({ resend: json(200, {}) }),
			setup: (world) => {
				if (dropTrigger)
					world.music.exec("DROP TRIGGER music_events_archive_before_delete");

				world.music.exec(EVENT);
			},
			steps: [{ path: "/api/x", method: "POST", as: asVisitor() }],
		});

	it("the rule in a trigger and the same rule in code leave the same state and the same touched, and are neutral", async () => {
		// With the trigger, deleting the event also upserts the daily count. In code, the route does the upsert itself.
		const withTrigger = await recordWorld(steps(DELETE, "email"), false);
		const inCode = await recordWorld(steps(UPSERT, DELETE, "email"), true);

		const stateAtMail = (got: typeof withTrigger) =>
			got.effects.find((effect) => effect.kind === "fetch")?.state;

		expect(stateAtMail(inCode)?.music).toBe(stateAtMail(withTrigger)?.music);
		expect(stateAtMail(withTrigger)?.touched).toEqual([
			"music_event_daily",
			"music_events",
		]);
		expect(stateAtMail(inCode)?.touched).toEqual([
			"music_event_daily",
			"music_events",
		]);
		expect(compareCase(withTrigger, inCode).status).toBe("d1-only");
	});

	it("a schema-qualified statement counts its real table", async () => {
		const got = await record(
			steps(
				"UPDATE main.software_signing_settings SET updated_by = 'q'",
				"email",
			),
		);

		expect(
			got.effects.find((effect) => effect.kind === "fetch")?.state?.touched,
		).toEqual(["software_signing_settings"]);
	});
});

describe("what the harness records is what golden:neutral requires of a current-format case", () => {
	it("a record of real statements, an email, a batch and a hook passes the shape check", async () => {
		const got = await runCase(
			async (context) => {
				const db = env(context).MUSIC_DB;

				await db
					?.prepare(`UPDATE ${TABLE} SET count = 5 WHERE day = 'd'`)
					.run();
				await fetch("https://api.resend.com/emails", {
					method: "POST",
					body: "{}",
				});
				await db?.batch([db.prepare(`SELECT * FROM ${TABLE}`)]);

				return new Response("ok");
			},
			{
				name: "shape",
				fetches: byHost({ resend: json(200, {}) }),
				setup: (world) =>
					world.music.exec(
						`INSERT INTO ${TABLE} (day, scope, count) VALUES ('d', 's', 1)`,
					),
				interleave: [
					{
						on: /UPDATE brief_suggestion_budget/,
						label: "race",
						run: () => {},
					},
				],
				steps: [
					{ path: "/api/x", method: "POST", as: asVisitor() },
					{ path: "/api/y", method: "POST", as: asVisitor() },
				],
			},
		);

		expect(() =>
			assertCompleteRecord(JSON.parse(JSON.stringify(got))),
		).not.toThrow();
	});

	it("the kinds without a state are the same in the tool and in the harness", () => {
		expect([...UNSTATED_KINDS].sort()).toEqual([...UNSTATED].sort());
	});
});
