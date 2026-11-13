import { vi } from "vitest";
import { POST as webhook } from "~/pages/api/stripe/webhook";
import { POST } from "~/pages/api/owner/requests/[id]/invoices";
import type { JsonValue } from "../helpers/json";
import {
	EARLIER,
	isoAt,
	type Loose,
	NOW_SECONDS,
	offerTerms,
	sendAnswer,
	SITE,
	softwareEvent,
	softwareInvoiceRow,
	softwareSeed,
	softwareTables,
	startedProject,
	stripeDown,
	stripeError,
	stripeScript,
	type StripeStep,
	webhookStep,
} from "./areas/payments";
import {
	asClientCookie,
	asOwner,
	asVisitor,
	defineCorpus,
	networkDown,
	rows,
	type Responder,
	uuidFor,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The Stripe SDK waits about a second between retries of a network failure or a 5xx without a stop header.
vi.setConfig({ testTimeout: 60_000 });

// The golden corpus for POST /api/owner/requests/[id]/invoices: the owner reserves a software invoice (a deposit, a balance
// or a full milestone price) and the site creates it in Stripe, or retries or replaces an earlier attempt. The real Stripe
// SDK runs against scripted answers. The local invoice id is the harness's first random UUID (uuidFor(1)).
//
// Every response branch of the handler, of musicRequest (src/lib/music-request.ts), reserveSoftwareInvoice,
// softwareInvoiceTerms, createSoftwareInvoiceWithClient and recordSoftwareInvoice, and the cases that reach it:
//
//   handler guards (cache-control private, no-store on all)
//   403 {ok:false}                          a visitor, a client cookie (checked before everything else)
//   404 {ok:false}                          the client portal flag off or missing (before the database check)
//   503 {ok:false,error:"Stripe invoice creation is unavailable."}
//                                           no MUSIC_DB, no id param, Stripe flag off or missing, no secret key, no webhook secret
//   musicRequest (its own responses, no cache-control)
//   403 {ok:false,error:"Forbidden"}        no Origin header, another origin
//   415 {ok:false,error:"JSON required"}    a text or form content type, no content type
//   400 "Missing request"                   no body
//   413 "Request too large"                 a body over 8192 bytes
//   400 "Invalid JSON"                      malformed JSON
//   400 {ok:false}                          schema: null, array and string bodies, each field missing or the wrong type or out
//                                           of range, retry_id and replace_id together
//   reserve then create
//   200 {ok:true}                           a deposit, a balance, a milestone, each payment mode, allow_card both ways, an
//                                           odd fee (the deposit takes the half rounded down), the smallest and largest
//                                           fees, a replace of a void invoice, a retry of a stuck one, customer reuse
//   409 {ok:false,error:<message>}          the reservation fails (nothing reserved): not the current offer, offer or
//                                           project state, not available at this milestone, already paid, a leftover void or
//                                           uncollectible invoice, replace and retry guards, terms that do not parse, a
//                                           milestone the schedule does not have, a lost race (guard batch), a duplicate
//                                           active invoice, any database failure before the reservation
//   502 {ok:false,error:"Invoice creation is unconfirmed..."}
//                                           anything that fails after the reservation: each of the five Stripe calls refused
//                                           or down, a send answer that is not an open invoice with an https url or has
//                                           another id, the recipient or offer gone, the record update changes nothing
//   sequences                               deposit, webhook paid, start, balance, webhook paid; a stuck create, a too-soon
//                                           retry, a retry that reuses the keys; a duplicate request; void, replace

const BASE = "/api/owner/requests/r1/invoices";

const SEND_ORIGIN = { origin: SITE, "content-type": "application/json" };

type Body = Loose | JsonValue | undefined;

const ask = (body: Body, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: BASE,
	params: { id: "r1" },
	body: body === undefined ? undefined : JSON.stringify(body),
	headers: SEND_ORIGIN,
	dump: { music: softwareTables },
	...extra,
});

const command = (over: Loose = {}) => ({
	offer_id: "o1",
	milestone_index: 0,
	kind: "deposit",
	allow_card: false,
	...over,
});

type Setup = {
	seed?: { [table: string]: SeedRow[] };
	mode?: "standard" | "invoice";
	fees?: number[];
};

const invCase = (
	name: string,
	setup: Setup,
	body: Body,
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: softwareSeed(setup.seed, setup.mode, setup.fees) },
	fetches: stripeScript(),
	steps: [ask(body)],
	...extra,
});

const with2 = [100_000, 60_000];

const projectAt = (
	index = 0,
	mode: "standard" | "invoice" = "standard",
	over: SeedRow = {},
) => ({
	software_projects: [
		startedProject(mode, { milestone_index: index, ...over }),
	],
});

const delivered = (over: SeedRow = {}) => ({
	software_project_updates: [
		{
			id: "u1",
			request_id: "r1",
			kind: "delivery_review",
			status: "shared",
			milestone_index: 0,
			title: "Delivery",
			evidence_type: "working_preview",
			shared_at: EARLIER,
			created_by: "owner@example.test",
			created_at: EARLIER,
			updated_at: EARLIER,
			...over,
		},
	],
});

