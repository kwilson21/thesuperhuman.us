import type { APIContext } from "astro";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { softwareGuard } from "../../src/lib/software-guard";
import { POST } from "../../src/pages/api/owner/requests/[id]/agreement";
import {
	type AbandonFacts,
	type AbandonRequest,
	abandonFront,
	abandonPending,
	abandonSigning,
	afterRefusedAbandon,
	type OfferInvoiceRow,
} from "../../src/server/rules/agreement-abandon";
import type {
	OfferAgreementRow,
	SentOfferRow,
} from "../../src/server/rules/agreement-countersign";
import type { Refusal } from "../../src/server/terms";
import { partial } from "../helpers/doubles";
import { testRuntime } from "../helpers/runtime";
import { DatabaseSync, sqliteD1 } from "../helpers/sqlite-d1";

// The owner's abandon as stories, stage by stage in the route's order: the sent offer, the pending documents, the
// deposits, and the exact values the batch writes. Then today's route runs on sqlite beside the rule over the same rows,
// and the two guards that re-check it at write time run on sqlite against the rule: A11 (each document named still
// client_signed with its hash, of this request and offer) and A12 (no first deposit of the offer counts). tests/lib/software-deposit-block.test.ts holds A12 to `abandonBlocked` for every
// invoice; here it is held to the rule, through the rows as the store will read them.

const said = <W, E extends Refusal>(decided: Effect.Effect<W, E>) =>
	Effect.runSync(
		Effect.match(decided, {
			onFailure: (refusal) => ({ refused: refusal._tag, say: refusal.say }),
			onSuccess: (wrote) => ({ wrote }),
		}),
	);

const MSA = "11111111-1111-4111-8111-111111111111";
const SOW = "22222222-2222-4222-8222-222222222222";
const MSA_HASH = "a".repeat(64);
const SOW_HASH = "b".repeat(64);
const AT = "2026-11-23T15:00:00.000Z";

const BOTH = [
	{ id: MSA, hash: MSA_HASH },
	{ id: SOW, hash: SOW_HASH },
];

const SOW_ONLY = [{ id: SOW, hash: SOW_HASH }];

const OFFER: SentOfferRow = {
	id: "o1",
	request_id: "r1",
	contractor_snapshot_json: null,
	recipient_email_snapshot: "client@example.test",
	reused_msa_id: null,
};

const agreement = (
	kind: "msa" | "sow",
	status = "client_signed",
): OfferAgreementRow => ({
	id: kind === "msa" ? MSA : SOW,
	kind,
	status,
	text_sha256: kind === "msa" ? MSA_HASH : SOW_HASH,
});

const invoice = (over: Partial<OfferInvoiceRow> = {}): OfferInvoiceRow => ({
	milestone_index: 0,
	kind: "deposit",
	status: "open",
	refunded_at: null,
	...over,
});

const request = (over: Partial<AbandonRequest> = {}): AbandonRequest => ({
	requestId: "r1",
	documents: BOTH,
	reason: "The client asked to stop.",
	actor: "Owner@Example.TEST",
	at: AT,
	...over,
});

const facts = (over: Partial<AbandonFacts> = {}): AbandonFacts => ({
	offer: OFFER,
	agreements: [agreement("msa"), agreement("sow")],
	invoices: [],
	...over,
});

const NO_SENT_OFFER = { refused: "NoSentOffer", say: "" };

const DIFFERS = {
	refused: "PendingActionDiffers",
	say: "Review the complete pending signing action.",
};

const DEPOSIT = {
	refused: "DepositCounts",
	say: "Void the deposit invoice first, or refund it in Stripe and record the refund with owner:stripe:reconcile --software-deposit-refunded.",
};

const decide = (
	over: Partial<AbandonRequest> = {},
	overFacts: Partial<AbandonFacts> = {},
) => said(abandonSigning.decide(request(over), facts(overFacts)));

describe("the sent offer", () => {
	it("goes on with a sent offer", () => {
		expect(said(abandonFront.decide(null, { offer: OFFER }))).toEqual({
			wrote: {},
		});
	});

	it("is refused with no sentence when the request has no sent offer", () => {
		expect(said(abandonFront.decide(null, { offer: null }))).toEqual(
			NO_SENT_OFFER,
		);
		expect(decide({}, { offer: null, agreements: [] })).toEqual(NO_SENT_OFFER);
	});
});

