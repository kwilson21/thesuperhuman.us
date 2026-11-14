import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { compareCase } from "../../../scripts/golden-neutral.mjs";
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