const changesRequested = {
	software_project_messages: [
		{
			request_id: "r1",
			actor: "client",
			actor_id: "c1",
			body: "Please change this",
			update_id: "u1",
			decision: "changes_requested",
			created_at: EARLIER,
		},
	],
};

const guards: Case[] = [
	invCase("not the owner: a visitor", {}, command(), {
		steps: [ask(command(), { as: asVisitor() })],
	}),
	invCase("not the owner: a client cookie", {}, command(), {
		steps: [ask(command(), { as: asClientCookie("forged") })],
	}),
	invCase("the client portal flag off", {}, command(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	invCase("the client portal flag missing", {}, command(), {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	invCase("the portal flag off beats a missing database", {}, command(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
		music: { missing: true },
	}),
	invCase("no database binding", {}, command(), { music: { missing: true } }),
	invCase("no id param", {}, command(), {
		steps: [ask(command(), { params: {} })],
	}),
	invCase("an empty id param", {}, command(), {
		steps: [ask(command(), { params: { id: "" } })],
	}),
	invCase("the Stripe flag off", {}, command(), {
		env: { STRIPE_PAYMENTS_ENABLED: "false" },
	}),
	invCase("the Stripe flag missing", {}, command(), {
		omit: ["STRIPE_PAYMENTS_ENABLED"],
	}),
	invCase("no Stripe secret key", {}, command(), {
		omit: ["STRIPE_SECRET_KEY"],
	}),
	invCase("no Stripe webhook secret", {}, command(), {
		omit: ["STRIPE_WEBHOOK_SECRET"],
	}),
	invCase("no Origin header", {}, command(), {
		steps: [
			ask(command(), { headers: { "content-type": "application/json" } }),
		],
	}),
	invCase("another origin", {}, command(), {
		steps: [
			ask(command(), {
				headers: {
					origin: "https://evil.example.test",
					"content-type": "application/json",
				},
			}),
		],
	}),
	invCase("a text content type", {}, command(), {
		steps: [
			ask(command(), {
				headers: { origin: SITE, "content-type": "text/plain" },
			}),
		],
	}),
	invCase("a form content type", {}, command(), {
		steps: [
			ask(undefined, {
				body: "offer_id=o1",
				headers: {
					origin: SITE,
					"content-type": "application/x-www-form-urlencoded",
				},
			}),
		],
	}),
	invCase("a JSON content type with a charset", {}, command(), {
		steps: [
			ask(command(), {
				headers: {
					origin: SITE,
					"content-type": "application/json; charset=utf-8",
				},
			}),
		],
	}),
	invCase("no body", {}, undefined, { steps: [ask(undefined)] }),
	invCase("bad JSON", {}, undefined, {
		steps: [ask(undefined, { body: "{nope" })],
	}),
	invCase("an empty JSON body", {}, undefined, {
		steps: [ask(undefined, { body: "" })],
	}),
	invCase("a body of 8192 bytes of padding that is valid JSON", {}, command(), {
		steps: [ask(command({ retry_id: undefined, pad: "x".repeat(8100) }))],
	}),
	invCase("a body over 8192 bytes", {}, command(), {
		steps: [ask(command({ pad: "x".repeat(9000) }))],
	}),
	invCase("a null body", {}, null),
	invCase("an array body", {}, []),
	invCase("a string body", {}, "deposit"),
	invCase("no offer_id", {}, command({ offer_id: undefined })),
	invCase("an empty offer_id", {}, command({ offer_id: "" })),
	invCase("an offer_id that is a number", {}, command({ offer_id: 1 })),
	invCase("a milestone_index of -1", {}, command({ milestone_index: -1 })),
	invCase("a milestone_index of 3", {}, command({ milestone_index: 3 })),
	invCase("a milestone_index of 1.5", {}, command({ milestone_index: 1.5 })),
	invCase("a milestone_index as text", {}, command({ milestone_index: "0" })),
	invCase("no milestone_index", {}, command({ milestone_index: undefined })),
	invCase("an unknown kind", {}, command({ kind: "refund" })),
	invCase("no kind", {}, command({ kind: undefined })),
	invCase("a kind in capitals", {}, command({ kind: "Deposit" })),
	invCase("no allow_card", {}, command({ allow_card: undefined })),
	invCase("allow_card as text", {}, command({ allow_card: "true" })),
	invCase("allow_card as a number", {}, command({ allow_card: 1 })),
	invCase("a retry_id that is a number", {}, command({ retry_id: 5 })),
	invCase("a replace_id that is a number", {}, command({ replace_id: 5 })),
	invCase(
		"retry_id and replace_id together",
		{},
		command({ retry_id: "a", replace_id: "b" }),
	),
	invCase(
		"extra fields are dropped",
		{},
		command({ extra: true, request_id: "other" }),
	),
];

const reserving: Case[] = [
	invCase("a first deposit with no project", {}, command()),
	invCase(
		"a first deposit with card allowed",
		{},
		command({ allow_card: true }),
	),
	invCase("a deposit for an odd fee", { fees: [100_001] }, command()),
	invCase("a deposit for the smallest fee", { fees: [100] }, command()),
	invCase("a deposit for the largest fee", { fees: [100_000_000] }, command()),
	invCase(
		"a deposit with the customer already on another invoice",
		{
			seed: {
				software_invoices: [
					softwareInvoiceRow("old", {
						milestone_index: 1,
						kind: "deposit",
						status: "paid",
						stripe_invoice_id: "in_old",
						stripe_customer_id: "cus_known",
						creation_started_at: null,
					}),
				],
			},
			fees: with2,
		},
		command(),
	),
	invCase(
		"a deposit for milestone 2 after the project's first",
		{ seed: projectAt(0), fees: with2 },
		command({ milestone_index: 1 }),
	),
	invCase(
		"a deposit for the project's current milestone",
		{ seed: projectAt(0), fees: with2 },
		command(),
	),
	invCase(
		"a deposit for milestone 2 of an offer with two",
		{ fees: with2 },
		command({ milestone_index: 1 }),
	),
	invCase(
		"a balance after the delivery was shared",
		{ seed: { ...projectAt(), ...delivered() } },
		command({ kind: "balance" }),
	),
	invCase(
		"a balance for an odd fee",
		{ seed: { ...projectAt(), ...delivered() }, fees: [100_001] },
		command({ kind: "balance" }),
	),
	invCase(
		"a balance with card allowed",
		{ seed: { ...projectAt(), ...delivered() } },
		command({ kind: "balance", allow_card: true }),
	),
	invCase(
		"a balance whose delivery lists the planned item",
		{
			seed: {
				...projectAt(),
				...delivered({ delivered_deliverables_json: '["Deliverable 1"]' }),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a balance whose delivery lists an item that was not planned",
		{
			seed: {
				...projectAt(),
				...delivered({ delivered_deliverables_json: '["Other"]' }),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a balance whose delivery scope is not JSON",
		{
			seed: {
				...projectAt(),
				...delivered({ delivered_deliverables_json: "nope" }),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a balance whose delivery scope is not a list",
		{
			seed: {
				...projectAt(),
				...delivered({ delivered_deliverables_json: '{"a":1}' }),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a balance after the client asked for changes",
		{ seed: { ...projectAt(), ...delivered(), ...changesRequested } },
		command({ kind: "balance" }),
	),
	invCase(
		"a balance with a delivery that is only a draft",
		{ seed: { ...projectAt(), ...delivered({ status: "draft" }) } },
		command({ kind: "balance" }),
	),
	invCase(
		"a balance with no delivery",
		{ seed: projectAt() },
		command({ kind: "balance" }),
	),
	invCase("a balance with no project", {}, command({ kind: "balance" })),
	invCase(
		"a balance on a completed project",
		{
			seed: {
				...projectAt(0, "standard", { completed_at: EARLIER }),
				...delivered(),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a milestone price in invoice mode after the delivery",
		{ mode: "invoice", seed: { ...projectAt(0, "invoice"), ...delivered() } },
		command({ kind: "milestone" }),
	),
	invCase(
		"a milestone price in invoice mode with card allowed",
		{ mode: "invoice", seed: { ...projectAt(0, "invoice"), ...delivered() } },
		command({ kind: "milestone", allow_card: true }),
	),
	invCase(
		"a milestone price in invoice mode with no delivery",
		{ mode: "invoice", seed: projectAt(0, "invoice") },
		command({ kind: "milestone" }),
	),
	invCase(
		"a milestone price in invoice mode for the smallest fee",
		{
			mode: "invoice",
			fees: [100],
			seed: { ...projectAt(0, "invoice"), ...delivered() },
		},
		command({ kind: "milestone" }),
	),
	invCase("a deposit in invoice mode", { mode: "invoice" }, command()),
	invCase(
		"a balance in invoice mode",
		{ mode: "invoice", seed: { ...projectAt(0, "invoice"), ...delivered() } },
		command({ kind: "balance" }),
	),
	invCase(
		"a milestone price in standard mode",
		{ seed: { ...projectAt(), ...delivered() } },
		command({ kind: "milestone" }),
	),
	invCase(
		"a milestone the offer does not have",
		{},
		command({ milestone_index: 1 }),
	),
	invCase(
		"milestone 3 of an offer with two",
		{ fees: with2 },
		command({ milestone_index: 2 }),
	),
];

const offerGuards: Case[] = [
	invCase("an unknown offer", {}, command({ offer_id: "nope" })),
	invCase(
		"an offer of another request",
		{
			seed: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed" }),
					rows.softwareRequest("r2", {
						status: "reviewed",
						email: "x@example.test",
					}),
				],
				software_offers: [
					rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
					rows.softwareOffer("o9", "r2", { terms_json: offerTerms() }),
				],
			},
		},
		command({ offer_id: "o9" }),
	),
	invCase("a request that is not software", {}, command(), {
		music: {
			seed: {
				owner_requests: [rows.ownerRequest("r1", { status: "reviewed" })],
				software_offers: [
					rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
				],
			},
		},
	}),
	invCase(
		"a withdrawn request",
		{
			seed: {
				owner_requests: [rows.softwareRequest("r1", { status: "withdrawn" })],
			},
		},
		command(),
	),
	invCase(
		"a resolved request",
		{
			seed: {
				owner_requests: [rows.softwareRequest("r1", { status: "resolved" })],
			},
		},
		command(),
	),
	invCase(
		"a new request is allowed",
		{
			seed: { owner_requests: [rows.softwareRequest("r1", { status: "new" })] },
		},
		command(),
	),
	invCase(
		"a request with no email",
		{
			seed: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed", email: "" }),
				],
			},
		},
		command(),
	),
	invCase(
		"an offer that is a draft",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "draft",
						terms_json: offerTerms(),
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"an offer that was superseded",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "superseded",
						terms_json: offerTerms(),
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"an offer that was withdrawn",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "withdrawn",
						terms_json: offerTerms(),
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a superseded offer that the project still uses",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						status: "superseded",
						terms_json: offerTerms(),
					}),
				],
				...projectAt(),
				...delivered(),
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"a project on another offer",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
					rows.softwareOffer("o2", "r1", {
						version: 2,
						status: "superseded",
						terms_json: offerTerms(),
					}),
				],
				software_projects: [startedProject("standard", { offer_id: "o2" })],
			},
		},
		command(),
	),
	invCase(
		"a revoked project",
		{ seed: projectAt(0, "standard", { revoked_at: EARLIER }) },
		command({ milestone_index: 1 }),
		{},
	),
	invCase(
		"a project whose content was deleted",
		{
			seed: projectAt(0, "standard", { content_deleted_at: EARLIER }),
			fees: with2,
		},
		command({ milestone_index: 1 }),
	),
	invCase(
		"an offer whose terms are an empty object",
		{
			seed: {
				software_offers: [rows.softwareOffer("o1", "r1", { terms_json: "{}" })],
			},
		},
		command(),
	),
	invCase(
		"an offer whose terms are not JSON",
		{
			seed: {
				software_offers: [
					rows.softwareOffer("o1", "r1", { terms_json: "not json" }),
				],
			},
		},
		command(),
	),
];

const siRow = (over: SeedRow = {}) => softwareInvoiceRow("si1", over);

const earlier = (seconds: number) => isoAt(-seconds);

const history: Case[] = [
	invCase(
		"already paid: a milestone deposit is recorded",
		{
			seed: {
				...projectAt(0),
				software_milestone_deposits: [
					{
						request_id: "r1",
						milestone_index: 1,
						paid_recorded_at: EARLIER,
						recorded_by: "owner@example.test",
					},
				],
			},
			fees: with2,
		},
		command({ milestone_index: 1 }),
	),
	invCase(
		"already paid: the milestone payment is recorded for a balance",
		{
			seed: {
				...projectAt(),
				...delivered(),
				software_milestone_payments: [
					{
						request_id: "r1",
						milestone_index: 0,
						paid_recorded_at: EARLIER,
						recorded_by: "owner@example.test",
					},
				],
			},
		},
		command({ kind: "balance" }),
	),
	invCase(
		"already paid: a paid invoice for the deposit",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "paid",
						stripe_invoice_id: "in_p",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a paid invoice that was refunded can be created again",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "paid",
						stripe_invoice_id: "in_p",
						creation_started_at: null,
						refunded_at: EARLIER,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a duplicate: an open invoice for the same deposit",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "open",
						stripe_invoice_id: "in_o",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a duplicate: a creating invoice for the same deposit",
		{ seed: { software_invoices: [siRow()] } },
		command(),
	),
	invCase(
		"a duplicate: a payment_failed invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "payment_failed",
						stripe_invoice_id: "in_f",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a leftover void invoice without replace",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "void",
						stripe_invoice_id: "in_v",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a leftover uncollectible invoice without replace",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "uncollectible",
						stripe_invoice_id: "in_u",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"an invoice of another kind does not block",
		{
			seed: {
				software_invoices: [
					siRow({
						kind: "balance",
						amount_cents: 50_000,
						days_until_due: 15,
						status: "open",
						stripe_invoice_id: "in_o",
						creation_started_at: null,
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"replace a void invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "void",
						stripe_invoice_id: "in_v",
						creation_started_at: null,
						stripe_customer_id: "cus_known",
						attempt: 0,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase(
		"replace a void invoice that was itself a replacement",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "void",
						stripe_invoice_id: "in_v",
						creation_started_at: null,
						attempt: 3,
					}),
					softwareInvoiceRow("si0", {
						status: "void",
						stripe_invoice_id: "in_v0",
						creation_started_at: null,
						attempt: 2,
						created_at: "2026-11-13T10:00:00.000Z",
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase("replace an unknown invoice", {}, command({ replace_id: "nope" })),
	invCase(
		"replace an open invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "open",
						stripe_invoice_id: "in_o",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase(
		"replace an uncollectible invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "uncollectible",
						stripe_invoice_id: "in_u",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase(
		"replace a paid invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "paid",
						stripe_invoice_id: "in_p",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase(
		"replace an invoice of another kind",
		{
			seed: {
				software_invoices: [
					siRow({
						kind: "balance",
						amount_cents: 50_000,
						days_until_due: 15,
						status: "void",
						stripe_invoice_id: "in_v",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
	),
	invCase(
		"retry an invoice stuck in creating for two minutes",
		{
			seed: {
				software_invoices: [
					siRow({
						creation_started_at: earlier(120),
						created_at: earlier(120),
						attempt: 2,
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice whose attempt started thirty seconds ago",
		{
			seed: {
				software_invoices: [siRow({ creation_started_at: earlier(30) })],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice whose attempt started exactly a minute ago",
		{
			seed: {
				software_invoices: [siRow({ creation_started_at: earlier(60) })],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice with no attempt time recorded",
		{ seed: { software_invoices: [siRow({ creation_started_at: null })] } },
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice created 22 hours ago",
		{
			seed: {
				software_invoices: [
					siRow({
						created_at: earlier(22 * 3600),
						creation_started_at: earlier(120),
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice created 24 hours ago",
		{
			seed: {
				software_invoices: [
					siRow({
						created_at: earlier(24 * 3600),
						creation_started_at: earlier(120),
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an open invoice",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "open",
						stripe_invoice_id: "in_o",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase("retry an unknown invoice", {}, command({ retry_id: "nope" })),
	invCase(
		"retry an invoice whose Stripe references were deleted",
		{
			seed: {
				software_invoices: [
					siRow({
						creation_started_at: earlier(120),
						external_refs_deleted_at: EARLIER,
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice when the milestone is no longer available",
		{
			seed: {
				...projectAt(0),
				software_invoices: [siRow({ creation_started_at: earlier(120) })],
			},
		},
		command({ retry_id: "si1" }),
	),
	invCase(
		"retry an invoice that already has a Stripe id",
		{
			seed: {
				software_invoices: [
					siRow({
						stripe_invoice_id: "in_x",
						creation_started_at: earlier(120),
					}),
				],
			},
		},
		command({ retry_id: "si1" }),
	),
];

const STEPS: StripeStep[] = ["customer", "invoice", "item", "finalize", "send"];

const unconfirmed: Case[] = STEPS.flatMap((step) => [
	invCase(`${step} refused with a 400`, {}, command(), {
		fetches: stripeScript({ [step]: stripeError(400, "Invalid request") }),
	}),
	invCase(`${step} fails with a 500 that says not to retry`, {}, command(), {
		fetches: stripeScript({ [step]: stripeDown() }),
	}),
]);

const stripeOddities: Case[] = [
	invCase("customer cannot be reached", {}, command(), {
		fetches: stripeScript({ customer: networkDown("socket hang up") }),
	}),
	invCase("send cannot be reached", {}, command(), {
		fetches: stripeScript({ send: networkDown("socket hang up") }),
	}),
	invCase("a retried 500 that then succeeds", {}, command(), {
		fetches: stripeScript({
			item: [
				stripeError(500, "Stripe hiccup"),
				{
					kind: "response",
					status: 200,
					text: '{"id":"ii_1"}',
					headers: { "content-type": "application/json" },
				},
			],
		}),
	}),
	invCase("an authentication error from Stripe", {}, command(), {
		fetches: stripeScript({
			customer: stripeError(401, "Invalid API Key provided: sk_test_***"),
		}),
	}),
	invCase("send answers a draft invoice", {}, command(), {
		fetches: stripeScript({ send: sendAnswer({ status: "draft" }) }),
	}),
	invCase("send answers no hosted url", {}, command(), {
		fetches: stripeScript({
			send: sendAnswer({ hosted_invoice_url: undefined }),
		}),
	}),
	invCase("send answers an http hosted url", {}, command(), {
		fetches: stripeScript({
			send: sendAnswer({
				hosted_invoice_url: "http://invoice.stripe.test/i/1",
			}),
		}),
	}),
	invCase("send answers another invoice id", {}, command(), {
		fetches: stripeScript({ send: sendAnswer({ id: "in_other" }) }),
	}),
	invCase("send answers no due date", {}, command(), {
		fetches: stripeScript({ send: sendAnswer({ due_date: null }) }),
	}),
	invCase("send answers a due date", {}, command(), {
		fetches: stripeScript({ send: sendAnswer({ due_date: 1_800_000_000 }) }),
	}),
	invCase(
		"a customer already on another invoice is reused",
		{
			seed: {
				software_invoices: [
					softwareInvoiceRow("old", {
						milestone_index: 1,
						status: "paid",
						stripe_invoice_id: "in_old",
						stripe_customer_id: "cus_known",
						creation_started_at: null,
					}),
				],
			},
			fees: with2,
		},
		command(),
	),
	invCase(
		"a request name and offer text with markup",
		{
			seed: {
				owner_requests: [
					rows.softwareRequest("r1", {
						status: "reviewed",
						name: `<b>Grace</b> & "H"`,
					}),
				],
				software_offers: [
					rows.softwareOffer("o1", "r1", {
						terms_json: JSON.stringify({
							...JSON.parse(offerTerms()),
							outcome: `<i>Tool</i> & "x" 🎤`,
							milestones: [
								{
									name: `M<1>`,
									deliverables: ["d"],
									acceptance: ["a"],
									feeCents: 100_000,
								},
							],
						}),
					}),
				],
			},
		},
		command(),
	),
	invCase(
		"a request with no name",
		{
			seed: {
				owner_requests: [
					rows.softwareRequest("r1", { status: "reviewed", name: "" }),
				],
			},
		},
		command(),
	),
];

const FIRST_OFFER_READ = /FROM software_offers o JOIN owner_requests r/;

const failure = (on: RegExp, nth = 1) => ({
	failures: [{ on, message: "D1 unavailable", nth }],
});

const outages: Case[] = [
	invCase(
		"outage: the offer read fails",
		{},
		command(),
		failure(FIRST_OFFER_READ),
	),
	invCase(
		"outage: the project read fails",
		{},
		command(),
		failure(/SELECT \* FROM software_projects WHERE request_id=\?/),
	),
	invCase(
		"outage: the delivery read fails",
		{},
		command(),
		failure(/FROM software_project_updates u/),
	),
	invCase(
		"outage: the milestone payment read fails",
		{},
		command(),
		failure(
			/FROM software_milestone_payments WHERE request_id=\? AND milestone_index=\?/,
		),
	),
	invCase(
		"outage: the invoice list fails",
		{},
		command(),
		failure(/SELECT \* FROM software_invoices WHERE request_id=\?/),
	),
	invCase(
		"outage: the deposit read fails",
		{},
		command(),
		failure(
			/FROM software_milestone_deposits WHERE request_id=\? AND milestone_index=\?/,
		),
	),
	invCase(
		"outage: the customer list fails",
		{},
		command(),
		failure(/SELECT \* FROM software_invoices WHERE request_id=\?/, 2),
	),
	invCase(
		"outage: the reservation batch fails",
		{},
		command(),
		failure(/INSERT INTO software_invoices/),
	),
	invCase(
		"outage: the read after the reservation fails",
		{},
		command(),
		failure(/SELECT \* FROM software_invoices WHERE request_id=\?/, 3),
	),
	invCase(
		"outage: the recipient read fails",
		{},
		command(),
		failure(/SELECT name,email FROM owner_requests/),
	),
	invCase(
		"outage: the offer terms read fails",
		{},
		command(),
		failure(/SELECT terms_json FROM software_offers/),
	),
	invCase(
		"outage: the record update fails",
		{},
		command(),
		failure(/UPDATE software_invoices SET stripe_customer_id=\?/),
	),
	invCase(
		"outage: the record read fails",
		{},
		command(),
		failure(/SELECT \* FROM software_invoices WHERE id=\?/),
	),
	invCase(
		"outage: the retry batch fails",
		{
			seed: {
				software_invoices: [siRow({ creation_started_at: earlier(120) })],
			},
		},
		command({ retry_id: "si1" }),
		failure(/UPDATE software_invoices SET creation_started_at=\?/),
	),
];

const raceOn = (on: RegExp, label: string, sql: string, nth = 1) => ({
	interleave: [
		{
			on,
			label,
			nth,
			run: (sqlite: { exec: (sql: string) => void }) => sqlite.exec(sql),
		},
	],
});

const RESERVE = /INSERT INTO software_invoices/;

const races: Case[] = [
	invCase(
		"race: the request changes before the reservation batch",
		{},
		command(),
		raceOn(
			RESERVE,
			"another change moves the request",
			`UPDATE owner_requests SET updated_at='${isoAt(-5)}'`,
		),
	),
	invCase(
		"race: the offer is superseded before the reservation batch",
		{},
		command(),
		raceOn(
			RESERVE,
			"the offer is superseded",
			`UPDATE software_offers SET status='superseded'`,
		),
	),
	invCase(
		"race: a project starts before the reservation batch",
		{},
		command(),
		raceOn(
			RESERVE,
			"a project is started",
			`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','{}','standard','${EARLIER}','${EARLIER}','${EARLIER}','o','${EARLIER}','${EARLIER}')`,
		),
	),
	invCase(
		"race: the project changes before the reservation batch",
		{ seed: projectAt(0), fees: with2 },
		command({ milestone_index: 1 }),
		raceOn(
			RESERVE,
			"the project is updated",
			`UPDATE software_projects SET updated_at='${isoAt(-5)}'`,
		),
	),
	invCase(
		"race: the project is revoked before the reservation batch",
		{ seed: projectAt(0), fees: with2 },
		command({ milestone_index: 1 }),
		raceOn(
			RESERVE,
			"the project is revoked",
			`UPDATE software_projects SET revoked_at='${isoAt(-5)}',updated_at='${isoAt(-5)}'`,
		),
	),
	invCase(
		"race: another request reserves the same invoice first",
		{},
		command(),
		raceOn(
			RESERVE,
			"another request reserves a deposit",
			`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,allow_card,attempt,creation_started_at,created_by,created_at,updated_at) VALUES ('other','r1','o1',0,'deposit',50000,7,0,0,'${EARLIER}','o','${EARLIER}','${EARLIER}')`,
		),
	),
	invCase(
		"race: the invoice is paid outside Stripe before the reservation batch",
		{},
		command(),
		raceOn(
			RESERVE,
			"the deposit is recorded as paid",
			`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','{}','standard','${EARLIER}','${EARLIER}','${EARLIER}','o','${EARLIER}','${EARLIER}');INSERT INTO software_milestone_deposits(request_id,milestone_index,paid_recorded_at,recorded_by) VALUES ('r1',0,'${EARLIER}','o')`,
		),
	),
	invCase(
		"race: a milestone payment is recorded before the reservation batch",
		{ seed: { ...projectAt(), ...delivered() } },
		command({ kind: "balance" }),
		raceOn(
			RESERVE,
			"the milestone is recorded as paid",
			`INSERT INTO software_milestone_payments(request_id,milestone_index,paid_recorded_at,recorded_by) VALUES ('r1',0,'${EARLIER}','o')`,
		),
	),
	invCase(
		"race: the delivery changes before the reservation batch",
		{ seed: { ...projectAt(), ...delivered() } },
		command({ kind: "balance" }),
		raceOn(
			RESERVE,
			"the client asks for changes",
			`INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r1','client','c1','change','u1','changes_requested','${EARLIER}')`,
		),
	),
	invCase(
		"race: the invoice is voided before the replace batch",
		{
			seed: {
				software_invoices: [
					siRow({
						status: "void",
						stripe_invoice_id: "in_v",
						creation_started_at: null,
					}),
				],
			},
		},
		command({ replace_id: "si1" }),
		raceOn(
			RESERVE,
			"the old invoice is reopened",
			`UPDATE software_invoices SET status='open'`,
		),
	),
	invCase(
		"race: the attempt is retried by another request before the retry batch",
		{
			seed: {
				software_invoices: [siRow({ creation_started_at: earlier(120) })],
			},
		},
		command({ retry_id: "si1" }),
		raceOn(
			/UPDATE software_invoices SET creation_started_at=\?/,
			"another retry starts",
			`UPDATE software_invoices SET creation_started_at='${isoAt(-1)}'`,
		),
	),
	invCase(
		"race: a webhook records the invoice while Stripe works",
		{},
		command(),
		raceOn(
			/UPDATE software_invoices SET stripe_customer_id=\?/,
			"a webhook marks the invoice open",
			`UPDATE software_invoices SET stripe_invoice_id='in_1',status='paid',status_updated_at='${isoAt(-5)}',creation_started_at=NULL`,
		),
	),
	invCase(
		"race: another invoice id is recorded while Stripe works",
		{},
		command(),
		raceOn(
			/UPDATE software_invoices SET stripe_customer_id=\?/,
			"a webhook records another Stripe invoice",
			`UPDATE software_invoices SET stripe_invoice_id='in_other',status='open'`,
		),
	),
	invCase(
		"race: the invoice is fenced for retention while Stripe works",
		{},
		command(),
		raceOn(
			/UPDATE software_invoices SET stripe_customer_id=\?/,
			"retention fences the invoice",
			`UPDATE software_invoices SET retention_fenced_at='${isoAt(-1)}'`,
		),
	),
	invCase(
		"race: the invoice's references are deleted while Stripe works",
		{},
		command(),
		raceOn(
			/UPDATE software_invoices SET stripe_customer_id=\?/,
			"retention deletes the references",
			`UPDATE software_invoices SET external_refs_deleted_at='${isoAt(-1)}'`,
		),
	),
	invCase(
		"race: the recipient email is cleared while Stripe is not yet called",
		{},
		command(),
		raceOn(
			/SELECT name,email FROM owner_requests/,
			"the request email is cleared",
			`UPDATE owner_requests SET email=''`,
		),
	),
	invCase(
		"race: the offer is removed before the terms are read",
		{},
		command(),
		raceOn(
			/SELECT terms_json FROM software_offers/,
			"the offer is moved to another request",
			`UPDATE software_offers SET request_id='r2'`,
		),
	),
];

const LOCAL = uuidFor(1);

const hook = (
	event: Parameters<typeof webhookStep>[0],
	over: Partial<Step> & { at?: number } = {},
) =>
	webhookStep(event, {
		handler: webhook,
		path: "/api/stripe/webhook",
		dump: { music: softwareTables },
		...over,
	});

const meta = (
	id: string,
	over: { [name: string]: string | undefined } = {},
) => ({ software_invoice_id: id, ...over });

// The first five Stripe calls make the invoice "in_s1" (and its customer); the later four, which reuse the customer,
// make "in_s2". The local invoice ids are the harness's UUID counter: uuidFor(1), then uuidFor(2).
const firstInvoice = stripeScript({}, { invoice: "in_s1", customer: "cus_s1" });

const secondInvoice = stripeScript(
	{},
	{ invoice: "in_s2", customer: "cus_s1" },
);

const twoInvoices: Responder = (call) =>
	call.n < 5 ? firstInvoice(call) : secondInvoice(call);

const sequences: Case[] = [
	{
		name: "a deposit, the webhook says paid, then the same deposit again",
		music: { seed: softwareSeed() },
		fetches: twoInvoices,
		steps: [
			ask(command()),
			hook(
				softwareEvent(
					"invoice.paid",
					{},
					{ id: "evt_1", created: NOW_SECONDS + 5 },
					meta(LOCAL),
				),
				{ advanceMs: 1_000 },
			),
			ask(command(), { advanceMs: 1_000 }),
		],
	},
	{
		name: "the whole life: deposit, paid, project started, delivery shared, balance, paid",
		music: { seed: softwareSeed() },
		fetches: twoInvoices,
		steps: [
			ask(command()),
			hook(
				softwareEvent(
					"invoice.paid",
					{},
					{ id: "evt_1", created: NOW_SECONDS + 5 },
					meta(LOCAL),
				),
				{ advanceMs: 1_000 },
			),
			ask(command({ kind: "balance" }), {
				advanceMs: 1_000,
				before: {
					label: "the project is started and a delivery is shared",
					run: (world) =>
						world.music.exec(
							`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','${offerTerms()}','standard','${EARLIER}','${EARLIER}','${EARLIER}','o','${EARLIER}','${EARLIER}');INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,shared_at,created_by,created_at,updated_at) VALUES ('u1','r1','delivery_review','shared',0,'Delivery','working_preview','${EARLIER}','o','${EARLIER}','${EARLIER}')`,
						),
				},
			}),
			hook(
				softwareEvent(
					"invoice.paid",
					{ id: "in_s2" },
					{ id: "evt_2", created: NOW_SECONDS + 20 },
					meta(uuidFor(2), { kind: "balance" }),
				),
				{ advanceMs: 1_000 },
			),
		],
	},
	{
		name: "the same request twice: the second hits the one-active-invoice rule",
		music: { seed: softwareSeed() },
		fetches: stripeScript(),
		steps: [ask(command()), ask(command(), { advanceMs: 1_000 })],
	},
	{
		name: "a stuck create, a too-soon retry, then a retry after a minute reuses the keys",
		music: { seed: softwareSeed() },
		fetches: stripeScript({
			finalize: [stripeDown(), stripeDown(), stripeDown()],
		}),
		steps: [
			ask(command()),
			ask(command({ retry_id: LOCAL }), { advanceMs: 10_000 }),
			ask(command({ retry_id: LOCAL }), { advanceMs: 61_000 }),
		],
	},
	{
		name: "a stuck create is retried and succeeds with the same idempotency keys",
		music: { seed: softwareSeed() },
		fetches: stripeScript({
			finalize: [
				stripeDown(),
				{
					kind: "response",
					status: 200,
					text: JSON.stringify({
						id: "in_1",
						object: "invoice",
						status: "open",
					}),
					headers: { "content-type": "application/json" },
				},
			],
		}),
		steps: [
			ask(command()),
			ask(command({ retry_id: LOCAL }), { advanceMs: 61_000 }),
		],
	},
	{
		name: "a stuck create, a plain repeat, then a retry",
		music: { seed: softwareSeed() },
		fetches: stripeScript({ send: [stripeDown(), sendAnswer({})] }),
		steps: [
			ask(command()),
			ask(command(), { advanceMs: 61_000 }),
			ask(command({ retry_id: LOCAL }), { advanceMs: 1_000 }),
		],
	},
	{
		name: "void by webhook, a create without replace, then a replace",
		music: { seed: softwareSeed() },
		fetches: twoInvoices,
		steps: [
			ask(command()),
			hook(
				softwareEvent(
					"invoice.voided",
					{},
					{ id: "evt_v", created: NOW_SECONDS + 5 },
					meta(LOCAL),
				),
				{ advanceMs: 1_000 },
			),
			ask(command(), { advanceMs: 1_000 }),
			ask(command({ replace_id: LOCAL }), { advanceMs: 1_000 }),
			hook(
				softwareEvent(
					"invoice.paid",
					{ id: "in_s2" },
					{ id: "evt_p", created: NOW_SECONDS + 30 },
					meta(uuidFor(2)),
				),
				{ advanceMs: 1_000 },
			),
		],
	},
	{
		name: "card allowed on the first try, not on the replacement",
		music: { seed: softwareSeed() },
		fetches: twoInvoices,
		steps: [
			ask(command({ allow_card: true })),
			ask(command({ replace_id: LOCAL, allow_card: false }), {
				advanceMs: 1_000,
				before: {
					label: "the invoice is voided in Stripe",
					run: (world) =>
						world.music.exec(`UPDATE software_invoices SET status='void'`),
				},
			}),
		],
	},
	{
		name: "a refused create, then a different milestone",
		music: { seed: softwareSeed({ ...projectAt(0) }, "standard", with2) },
		fetches: stripeScript({ customer: [stripeError(400, "Invalid request")] }),
		steps: [
			ask(command({ milestone_index: 1 })),
			ask(command({ milestone_index: 1 }), { advanceMs: 1_000 }),
		],
	},
];

const cases: Case[] = [
	...guards,
	...reserving,
	...offerGuards,
	...history,
	...unconfirmed,
	...stripeOddities,
	...outages,
	...races,
	...sequences,
];

defineCorpus("owner-request-invoices", POST, cases);