describe("the pending documents", () => {
	const pending = (agreements: OfferAgreementRow[], documents = BOTH) =>
		said(abandonPending.decide({ documents }, { offer: OFFER, agreements }));

	it("goes on when the client-signed documents are the ones named, in either order", () => {
		expect(pending([agreement("msa"), agreement("sow")])).toEqual({
			wrote: {},
		});
		expect(
			pending([agreement("msa"), agreement("sow")], [...BOTH].reverse()),
		).toEqual({ wrote: {} });
		expect(
			pending([agreement("msa", "executed"), agreement("sow")], SOW_ONLY),
		).toEqual({ wrote: {} });
	});

	it("is refused with its sentence when nothing is client-signed, or the documents named differ", () => {
		expect(pending([])).toEqual(DIFFERS);
		expect(pending([], [])).toEqual(DIFFERS);
		expect(
			pending([agreement("msa", "review"), agreement("sow", "review")]),
		).toEqual(DIFFERS);
		expect(pending([agreement("msa"), agreement("sow")], SOW_ONLY)).toEqual(
			DIFFERS,
		);
		expect(
			pending(
				[agreement("msa"), agreement("sow")],
				[BOTH[0], { id: SOW, hash: MSA_HASH }],
			),
		).toEqual(DIFFERS);
		expect(
			pending([agreement("msa"), agreement("sow")], [BOTH[1], BOTH[1]]),
		).toEqual(DIFFERS);
	});
});

describe("the deposits", () => {
	it("are refused by a first deposit that may still be charged, refunded or not, or is paid and not refunded", () => {
		for (const status of [
			"creating",
			"open",
			"payment_failed",
			"uncollectible",
		]) {
			expect(decide({}, { invoices: [invoice({ status })] })).toEqual(DEPOSIT);
			expect(
				decide(
					{},
					{
						invoices: [
							invoice({ status, refunded_at: "2026-11-20T00:00:00.000Z" }),
						],
					},
				),
			).toEqual(DEPOSIT);
		}

		expect(decide({}, { invoices: [invoice({ status: "paid" })] })).toEqual(
			DEPOSIT,
		);
	});

	it("go on past a paid deposit with a refund recorded, a void one, and invoices that are not the first deposit", () => {
		expect(
			decide(
				{},
				{
					invoices: [
						invoice({
							status: "paid",
							refunded_at: "2026-11-20T00:00:00.000Z",
						}),
						invoice({ status: "void" }),
						invoice({ kind: "balance" }),
						invoice({ kind: "milestone" }),
						invoice({ milestone_index: 1 }),
					],
				},
			),
		).toHaveProperty("wrote");
	});

	it("are read again after a refused batch, and answer only when one counts now", () => {
		expect(
			said(afterRefusedAbandon.decide(null, { invoices: [invoice()] })),
		).toEqual(DEPOSIT);
		expect(said(afterRefusedAbandon.decide(null, { invoices: [] }))).toEqual({
			wrote: {},
		});
	});
});

describe("the order of the refusals, when several hold", () => {
	it("answers the offer, then the documents, then the deposits", () => {
		expect(
			decide({}, { offer: null, agreements: [], invoices: [invoice()] }),
		).toEqual(NO_SENT_OFFER);
		expect(decide({ documents: SOW_ONLY }, { invoices: [invoice()] })).toEqual(
			DIFFERS,
		);
	});
});

describe("the abandon's values", () => {
	it("abandons the documents in the order named, at the route's time, with the reason and the owner's email", () => {
		expect(decide({ documents: [...BOTH].reverse() })).toEqual({
			wrote: {
				offerId: "o1",
				requestId: "r1",
				at: AT,
				actor: "Owner@Example.TEST",
				reason: "The client asked to stop.",
				documents: [
					{ id: SOW, hash: SOW_HASH },
					{ id: MSA, hash: MSA_HASH },
				],
			},
		});
	});

	it("abandons the SOW alone when it is the only pending document", () => {
		expect(
			decide(
				{ documents: SOW_ONLY },
				{ agreements: [agreement("msa", "executed"), agreement("sow")] },
			),
		).toMatchObject({ wrote: { documents: SOW_ONLY } });
	});
});

// ---- the guards that re-check it, on sqlite ----

const database = new DatabaseSync(":memory:");
const db = sqliteD1(database);

