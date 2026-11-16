import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankOf } from "~/lib/invoice-event-order";
import { DatabaseSync } from "../helpers/sqlite-d1";

// The software invoice guard ranks statuses in SQL (the `eligible` clause of applySoftwareInvoiceEvent), and the
// LemmaScript contract and the Quint model rank them in rankOf. This keeps the copies from drifting: the CASE
// expressions are read out of the source and run on sqlite for every status.

const source = readFileSync(
	new URL("../../src/lib/software-invoices.ts", import.meta.url),
	"utf8",
);

const rankCases = [
	...source.matchAll(/CASE (\?|status) (WHEN '\w+' THEN \d+ )+ELSE \d+ END/g),
].map((match) => match[0]);

const statuses = ["paid", "void", "uncollectible", "payment_failed", "open"];

describe("the rank in software-invoices.ts and rankOf", () => {
	it("the guard has exactly two rank CASE expressions, one for the event and one for the row", () => {
		expect(rankCases).toHaveLength(2);
		expect(rankCases.filter((expr) => expr.startsWith("CASE ?"))).toHaveLength(
			1,
		);
		expect(
			rankCases.filter((expr) => expr.startsWith("CASE status")),
		).toHaveLength(1);
	});

	it("both CASE expressions agree with rankOf for every status, and rank an unknown status 0", () => {
		const sqlite = new DatabaseSync(":memory:");

		for (const expression of rankCases) {
			const subject = expression.startsWith("CASE ?") ? "?" : "status";

			for (const status of [...statuses, "creating", "not_created", "other"]) {
				const row =
					subject === "?"
						? sqlite.prepare(`SELECT ${expression} AS rank`).get(status)
						: sqlite
								.prepare(
									`SELECT ${expression} AS rank FROM (SELECT ? AS status)`,
								)
								.get(status);

				expect(row, `${expression} for ${status}`).toEqual({
					rank: rankOf(status),
				});
			}
		}
	});

	it("ranks the five statuses in the order paid, void, uncollectible, payment_failed, open", () => {
		expect(statuses.map(rankOf)).toEqual([5, 4, 3, 2, 1]);
	});
});
