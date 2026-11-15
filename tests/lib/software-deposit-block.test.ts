import { beforeEach, describe, expect, it } from "vitest";
import {
	type DepositInvoice,
	depositBlock,
} from "~/lib/software-deposit-block";
import { depositOfferGuard } from "~/lib/software-offer-deposit";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The deposit decision has a second copy in SQL: the batch guard G4 (`depositOfferGuard` in
// src/lib/software-offer-deposit.ts), which re-checks it at write time. LemmaScript proves the TypeScript copy's contract
// (src/lib/software-deposit-block.ts); this runs the guard on sqlite for every milestone, kind, status, refund and offer
// status, alone and in pairs of first deposits, and requires it to refuse exactly when `depositBlock` blocks, so the
// copies cannot drift. The rows are read as the offers store will read them for the rule: every invoice of the request,
// with its offer's status, unfiltered, so the whole decision is in the function.

const STATUSES = [
	"creating",
	"open",
	"paid",
	"payment_failed",
	"void",
	"uncollectible",
] as const;

const OFFER_STATUSES = ["draft", "sent", "superseded", "withdrawn"] as const;

const KINDS = ["deposit", "balance", "milestone"] as const;

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

const REQUEST = "r1";

beforeEach(() => {
	database.exec(
		`DROP TABLE IF EXISTS software_invoices; DROP TABLE IF EXISTS software_offers;
		CREATE TABLE software_offers (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL);
		CREATE TABLE software_invoices (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, offer_id TEXT NOT NULL,
			milestone_index INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, refunded_at TEXT)`,
	);
});

/** Stores the invoices, each on an offer of its own with the offer status given, all for the one request. */
function store(invoices: readonly DepositInvoice[]) {
	database.exec("DELETE FROM software_invoices; DELETE FROM software_offers");

	invoices.forEach((invoice, index) => {
		database
			.prepare("INSERT INTO software_offers VALUES (?,?,?)")
			.run(`o${index}`, REQUEST, invoice.offerStatus);
		database
			.prepare("INSERT INTO software_invoices VALUES (?,?,?,?,?,?,?)")
			.run(
				`i${index}`,
				REQUEST,
				`o${index}`,
				invoice.milestoneIndex,
				invoice.kind,
				invoice.status,
				invoice.refunded ? "2026-11-15T10:00:00.000Z" : null,
			);
	});
}

/** The request's invoices read back, as the store reads them for the rule. */
function readBack(): DepositInvoice[] {
	return database
		.prepare(
			"SELECT i.milestone_index,i.kind,i.status,i.refunded_at,o.status AS offer_status FROM software_invoices i JOIN software_offers o ON o.id=i.offer_id WHERE i.request_id=? ORDER BY i.id",
		)
		.all(REQUEST)
		.map((row) => ({
			milestoneIndex: Number(row.milestone_index),
			kind: String(row.kind),
			status: String(row.status),
			refunded: row.refunded_at !== null,
			offerStatus: String(row.offer_status),
		}));
}

/** Whether the batch guard refuses: it raises, and the batch rolls back. */
const guardRefuses = (decline: boolean) =>
	depositOfferGuard(db, REQUEST, decline)
		.first()
		.then(
			() => false,
			() => true,
		);

/** Every invoice the columns allow. */
const every: DepositInvoice[] = [0, 1, 2].flatMap((milestoneIndex) =>
	KINDS.flatMap((kind) =>
		STATUSES.flatMap((status) =>
			[false, true].flatMap((refunded) =>
				OFFER_STATUSES.map((offerStatus) => ({
					milestoneIndex,
					kind,
					status,
					refunded,
					offerStatus,
				})),
			),
		),
	),
);

/** Every first-milestone deposit, the only invoices that count. */
const firstDeposits = every.filter(
	(invoice) => invoice.milestoneIndex === 0 && invoice.kind === "deposit",
);

describe("the deposit decision and its batch guard", () => {
	it("agree on every single invoice, in both modes", async () => {
		expect(every).toHaveLength(432);

		for (const invoice of every) {
			store([invoice]);
			expect(readBack()).toEqual([invoice]);

			const send = depositBlock(readBack(), false);
			const decline = depositBlock(readBack(), true);

			expect(await guardRefuses(false), JSON.stringify(invoice)).toBe(
				send !== "clear",
			);
			expect(await guardRefuses(true), JSON.stringify(invoice)).toBe(
				decline === "open",
			);
		}
	});

	it("agree on every pair of first deposits, in both modes", async () => {
		let blocked = 0;

		for (const first of firstDeposits)
			for (const second of firstDeposits) {
				store([first, second]);

				const send = depositBlock(readBack(), false);

				if (send !== "clear") blocked += 1;
				expect(await guardRefuses(false)).toBe(send !== "clear");
				expect(await guardRefuses(true)).toBe(
					depositBlock(readBack(), true) === "open",
				);
			}

		expect(blocked).toBeGreaterThan(0);
	});

	it("blocks a decline only while a deposit may still be charged, and names the sentence in order", () => {
		const deposit = (
			status: string,
			offerStatus = "sent",
			refunded = false,
		): DepositInvoice => ({
			milestoneIndex: 0,
			kind: "deposit",
			status,
			refunded,
			offerStatus,
		});

		expect(depositBlock([], false)).toBe("clear");
		expect(depositBlock([deposit("paid")], true)).toBe("clear");
		expect(depositBlock([deposit("paid")], false)).toBe("paidOnSent");
		expect(depositBlock([deposit("paid", "withdrawn")], false)).toBe(
			"paidEarlier",
		);
		expect(
			depositBlock(
				[deposit("paid", "withdrawn"), deposit("paid", "sent")],
				false,
			),
		).toBe("paidOnSent");
		expect(
			depositBlock([deposit("paid"), deposit("open", "draft")], true),
		).toBe("open");
		expect(depositBlock([deposit("paid", "sent", true)], false)).toBe("clear");
		expect(depositBlock([deposit("void")], false)).toBe("clear");
		expect(
			depositBlock(
				[
					{ ...deposit("open"), kind: "balance" },
					{ ...deposit("open"), milestoneIndex: 1 },
				],
				false,
			),
		).toBe("clear");
	});
});