const TABLES = [
	"software_offers",
	"software_agreements",
	"software_invoices",
	"software_agreement_events",
	"software_agreement_notifications",
	"software_offer_links",
	"software_agreement_sessions",
	"software_agreement_links",
	"software_agreement_drafts",
];

beforeEach(() => {
	database.exec(
		`${TABLES.map((table) => `DROP TABLE IF EXISTS ${table};`).join(" ")}
		CREATE TABLE software_offers (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT);
		CREATE TABLE software_agreements (id TEXT PRIMARY KEY, offer_id TEXT, request_id TEXT NOT NULL, kind TEXT NOT NULL,
			status TEXT NOT NULL, text_sha256 TEXT NOT NULL, abandoned_at TEXT, abandoned_reason TEXT);
		CREATE TABLE software_invoices (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, milestone_index INTEGER NOT NULL,
			kind TEXT NOT NULL, status TEXT NOT NULL, refunded_at TEXT);
		CREATE TABLE software_agreement_events (id TEXT PRIMARY KEY, agreement_id TEXT, offer_id TEXT, action TEXT NOT NULL,
			actor TEXT NOT NULL, occurred_at TEXT NOT NULL, reason TEXT);
		CREATE TABLE software_agreement_notifications (agreement_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL);
		CREATE TABLE software_offer_links (request_id TEXT PRIMARY KEY, revoked_at TEXT);
		CREATE TABLE software_agreement_sessions (token_hash TEXT PRIMARY KEY, offer_id TEXT, revoked_at TEXT);
		CREATE TABLE software_agreement_links (id TEXT PRIMARY KEY, offer_id TEXT, used_at TEXT);
		CREATE TABLE software_agreement_drafts (offer_id TEXT NOT NULL, recipient_email TEXT NOT NULL)`,
	);
});

afterEach(() => {
	vi.useRealTimers();
});

/** Whether a guard refuses: it raises, and its batch rolls back. */
const refuses = (guard: D1PreparedStatement) =>
	guard.first().then(
		() => false,
		() => true,
	);

/** A11 for abandon, copied from the route (src/pages/api/owner/requests/[id]/agreement.ts), which does not export it. */
const A11 =
	"SELECT 1 FROM software_agreements WHERE id=? AND request_id=? AND offer_id=? AND text_sha256=? AND status='client_signed'";

/** `depositUse`, A12's condition, copied from the same route, which does not export it. */
const DEPOSIT_USE =
	"SELECT 1 FROM software_invoices WHERE offer_id=? AND milestone_index=0 AND kind='deposit' AND (status IN ('creating','open','payment_failed','uncollectible') OR (status='paid' AND refunded_at IS NULL))";

const STATUSES = ["review", "client_signed", "executed", "abandoned"] as const;

describe("A11 and the pending documents", () => {
	/** The offer's documents as they are at the batch; the rule decides on them, read as the store will read them. */
	async function atTheBatch(
		documents: { kind: "msa" | "sow"; status: string; sameHash: boolean }[],
		named: { id: string; hash: string }[],
	) {
		database.exec("DELETE FROM software_agreements");

		for (const document of documents) {
			const row = agreement(document.kind);

			database
				.prepare(
					"INSERT INTO software_agreements(id,offer_id,request_id,kind,status,text_sha256) VALUES (?,?,?,?,?,?)",
				)
				.run(
					row.id,
					"o1",
					"r1",
					row.kind,
					document.status,
					document.sameHash ? row.text_sha256 : "e".repeat(64),
				);
		}

		const agreements = (
			await db
				.prepare(
					"SELECT id,kind,status,text_sha256 FROM software_agreements WHERE offer_id=? ORDER BY kind",
				)
				.bind("o1")
				.all<OfferAgreementRow>()
		).results;

		const rule = said(
			abandonPending.decide({ documents: named }, { offer: OFFER, agreements }),
		);

		const guards = await Promise.all(
			named.map((document) =>
				refuses(
					softwareGuard(db, A11, [document.id, "r1", "o1", document.hash]),
				),
			),
		);

		return { rule: "refused" in rule, guard: guards.some(Boolean) };
	}

	it("refuses exactly when the rule, deciding on the rows as they are at the batch, does", async () => {
		let refused = 0;

		for (const msa of STATUSES)
			for (const sow of STATUSES)
				for (const [msaHash, sowHash] of [
					[true, true],
					[false, true],
					[true, false],
				]) {
					const { rule, guard } = await atTheBatch(
						[
							{ kind: "msa", status: msa, sameHash: msaHash },
							{ kind: "sow", status: sow, sameHash: sowHash },
						],
						BOTH,
					);

					if (guard) refused += 1;
					expect(guard, `${msa} ${sow} ${msaHash} ${sowHash}`).toBe(rule);
				}

		expect(refused).toBe(47);

		for (const sow of STATUSES)
			for (const sameHash of [true, false]) {
				const { rule, guard } = await atTheBatch(
					[{ kind: "sow", status: sow, sameHash }],
					SOW_ONLY,
				);

				expect(guard, `${sow} ${sameHash}`).toBe(rule);
			}
	});
});

