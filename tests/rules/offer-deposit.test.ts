import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it } from "vitest";
import type { DepositInvoice } from "~/lib/software-deposit-block";
import { depositOfferBlock } from "~/lib/software-offer-deposit";
import {
	type DepositsRead,
	depositAllowsSend,
	noOpenDepositOnDecline,
} from "~/server/rules/offer-deposit";
import { alwaysWrites } from "~/server/terms";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// Until the owner request status converts, `depositOfferBlock` (src/lib/software-offer-deposit.ts) keeps reading the
// deposit decision in SQL for that route, and the offers area decides it with the rule. This holds the two to the same
// answers on sqlite, for every first-milestone deposit alone and every pair: the send's sentence, and whether a decline
// is stopped (the route answered a decline with its own sentence whenever the read gave any).

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS software_invoices; DROP TABLE IF EXISTS software_offers;
		CREATE TABLE software_offers (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL);
		CREATE TABLE software_invoices (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, offer_id TEXT NOT NULL,
			milestone_index INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, refunded_at TEXT)`,
	);
});

function store(invoices: readonly DepositInvoice[]) {
	database.exec("DELETE FROM software_invoices; DELETE FROM software_offers");

	invoices.forEach((invoice, index) => {
		database
			.prepare("INSERT INTO software_offers VALUES (?,?,?)")
			.run(`o${index}`, "r1", invoice.offerStatus);
		database
			.prepare("INSERT INTO software_invoices VALUES (?,?,?,?,?,?,?)")
			.run(
				`i${index}`,
				"r1",
				`o${index}`,
				invoice.milestoneIndex,
				invoice.kind,
				invoice.status,
				invoice.refunded ? "2026-11-15T10:00:00.000Z" : null,
			);
	});
}

const declineRule = alwaysWrites({
	name: "the decline's deposit refusal, alone",
	given: (_request: null, facts: DepositsRead) => facts,
	refusals: [noOpenDepositOnDecline],
	writes: () => ({}),
	writesText: "nothing",
});

/** The refusal's sentence, or null when the rule lets the action go on. */
const said = (decided: Effect.Effect<unknown, { readonly say: string }>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => refusal.say,
			onSuccess: () => null,
		}),
	);

const firstDeposits: DepositInvoice[] = [
	"creating",
	"open",
	"paid",
	"payment_failed",
	"void",
	"uncollectible",
].flatMap((status) =>
	[false, true].flatMap((refunded) =>
		["draft", "sent", "superseded", "withdrawn"].map((offerStatus) => ({
			milestoneIndex: 0,
			kind: "deposit",
			status,
			refunded,
			offerStatus,
		})),
	),
);

const sets = [
	[],
	...firstDeposits.map((invoice) => [invoice]),
	...firstDeposits.flatMap((first) =>
		firstDeposits.map((second) => [first, second]),
	),
	[{ ...firstDeposits[1], kind: "balance" }],
	[{ ...firstDeposits[1], milestoneIndex: 1 }],
];

describe("the deposit rule and depositOfferBlock", () => {
	it("give a send the same sentence, and stop a decline alike, for every first deposit and pair", async () => {
		let stopped = 0;

		for (const invoices of sets) {
			store(invoices);

			const send = said(depositAllowsSend.decide(null, { invoices }));
			const decline = said(declineRule.decide(null, { invoices }));

			if (decline !== null) stopped += 1;

			expect(await depositOfferBlock(db, "r1"), JSON.stringify(invoices)).toBe(
				send,
			);
			expect(
				(await depositOfferBlock(db, "r1", true)) !== null,
				JSON.stringify(invoices),
			).toBe(decline !== null);
			expect(decline === null || decline.includes("before declining")).toBe(
				true,
			);
		}

		expect(stopped).toBeGreaterThan(0);
	});
});
