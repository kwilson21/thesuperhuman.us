import type { JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/project";
import {
	asClient,
	asOwner,
	asVisitor,
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";
import {
	ALL_TABLES,
	BASE,
	EARLIER,
	invoice,
	offerTerms,
	owner,
	running,
	stateBody,
} from "./areas/software-projects";

// The golden corpus for the "deposit" and "payment" actions of POST /api/owner/requests/[id]/project: the owner records
// that a client paid outside Stripe, a milestone deposit (standard mode) or a milestone balance (any mode). These
// confirmations move money state, so each repeat, race and invoice state is recorded.
//
// Every response branch of both actions and the cases that reach each:
//
//   shared with the other project files: 403 a visitor and a signed-in client, 404 portal flag, 503 no database,
//   404 no project, musicRequest (see owner-request-project-start), 400 the schema
//   400 "Check both confirmations"   confirmed missing, false or text; milestone_index missing, text, fractional, negative,
//                                    deposit with index 0 (the deposit minimum is 1), index 3 on either action
//   400 {ok:false} with no error     deposit: invoice-mode project, index not past the project's current milestone,
//                                    index past the offer, completed project; payment: index past the offer
//   200 {ok:true}                    deposit 1 and 2 on a three-milestone offer, 1 on two, from each state, a repeat (silent,
//                                    no second audit), a deposit already recorded; payment 0, 1 and 2 in standard and
//                                    invoice mode, out of order, on a completed project, a repeat, on a resolved request
//   409 manualPaymentReminder        a deposit (or balance or milestone) invoice at that milestone in creating, open,
//                                    payment_failed or uncollectible, found before the batch (a lost race) or after it
//                                    (the batch threw)
//   409 generic "could not be saved" paid, void and refunded invoices are not blockers (recorded as 200); revoked access,
//                                    content deleted, a withdrawn request, a blank email, a stale project updated_at
//                                    (deposit), the batch throws, the project lookup throws once
//   handler rejects                  the project lookup throws twice; the invoice list throws in the catch
//
// What is not guarded today (recorded as it is): payment has no project-updated_at guard, no payment-mode check and no
// completed check, and accepts milestones out of order; a deposit does not move the project's updated_at.
//
// Multi-step: deposit, repeat, then advance the milestone; payment then advance in invoice mode; an invoice opens between
// two confirmations; a confirmation after access is revoked.

const TABLES = [...ALL_TABLES, "software_invoices"];

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { dump: { music: TABLES }, ...extra });

const go = (
	name: string,
	body: JsonValue | undefined,
	seed: ReturnType<typeof running> = running(),
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({ name, music: { seed }, steps: [act(body, step)], ...extra });

const dep = (
	milestone_index: JsonValue | undefined,
	confirmed: JsonValue = true,
) => ({
	action: "deposit",
	milestone_index,
	confirmed,
});

const pay = (
	milestone_index: JsonValue | undefined,
	confirmed: JsonValue = true,
) => ({
	action: "payment",
	milestone_index,
	confirmed,
});

const THREE = [100_000, 200_000, 300_000];

const three = (over: Parameters<typeof running>[0] = {}) =>
	running({ fees: THREE, ...over });

const deposits = (...indexes: number[]) => ({
	software_milestone_deposits: indexes.map((i) => ({
		request_id: "r1",
		milestone_index: i,
		paid_recorded_at: EARLIER,
		recorded_by: "earlier@example.test",
	})),
});

const payments = (...indexes: number[]) => ({
	software_milestone_payments: indexes.map((i) => ({
		request_id: "r1",
		milestone_index: i,
		paid_recorded_at: EARLIER,
		recorded_by: "earlier@example.test",
	})),
});

const inv = (rowsList: SeedRow[]) => ({ software_invoices: rowsList });

const LOOKUP = /SELECT \* FROM software_projects WHERE request_id=\?/;
const DEPOSIT_BATCH = /INSERT OR IGNORE INTO software_milestone_deposits/;
const PAYMENT_BATCH = /INSERT OR IGNORE INTO software_milestone_payments/;
const BLOCKING = ["creating", "open", "payment_failed", "uncollectible"];
const FREE = ["paid", "void"];

const openInvoiceSql =
	(kind: string, index: number) => (sqlite: { exec: (sql: string) => void }) =>
		sqlite.exec(
			`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES ('i9','r1','o1',${index},'${kind}',50000,7,'open','o','${EARLIER}','${EARLIER}')`,
		);

const cases: Case[] = [
	// who and where
	go("a visitor records a deposit", dep(1), three(), {}, { as: asVisitor() }),
	{
		name: "a signed-in client records a deposit",
		music: { seed: three() },
		steps: [act(dep(1), { as: asClient("grace@example.test") })],
	},
	go("a visitor records a payment", pay(0), running(), {}, { as: asVisitor() }),
	go("the portal flag is false for a deposit", dep(1), three(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	go("the portal flag is false for a payment", pay(0), running(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	{
		name: "no database binding for a deposit",
		music: { missing: true },
		steps: [act(dep(1))],
	},
	{
		name: "no database binding for a payment",
		music: { missing: true },
		steps: [act(pay(0))],
	},
	go("no project for a deposit", dep(1), {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go("no project for a payment", pay(0), {
		owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	}),
	go(
		"a payment for an unknown request id",
		pay(0),
		running(),
		{},
		{ path: `${BASE}/nope/project`, params: { id: "nope" } },
	),
	// schema
	go("a deposit not confirmed", dep(1, false)),
	go("a deposit with confirmed missing", {
		action: "deposit",
		milestone_index: 1,
	}),
	go("a deposit with confirmed as text", dep(1, "true")),
	go("a deposit with no milestone", dep(undefined)),
	go("a deposit with a text milestone", dep("1")),
	go("a deposit with a fractional milestone", dep(1.5)),
	go("a deposit with a negative milestone", dep(-1)),
	go("a deposit for milestone 0 (below the minimum)", dep(0), three()),
	go("a deposit for milestone 3 (above the maximum)", dep(3), three()),
	go("a payment not confirmed", pay(0, false)),
	go("a payment with confirmed missing", {
		action: "payment",
		milestone_index: 0,
	}),
	go("a payment with no milestone", pay(undefined)),
	go("a payment with a text milestone", pay("0")),
	go("a payment with a fractional milestone", pay(0.5)),
	go("a payment with a negative milestone", pay(-1)),
	go("a payment for milestone 3 (above the maximum)", pay(3), three()),
	// deposit: allowed
	go("a deposit for milestone 2 of three", dep(1), three()),
	go("a deposit for milestone 3 of three", dep(2), three()),
	go("a deposit for milestone 2 of two", dep(1)),
	go(
		"a deposit for milestone 3 of three while on the second milestone",
		dep(2),
		three({ project: { milestone_index: 1 } }),
	),
	...["preparing", "building", "waiting_for_input", "ready_for_review"].map(
		(state) =>
			go(
				`a deposit while the project is ${state}`,
				dep(1),
				running({ project: { state } }),
			),
	),
	go(
		"a deposit already recorded is repeated",
		dep(1),
		running({ extra: deposits(1) }),
	),
	go(
		"a deposit for another milestone after one was recorded",
		dep(2),
		three({ extra: deposits(1) }),
	),
	go(
		"a deposit as a mixed-case owner email",
		dep(1),
		running(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	go(
		"a deposit on a resolved request",
		dep(1),
		running({ request: { status: "resolved" } }),
	),
	go(
		"a deposit on a request still marked new",
		dep(1),
		running({ request: { status: "new" } }),
	),
	// deposit: invalid moves
	go(
		"a deposit on an invoice-mode project",
		dep(1),
		running({ mode: "invoice" }),
	),
	go(
		"a deposit for the milestone the project is on",
		dep(1),
		running({ project: { milestone_index: 1 } }),
	),
	go(
		"a deposit for an earlier milestone",
		dep(1),
		three({ project: { milestone_index: 2 } }),
	),
	go(
		"a deposit for the last milestone while on it",
		dep(2),
		three({ project: { milestone_index: 2 } }),
	),
	go("a deposit past a two-milestone offer", dep(2)),
	go(
		"a deposit past a one-milestone offer",
		dep(1),
		running({ fees: [100_000] }),
	),
	go(
		"a deposit on a completed project",
		dep(1),
		running({ project: { state: "complete", completed_at: EARLIER } }),
	),
	go(
		"a deposit on a revoked project",
		dep(1),
		running({ project: { revoked_at: EARLIER } }),
	),
	go(
		"a deposit on a project whose content was deleted",
		dep(1),
		running({ project: { content_deleted_at: EARLIER } }),
	),
	go(
		"a deposit on a withdrawn request",
		dep(1),
		running({ request: { status: "withdrawn" } }),
	),
	go(
		"a deposit on a request with a blank email",
		dep(1),
		running({ request: { email: "" } }),
	),
	// deposit: invoices
	...BLOCKING.map((status) =>
		go(
			`a deposit with a ${status} deposit invoice`,
			dep(1),
			running({ extra: inv([invoice("i1", status, { milestone_index: 1 })]) }),
		),
	),
	...FREE.map((status) =>
		go(
			`a deposit with a ${status} deposit invoice`,
			dep(1),
			running({ extra: inv([invoice("i1", status, { milestone_index: 1 })]) }),
		),
	),
	go(
		"a deposit with a refunded paid deposit invoice",
		dep(1),
		running({
			extra: inv([
				invoice("i1", "paid", { milestone_index: 1, refunded_at: EARLIER }),
			]),
		}),
	),
	go(
		"a deposit with an open balance invoice at the same milestone",
		dep(1),
		running({
			extra: inv([
				invoice("i1", "open", { milestone_index: 1, kind: "balance" }),
			]),
		}),
	),
	go(
		"a deposit with an open deposit invoice at another milestone",
		dep(1),
		three({ extra: inv([invoice("i1", "open", { milestone_index: 2 })]) }),
	),
	go("a deposit with an open invoice of another offer", dep(1), {
		...running(),
		software_offers: [
			rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
			rows.softwareOffer("o2", "r1", {
				version: 2,
				status: "superseded",
				terms_json: offerTerms(),
			}),
		],
		software_invoices: [
			rows.softwareInvoice("i1", "r1", "o2", {
				milestone_index: 1,
				status: "open",
			}),
		],
	}),
	// deposit: outages and races
	go("the deposit project lookup throws once", dep(1), running(), {
		failures: [{ on: LOOKUP, message: "d1 down" }],
	}),
	go("the deposit project lookup throws twice", dep(1), running(), {
		failures: [
			{ on: LOOKUP, message: "d1 down" },
			{ on: LOOKUP, message: "d1 down" },
		],
	}),
	go("the deposit batch throws", dep(1), running(), {
		failures: [{ on: DEPOSIT_BATCH, message: "d1 down" }],
	}),
	go(
		"the deposit batch throws with an open invoice",
		dep(1),
		running({ extra: inv([invoice("i1", "open", { milestone_index: 1 })]) }),
		{ failures: [{ on: DEPOSIT_BATCH, message: "d1 down" }] },
	),
	go(
		"the deposit batch throws and the invoice list throws",
		dep(1),
		running(),
		{
			failures: [
				{ on: DEPOSIT_BATCH, message: "d1 down" },
				{
					on: /FROM software_invoices WHERE request_id=\?/,
					message: "d1 down",
				},
			],
		},
	),
	go("the project changes before the deposit batch", dep(1), running(), {
		interleave: [
			{
				on: DEPOSIT_BATCH,
				label: "the project changes",
				run: (sqlite) =>
					sqlite.exec(
						`UPDATE software_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
					),
			},
		],
	}),
	go("an invoice opens before the deposit batch", dep(1), running(), {
		interleave: [
			{
				on: DEPOSIT_BATCH,
				label: "an invoice opens",
				run: openInvoiceSql("deposit", 1),
			},
		],
	}),
	go(
		"the same deposit is recorded elsewhere before the batch",
		dep(1),
		running(),
		{
			interleave: [
				{
					on: DEPOSIT_BATCH,
					label: "another deposit",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_milestone_deposits VALUES ('r1',1,'${EARLIER}','other@example.test')`,
						),
				},
			],
		},
	),
	go("access is revoked before the deposit batch", dep(1), running(), {
		interleave: [
			{
				on: DEPOSIT_BATCH,
				label: "access is revoked",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
			},
		],
	}),
	// payment: allowed
	go("a payment for the first milestone in standard mode", pay(0)),
	go("a payment for the second milestone in standard mode", pay(1)),
	go(
		"a payment for the first milestone in invoice mode",
		pay(0),
		running({ mode: "invoice" }),
	),
	go(
		"a payment for the third milestone in invoice mode",
		pay(2),
		running({ mode: "invoice", fees: THREE }),
	),
	go("a payment out of order", pay(1), running({ mode: "invoice" })),
	go("a payment that is repeated", pay(0), running({ extra: payments(0) })),
	go(
		"a payment on a completed project",
		pay(0),
		running({ project: { state: "complete", completed_at: EARLIER } }),
	),
	...["preparing", "waiting_for_input", "ready_for_review"].map((state) =>
		go(
			`a payment while the project is ${state}`,
			pay(0),
			running({ project: { state } }),
		),
	),
	go(
		"a payment on a resolved request",
		pay(0),
		running({ request: { status: "resolved" } }),
	),
	go(
		"a payment as a mixed-case owner email",
		pay(0),
		running(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	// payment: invalid
	go("a payment past a two-milestone offer", pay(2)),
	go(
		"a payment past a one-milestone offer",
		pay(1),
		running({ fees: [100_000] }),
	),
	go(
		"a payment on a revoked project",
		pay(0),
		running({ project: { revoked_at: EARLIER } }),
	),
	go(
		"a payment on a project whose content was deleted",
		pay(0),
		running({ project: { content_deleted_at: EARLIER } }),
	),
	go(
		"a payment on a withdrawn request",
		pay(0),
		running({ request: { status: "withdrawn" } }),
	),
	go(
		"a payment on a request with a blank email",
		pay(0),
		running({ request: { email: "" } }),
	),
	// payment: invoices
	...BLOCKING.map((status) =>
		go(
			`a payment with a ${status} balance invoice`,
			pay(0),
			running({ extra: inv([invoice("i1", status, { kind: "balance" })]) }),
		),
	),
	...BLOCKING.slice(0, 2).map((status) =>
		go(
			`a payment with a ${status} milestone invoice`,
			pay(1),
			running({
				mode: "invoice",
				extra: inv([
					invoice("i1", status, { kind: "milestone", milestone_index: 1 }),
				]),
			}),
		),
	),
	...FREE.map((status) =>
		go(
			`a payment with a ${status} balance invoice`,
			pay(0),
			running({ extra: inv([invoice("i1", status, { kind: "balance" })]) }),
		),
	),
	go(
		"a payment with a refunded paid balance invoice",
		pay(0),
		running({
			extra: inv([
				invoice("i1", "paid", { kind: "balance", refunded_at: EARLIER }),
			]),
		}),
	),
	go(
		"a payment with an open deposit invoice at the same milestone",
		pay(0),
		running({ extra: inv([invoice("i1", "open")]) }),
	),
	go(
		"a payment with an open balance invoice at another milestone",
		pay(0),
		running({
			extra: inv([
				invoice("i1", "open", { kind: "balance", milestone_index: 1 }),
			]),
		}),
	),
	go("a payment with an open invoice of another offer", pay(0), {
		...running(),
		software_offers: [
			rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
			rows.softwareOffer("o2", "r1", {
				version: 2,
				status: "superseded",
				terms_json: offerTerms(),
			}),
		],
		software_invoices: [
			rows.softwareInvoice("i1", "r1", "o2", {
				kind: "balance",
				status: "open",
			}),
		],
	}),
	// payment: outages and races
	go("the payment project lookup throws once", pay(0), running(), {
		failures: [{ on: LOOKUP, message: "d1 down" }],
	}),
	go("the payment project lookup throws twice", pay(0), running(), {
		failures: [
			{ on: LOOKUP, message: "d1 down" },
			{ on: LOOKUP, message: "d1 down" },
		],
	}),
	go("the payment batch throws", pay(0), running(), {
		failures: [{ on: PAYMENT_BATCH, message: "d1 down" }],
	}),
	go(
		"the payment batch throws with an open balance invoice",
		pay(0),
		running({ extra: inv([invoice("i1", "open", { kind: "balance" })]) }),
		{ failures: [{ on: PAYMENT_BATCH, message: "d1 down" }] },
	),
	go(
		"the payment batch throws and the invoice list throws",
		pay(0),
		running(),
		{
			failures: [
				{ on: PAYMENT_BATCH, message: "d1 down" },
				{
					on: /FROM software_invoices WHERE request_id=\?/,
					message: "d1 down",
				},
			],
		},
	),
	go("an invoice opens before the payment batch", pay(0), running(), {
		interleave: [
			{
				on: PAYMENT_BATCH,
				label: "an invoice opens",
				run: openInvoiceSql("balance", 0),
			},
		],
	}),
	go(
		"the same payment is recorded elsewhere before the batch",
		pay(0),
		running(),
		{
			interleave: [
				{
					on: PAYMENT_BATCH,
					label: "another payment",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_milestone_payments VALUES ('r1',0,'${EARLIER}','other@example.test')`,
						),
				},
			],
		},
	),
	go("access is revoked before the payment batch", pay(0), running(), {
		interleave: [
			{
				on: PAYMENT_BATCH,
				label: "access is revoked",
				run: (sqlite) =>
					sqlite.exec(`UPDATE software_projects SET revoked_at='${EARLIER}'`),
			},
		],
	}),
	go(
		"the project changes before the payment batch and the payment is still recorded",
		pay(0),
		running(),
		{
			interleave: [
				{
					on: PAYMENT_BATCH,
					label: "the project changes",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_projects SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	// sequences
	{
		name: "a deposit, the same deposit again, then the milestone moves forward",
		music: { seed: running() },
		steps: [
			act(dep(1)),
			act(dep(1), { advanceMs: 1000 }),
			act(stateBody({ milestone_index: 1, expectedUpdatedAt: EARLIER }), {
				advanceMs: 1000,
			}),
		],
	},
	{
		name: "a payment in invoice mode, then the milestone moves forward",
		music: { seed: running({ mode: "invoice" }) },
		steps: [
			act(stateBody({ milestone_index: 1 })),
			act(pay(0), { advanceMs: 1000 }),
			act(stateBody({ milestone_index: 1, expectedUpdatedAt: EARLIER }), {
				advanceMs: 1000,
			}),
		],
	},
	{
		name: "a payment recorded twice with an invoice opening in between",
		music: { seed: running() },
		steps: [
			act(pay(0)),
			act(pay(0), {
				advanceMs: 1000,
				before: {
					label: "an invoice opens",
					run: (world) => {
						openInvoiceSql("balance", 0)(world.music);
					},
				},
			}),
		],
	},
	{
		name: "a refused deposit while an invoice is open, then recorded once it is void",
		music: {
			seed: running({
				extra: inv([invoice("i1", "open", { milestone_index: 1 })]),
			}),
		},
		steps: [
			act(dep(1)),
			act(dep(1), {
				advanceMs: 1000,
				before: {
					label: "the invoice is voided in Stripe",
					run: (world) => {
						world.music.exec("UPDATE software_invoices SET status='void'");
					},
				},
			}),
		],
	},
	{
		name: "all three deposits and payments on a three-milestone offer",
		music: { seed: three() },
		steps: [
			act(dep(1)),
			act(dep(2), { advanceMs: 1000 }),
			act(pay(0), { advanceMs: 1000 }),
			act(pay(1), { advanceMs: 1000 }),
			act(pay(2), { advanceMs: 1000 }),
		],
	},
	{
		name: "a deposit, a payment, and then both after access is revoked",
		music: { seed: running() },
		steps: [
			act(dep(1)),
			act(pay(0), { advanceMs: 1000 }),
			act({ action: "revoke", confirmed: true }, { advanceMs: 1000 }),
			act(dep(1), { advanceMs: 1000 }),
			act(pay(1), { advanceMs: 1000 }),
		],
	},
];

defineCorpus("owner-request-project-money", POST, cases);