describe("A12 and the deposits", () => {
	const KINDS = ["deposit", "balance", "milestone"] as const;

	const INVOICE_STATUSES = [
		"creating",
		"open",
		"paid",
		"payment_failed",
		"void",
		"uncollectible",
	] as const;

	/** Every invoice the columns allow. */
	const every: OfferInvoiceRow[] = [0, 1, 2].flatMap((milestone_index) =>
		KINDS.flatMap((kind) =>
			INVOICE_STATUSES.flatMap((status) =>
				[null, "2026-11-20T00:00:00.000Z"].map((refunded_at) => ({
					milestone_index,
					kind,
					status,
					refunded_at,
				})),
			),
		),
	);

	/** Stores the invoices on the offer, and the same again on another offer that A12 does not look at. */
	async function decided(invoices: OfferInvoiceRow[], elsewhere = false) {
		database.exec("DELETE FROM software_invoices");

		invoices.forEach((row, index) => {
			database
				.prepare("INSERT INTO software_invoices VALUES (?,?,?,?,?,?)")
				.run(
					`i${index}`,
					elsewhere ? "o2" : "o1",
					row.milestone_index,
					row.kind,
					row.status,
					row.refunded_at,
				);
		});

		const read = (
			await db
				.prepare(
					"SELECT milestone_index,kind,status,refunded_at FROM software_invoices WHERE offer_id=? ORDER BY id",
				)
				.bind("o1")
				.all<OfferInvoiceRow>()
		).results;

		const rule = said(
			abandonSigning.decide(request(), facts({ invoices: read })),
		);

		const guard = await refuses(
			softwareGuard(db, `SELECT 1 WHERE NOT EXISTS(${DEPOSIT_USE})`, ["o1"]),
		);

		return { rule, guard };
	}

	it("refuses exactly when the rule answers DepositCounts, for every single invoice of the offer", async () => {
		expect(every).toHaveLength(108);
		let blocked = 0;

		for (const row of every) {
			const { rule, guard } = await decided([row]);

			if (guard) blocked += 1;
			expect(guard, JSON.stringify(row)).toBe(
				"refused" in rule && rule.refused === "DepositCounts",
			);
		}

		expect(blocked).toBe(9);
	});

	it("looks only at the offer's own invoices", async () => {
		for (const row of every) {
			const { rule, guard } = await decided([row], true);

			expect(guard).toBe(false);
			expect(rule).toHaveProperty("wrote");
		}
	});
});

describe("today's route and the rule, over the same rows", () => {
	const NOW = "2026-11-23T15:00:00.000Z";

	/** Calls today's route as the signed-in owner at NOW, abandoning the documents named. */
	async function route(documents: { id: string; hash: string }[]) {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(NOW));

		const response = await POST(
			partial<APIContext>({
				params: { id: "r1" },
				request: new Request(
					"https://example.test/api/owner/requests/r1/agreement",
					{
						method: "POST",
						headers: {
							origin: "https://example.test",
							"content-type": "application/json",
						},
						body: JSON.stringify({
							action: "abandon",
							documents,
							reason: "The client asked to stop.",
							confirmed: true,
						}),
					},
				),
				locals: {
					owner: { email: "Owner@Example.TEST" },
					runtime: testRuntime({ MUSIC_DB: db }),
				},
			}),
		);

		vi.useRealTimers();

		return { status: response.status, body: await response.json() };
	}

	/** The answer today's route gives for a refusal or a write of the rule, as the converted route will map it. */
	const answerFor = (
		rule: { refused: string; say: string } | { wrote: unknown },
	) => {
		if ("wrote" in rule) return { status: 200, body: { ok: true } };

		if (rule.refused === "NoSentOffer")
			return { status: 409, body: { ok: false } };

		return { status: 409, body: { ok: false, error: rule.say } };
	};

	/** The rows the abandon writes, read back. */
	const state = () => ({
		agreements: database
			.prepare(
				"SELECT id,status,abandoned_at,abandoned_reason FROM software_agreements ORDER BY id",
			)
			.all(),
		offers: database.prepare("SELECT status FROM software_offers").all(),
		links: database
			.prepare("SELECT revoked_at FROM software_offer_links")
			.all(),
		drafts: database
			.prepare("SELECT count(*) AS n FROM software_agreement_drafts")
			.get(),
	});

	it("abandon: the same answer and the same rows, for every offer, document state, naming and deposit", async () => {
		const deposits: OfferInvoiceRow[][] = [
			[],
			[invoice()],
			[invoice({ refunded_at: "2026-11-20T00:00:00.000Z" })],
			[invoice({ status: "paid" })],
			[invoice({ status: "paid", refunded_at: "2026-11-20T00:00:00.000Z" })],
			[invoice({ kind: "balance" })],
		];

		let wrote = 0;

		for (const sent of [true, false])
			for (const msa of ["review", "client_signed", "executed"])
				for (const sow of ["review", "client_signed", "executed"])
					for (const named of [BOTH, SOW_ONLY, [BOTH[0]]])
						for (const invoices of deposits) {
							database.exec(
								TABLES.map((table) => `DELETE FROM ${table};`).join(" "),
							);
							database
								.prepare(
									"INSERT INTO software_offers VALUES ('o1','r1',?,NULL)",
								)
								.run(sent ? "sent" : "superseded");
							database.exec(
								"INSERT INTO software_offer_links VALUES ('r1',NULL); INSERT INTO software_agreement_drafts VALUES ('o1','client@example.test')",
							);

							for (const [kind, status] of [
								["msa", msa],
								["sow", sow],
							] as const) {
								const stored = agreement(kind, status);

								database
									.prepare(
										"INSERT INTO software_agreements(id,offer_id,request_id,kind,status,text_sha256) VALUES (?,?,?,?,?,?)",
									)
									.run(stored.id, "o1", "r1", kind, status, stored.text_sha256);
							}

							invoices.forEach((row, index) => {
								database
									.prepare("INSERT INTO software_invoices VALUES (?,?,?,?,?,?)")
									.run(
										`i${index}`,
										"o1",
										row.milestone_index,
										row.kind,
										row.status,
										row.refunded_at,
									);
							});

							// Read as the store will read them for the rule.
							const offer = await db
								.prepare(
									"SELECT * FROM software_offers WHERE request_id=? AND status='sent'",
								)
								.bind("r1")
								.first<SentOfferRow>();

							const agreements = (
								await db
									.prepare(
										"SELECT id,kind,status,text_sha256 FROM software_agreements WHERE offer_id=? ORDER BY kind",
									)
									.bind("o1")
									.all<OfferAgreementRow>()
							).results;

							const read = (
								await db
									.prepare(
										"SELECT milestone_index,kind,status,refunded_at FROM software_invoices WHERE offer_id=?",
									)
									.bind("o1")
									.all<OfferInvoiceRow>()
							).results;

							const rule = said(
								abandonSigning.decide(request({ documents: named, at: NOW }), {
									offer,
									agreements,
									invoices: read,
								}),
							);

							const before = state();
							const label = JSON.stringify({ sent, msa, sow, named, invoices });

							expect(await route(named), label).toEqual(answerFor(rule));

							if (!("wrote" in rule)) {
								expect(state(), label).toEqual(before);
								continue;
							}

							wrote += 1;
							const written = rule.wrote;

							expect(state(), label).toEqual({
								agreements: [MSA, SOW].map((id) => {
									const abandoned = written.documents.some(
										(document) => document.id === id,
									);

									return {
										id,
										status: abandoned ? "abandoned" : id === MSA ? msa : sow,
										abandoned_at: abandoned ? NOW : null,
										abandoned_reason: abandoned
											? "The client asked to stop."
											: null,
									};
								}),
								offers: [{ status: "superseded" }],
								links: [{ revoked_at: NOW }],
								drafts: { n: 0 },
							});
						}

		expect(wrote).toBeGreaterThan(0);
	});
});
