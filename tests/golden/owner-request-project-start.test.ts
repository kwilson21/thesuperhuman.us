import type { JsonObject, JsonValue } from "../helpers/json";
import { POST } from "~/pages/api/owner/requests/[id]/project";
import {
	asClient,
	asOwner,
	asVisitor,
	byHost,
	defineCorpus,
	json,
	networkDown,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";
import {
	BASE,
	EARLIER,
	ORIGIN,
	details,
	executedSow,
	invoice,
	offerTerms,
	owner,
	resendOk,
	running,
	startBody,
	startable,
} from "./areas/software-projects";

// The golden corpus for the "start" action of POST /api/owner/requests/[id]/project: the owner starts a software
// project from a sent offer once signatures, inputs and the first payment are in. It is the stateful, money-adjacent
// start of the project (see also owner-request-project-state, -money and -notice).
//
// Every response branch of the handler's start path and its helpers, and the cases that reach each:
//
//   shared guards (these run before any action)
//   403 {ok:false}            a visitor, a signed-in client
//   404 {ok:false}            the portal flag false, missing, or in capitals
//   503 {ok:false}            no MUSIC_DB, no id param, an empty id param
//   musicRequest (8192)       403 empty or foreign Origin; 415 text/plain and form; 400 no body, bad JSON, empty body;
//                             413 over 8192 bytes
//   400 "Check both confirmations"  null/array/string body; unknown or missing action; every start field missing, wrong
//                             type, out of range or too long (offer_id, offer_version, expectedRequestUpdatedAt,
//                             signature_source, external_* lengths, inputs_ready, payment, signatures, next_update_on)
//   start, before the batch
//   409 "Finish the website signatures"   outside-site source while a client-signed or executed agreement exists
//   409 "Both signatures, the PDF"        website source with no executed SOW: none at all, only an MSA, an unready PDF,
//                                         one delivered copy, an ended or archive-closed agreement, another offer's SOW
//   400 "Record the signed date"          outside-site source: signatures false, date missing, impossible or badly
//                                         formatted, parties missing or blank after trim, kept copy false or missing, copy
//                                         reference missing
//   400 "cannot be in the future"         a date after today in New York, including after 8 pm New York when UTC is tomorrow
//   400 "purchase order"                  po_requirement before_start with no po_number
//   409 "Wait for the planned start"      planned_start after today with no, partial, invalid or future earlier-start data
//   the details lookup                    no agreement details, details that are not JSON (the catch)
//   start, the batch
//   200 {ok:true}                         outside-site and website sources; first payment by manual path and by a paid
//                                         deposit invoice; request new (audited) and reviewed (not audited); next date
//                                         blank; mixed-case owner email; unicode and markup in the free text
//   200 {ok:true,noticeUnchecked:true}    the invitation claim, the final write, or both throw
//   409 "offer changed"                   stale offer version, unknown or draft or superseded or withdrawn offer, a project
//                                         already there, a resolved or withdrawn request, a blank email, a guard lost
//                                         to a race, the batch throws
//   409 "request changed"                 stale expectedRequestUpdatedAt, a race on the request row
//   409 manualPaymentReminder             a payable invoice (creating, open, payment_failed, uncollectible) at start, by the
//                                         manual path or named as deposit_invoice_id
//   catch lookups throw                   the handler rejects (invoice list throws, request check throws)
//   effects: the invitation email         sent, refused 4xx, 5xx, network down, no key, no sender, recipient lookup throws
//
// Multi-step: start twice; start, then a second start with the earlier updated_at; start, resend the notice.

const TABLES = [
	"owner_requests",
	"owner_request_audit",
	"software_projects",
	"software_project_audit",
	"software_offer_links",
	"software_agreements",
	"software_agreement_events",
	"software_agreement_drafts",
	"software_agreement_sessions",
	"software_agreement_links",
];

const act = (body: JsonValue | undefined, extra: Partial<Step> = {}): Step =>
	owner(body, { dump: { music: TABLES }, ...extra });

const go = (
	name: string,
	body: JsonValue | undefined,
	seed: { [table: string]: readonly SeedRow[] } = startable(),
	extra: Partial<Case> = {},
	step: Partial<Step> = {},
): Case => ({
	name,
	music: { seed },
	fetches: resendOk,
	steps: [act(body, step)],
	...extra,
});

const website = (over: JsonObject = {}) =>
	startBody({
		signature_source: "website",
		external_signed_on: undefined,
		external_parties: undefined,
		external_copy_reference: undefined,
		external_kept_copy: undefined,
		...over,
	});

const withDetails = (over: { [name: string]: string }) =>
	startable({ offer: { agreement_details_json: details(over) } });

const signing = (id: string, over: SeedRow = {}) => ({
	...rows.agreementBase(),
	software_agreements: [rows.agreement(id, "r1", "o1", over)],
});

const NOTICE_CLAIM = /UPDATE software_projects SET invitation_status='sending'/;
const NOTICE_FINAL = /UPDATE software_projects SET invitation_status=\?/;
const BATCH = /INSERT INTO software_projects\(/;

const rawCase = (name: string, body: string, extra: Partial<Step> = {}): Case =>
	go(name, undefined, startable(), {}, { body, ...extra });

const withBody = (
	name: string,
	over: JsonObject,
	seed = startable(),
	extra: Partial<Case> = {},
) => go(name, startBody(over), seed, extra);

const D = (day: string) => `${day}T12:00:00Z`;

const cases: Case[] = [
	// who and where
	go("a visitor", startBody(), startable(), {}, { as: asVisitor() }),
	{
		name: "a signed-in client",
		music: { seed: running() },
		fetches: resendOk,
		steps: [act(startBody(), { as: asClient("grace@example.test") })],
	},
	go("the portal flag is false", startBody(), startable(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "false" },
	}),
	go("the portal flag is missing", startBody(), startable(), {
		omit: ["AUDIO_CLIENT_PORTAL_ENABLED"],
	}),
	go("the portal flag in capitals", startBody(), startable(), {
		env: { AUDIO_CLIENT_PORTAL_ENABLED: "TRUE" },
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [act(startBody())],
	},
	go("no id param", startBody(), startable(), {}, { params: {} }),
	go("an empty id param", startBody(), startable(), {}, { params: { id: "" } }),
	go(
		"an empty origin header",
		startBody(),
		startable(),
		{},
		{ headers: { origin: "" } },
	),
	go(
		"a foreign origin",
		startBody(),
		startable(),
		{},
		{ headers: { origin: "https://evil.example" } },
	),
	rawCase("a text/plain body", JSON.stringify(startBody()), {
		headers: { "content-type": "text/plain" },
	}),
	rawCase("a urlencoded form body", "action=start", {
		headers: { "content-type": "application/x-www-form-urlencoded" },
	}),
	go("no body at all", undefined),
	rawCase("bad JSON", "{nope"),
	rawCase("an empty body", ""),
	withBody("a body over 8192 bytes", { external_parties: "x".repeat(9000) }),
	go("a null body", null),
	go("an array body", []),
	go("a string body", "start"),
	go("an unknown action", { action: "begin" }),
	go("no action", {}),
	// schema
	withBody("an empty offer_id", { offer_id: "" }),
	withBody("a missing offer_id", { offer_id: undefined }),
	withBody("an offer_version of 0", { offer_version: 0 }),
	withBody("a fractional offer_version", { offer_version: 1.5 }),
	withBody("a text offer_version", { offer_version: "1" }),
	withBody("an empty expectedRequestUpdatedAt", {
		expectedRequestUpdatedAt: "",
	}),
	withBody("a missing expectedRequestUpdatedAt", {
		expectedRequestUpdatedAt: undefined,
	}),
	withBody("an unknown signature_source", { signature_source: "paper" }),
	withBody("a missing signature_source", { signature_source: undefined }),
	withBody("external_parties over 500 characters", {
		external_parties: "p".repeat(501),
	}),
	withBody("external_copy_reference over 200 characters", {
		external_copy_reference: "c".repeat(201),
	}),
	withBody("a po_number over 100 characters", { po_number: "n".repeat(101) }),
	withBody("an earlier_start_agreement over 500 characters", {
		earlier_start_agreement: "a".repeat(501),
	}),
	withBody("inputs_ready false", { inputs_ready: false }),
	withBody("inputs_ready missing", { inputs_ready: undefined }),
	withBody("payment false", { payment: false }),
	withBody("payment missing", { payment: undefined }),
	withBody("signatures not a boolean", { signatures: "yes" }),
	withBody("signatures missing", { signatures: undefined }),
	withBody("external_kept_copy not a boolean", { external_kept_copy: "yes" }),
	withBody("next_update_on missing", { next_update_on: undefined }),
	withBody("next_update_on an impossible date", {
		next_update_on: "2026-02-30",
	}),
	withBody("next_update_on in the wrong format", {
		next_update_on: "11/20/2026",
	}),
	withBody("next_update_on not text", { next_update_on: 20261120 }),
	withBody("deposit_invoice_id not text", { deposit_invoice_id: 5 }),
	// outside-site signatures, before the batch
	withBody("an outside-site start", {}),
	withBody("an outside-site start with the date today", {
		external_signed_on: "2026-11-13",
	}),
	withBody("an outside-site start with a very old date", {
		external_signed_on: "2001-01-01",
	}),
	withBody("an outside-site date tomorrow", {
		external_signed_on: "2026-11-14",
	}),
	withBody("an outside-site date far in the future", {
		external_signed_on: "2099-01-01",
	}),
	withBody("an outside-site date impossible", {
		external_signed_on: "2026-02-30",
	}),
	withBody("an outside-site date in the wrong format", {
		external_signed_on: "13 Nov 2026",
	}),
	withBody("an outside-site date missing", { external_signed_on: undefined }),
	withBody("an outside-site date empty", { external_signed_on: "" }),
	withBody("outside-site signatures not confirmed", { signatures: false }),
	withBody("outside-site parties missing", { external_parties: undefined }),
	withBody("outside-site parties blank after trimming", {
		external_parties: "   ",
	}),
	withBody("outside-site kept copy false", { external_kept_copy: false }),
	withBody("outside-site kept copy missing", { external_kept_copy: undefined }),
	withBody("outside-site copy reference missing", {
		external_copy_reference: undefined,
	}),
	withBody("outside-site copy reference blank after trimming", {
		external_copy_reference: "  ",
	}),
	withBody("outside-site text is trimmed and kept as typed", {
		external_parties: '  Zo\u00eb <ops> & "Co"  ',
		external_copy_reference: " \u2603 vault/<1>.pdf ",
	}),
	go(
		"an outside-site date tomorrow in UTC but not yet in New York",
		startBody({ external_signed_on: "2026-11-14" }),
		startable(),
		{},
		{ advanceMs: 15 * 3600_000 },
	),
	go(
		"an outside-site date today in New York at 10 pm",
		startBody({ external_signed_on: "2026-11-13" }),
		startable(),
		{},
		{ advanceMs: 15 * 3600_000 },
	),
	go(
		"an outside-site date the next New York morning",
		startBody({ external_signed_on: "2026-11-14" }),
		startable(),
		{},
		{ advanceMs: 25 * 3600_000 },
	),
	withBody(
		"an outside-site start while a client-signed agreement exists",
		{},
		startable({ extra: signing("a1", { status: "client_signed" }) }),
	),
	withBody(
		"an outside-site start while an executed agreement exists",
		{},
		startable({ extra: signing("a1", { status: "executed" }) }),
	),
	withBody(
		"an outside-site start while an agreement is only in review",
		{},
		startable({ extra: signing("a1", { status: "review" }) }),
	),
	withBody(
		"an outside-site start while an agreement is abandoned",
		{},
		startable({ extra: signing("a1", { status: "abandoned" }) }),
	),
	withBody(
		"an outside-site start retires the signing links, sessions and drafts",
		{},
		startable({
			extra: {
				...signing("a1", { status: "review" }),
				software_offer_links: [rows.offerLink("r1")],
				software_agreement_drafts: [
					{
						offer_id: "o1",
						recipient_email: "grace@example.test",
						values_json: "{}",
						updated_at: EARLIER,
					},
				],
				software_agreement_links: [
					{
						id: "l1",
						purpose: "agreement",
						offer_id: "o1",
						recipient_email: "grace@example.test",
						token_hash: "lt1",
						issued_at: EARLIER,
						expires_at: "2026-12-01T00:00:00.000Z",
					},
				],
				software_agreement_sessions: [
					{
						token_hash: "st1",
						purpose: "agreement",
						offer_id: "o1",
						recipient_email: "grace@example.test",
						link_id: "l1",
						verified_at: EARLIER,
						expires_at: "2026-12-01T00:00:00.000Z",
						csrf_nonce: "n",
					},
				],
			},
		}),
	),
	withBody(
		"an outside-site start with an offer link already revoked",
		{},
		startable({
			extra: {
				software_offer_links: [rows.offerLink("r1", { revoked_at: EARLIER })],
			},
		}),
	),
	// website signatures
	go("a website start", website(), startable({ extra: executedSow() })),
	go(
		"a website start with the signature box unticked",
		website({ signatures: false }),
		startable({ extra: executedSow() }),
	),
	go(
		"a website start with outside-site fields that are ignored",
		website({ external_signed_on: "2099-01-01", external_parties: "Ignored" }),
		startable({ extra: executedSow() }),
	),
	go("a website start with no agreement", website()),
	go(
		"a website start with only an MSA",
		website(),
		startable({
			extra: {
				...rows.agreementBase(),
				software_agreements: [
					rows.agreement("a1", "r1", "o1", {
						kind: "msa",
						status: "executed",
						executed_at: EARLIER,
					}),
				],
			},
		}),
	),
	go(
		"a website start with an SOW awaiting countersignature",
		website(),
		startable({ extra: executedSow({ status: "client_signed" }) }),
	),
	go(
		"a website start whose PDF is not ready",
		website(),
		startable({
			extra: {
				...executedSow(),
				software_agreement_artifacts: [
					{ agreement_id: "a1", status: "pending" },
				],
			},
		}),
	),
	go(
		"a website start with one delivered copy",
		website(),
		startable({
			extra: {
				...executedSow(),
				software_agreement_deliveries: [
					{
						agreement_id: "a1",
						recipient_role: "client",
						email: "grace@example.test",
						status: "sent",
						sent_at: EARLIER,
					},
				],
			},
		}),
	),
	go(
		"a website start with one copy delivered another way",
		website(),
		startable({
			extra: {
				...executedSow(),
				software_agreement_deliveries: [
					{
						agreement_id: "a1",
						recipient_role: "client",
						email: "grace@example.test",
						status: "failed",
						alternate_delivered_at: EARLIER,
						alternate_method: "hand",
					},
					{
						agreement_id: "a1",
						recipient_role: "contractor",
						email: "owner@example.test",
						status: "sent",
						sent_at: EARLIER,
					},
				],
			},
		}),
	),
	go(
		"a website start with a failed delivery",
		website(),
		startable({
			extra: {
				...executedSow(),
				software_agreement_deliveries: [
					{
						agreement_id: "a1",
						recipient_role: "client",
						email: "grace@example.test",
						status: "failed",
					},
					{
						agreement_id: "a1",
						recipient_role: "contractor",
						email: "owner@example.test",
						status: "sent",
						sent_at: EARLIER,
					},
				],
			},
		}),
	),
	go(
		"a website start with an ended agreement",
		website(),
		startable({ extra: executedSow({ ended_at: EARLIER }) }),
	),
	go(
		"a website start with an executed agreement that has no executed_at",
		website(),
		startable({ extra: executedSow({ executed_at: null }) }),
	),
	go("a website start with another offer's SOW", website(), {
		...startable({ extra: executedSow() }),
		software_offers: [
			rows.softwareOffer("o1", "r1", {
				terms_json: offerTerms(),
				agreement_details_json: details(),
			}),
			rows.softwareOffer("o9", "r1", {
				version: 2,
				status: "draft",
				terms_json: offerTerms(),
			}),
		],
		software_agreements: [
			rows.agreement("a1", "r1", "o9", {
				kind: "sow",
				status: "executed",
				executed_at: EARLIER,
			}),
		],
	}),
	// purchase order and planned start
	go(
		"a purchase order is required and missing",
		startBody(),
		withDetails({ po_requirement: "before_start" }),
	),
	go(
		"a purchase order is required and given",
		startBody({ po_number: "PO-7731" }),
		withDetails({ po_requirement: "before_start" }),
	),
	go(
		"a purchase order is required and blank after trimming",
		startBody({ po_number: "   " }),
		withDetails({ po_requirement: "before_start" }),
	),
	go(
		"a purchase order is not required but given",
		startBody({ po_number: "PO-1" }),
	),
	go(
		"a purchase order required after start and missing",
		startBody(),
		withDetails({ po_requirement: "before_invoice" }),
	),
	go(
		"the planned start is in the future with nothing recorded",
		startBody(),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future with only the agreement",
		startBody({ earlier_start_agreement: "Client agreed by email" }),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future with only the date",
		startBody({ earlier_start_on: "2026-11-12" }),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future with an invalid earlier date",
		startBody({
			earlier_start_agreement: "Client agreed",
			earlier_start_on: "2026-13-01",
		}),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future with an earlier date in the future",
		startBody({
			earlier_start_agreement: "Client agreed",
			earlier_start_on: "2026-11-20",
		}),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future with a dated agreement",
		startBody({
			earlier_start_agreement: "Client agreed by email <ok> & more",
			earlier_start_on: "2026-11-12",
		}),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is in the future and the earlier date is today",
		startBody({
			earlier_start_agreement: "Client agreed",
			earlier_start_on: "2026-11-13",
		}),
		withDetails({ planned_start: "2026-12-01" }),
	),
	go(
		"the planned start is today",
		startBody(),
		withDetails({ planned_start: "2026-11-13" }),
	),
	go(
		"the planned start is tomorrow",
		startBody(),
		withDetails({ planned_start: "2026-11-14" }),
	),
	go(
		"an offer with no agreement details",
		startBody(),
		startable({ offer: { agreement_details_json: null } }),
	),
	go(
		"agreement details that are not JSON",
		startBody(),
		startable({ offer: { agreement_details_json: "{not json" } }),
	),
	go(
		"agreement details that are JSON null",
		startBody(),
		startable({ offer: { agreement_details_json: "null" } }),
	),
	go(
		"agreement details with no planned start",
		startBody(),
		startable({
			offer: {
				agreement_details_json: JSON.stringify({
					po_requirement: "not_required",
				}),
			},
		}),
	),
	// the request and offer rows
	go(
		"a request already in review",
		startBody(),
		startable({ request: { status: "reviewed" } }),
	),
	go(
		"a resolved request",
		startBody(),
		startable({ request: { status: "resolved" } }),
	),
	go(
		"a withdrawn request",
		startBody(),
		startable({ request: { status: "withdrawn" } }),
	),
	go(
		"a request with a blank email",
		startBody(),
		startable({ request: { email: "" } }),
	),
	go(
		"a stale expectedRequestUpdatedAt",
		startBody({ expectedRequestUpdatedAt: "2026-11-13T10:00:00.000Z" }),
	),
	go("an unknown offer", startBody({ offer_id: "nope" })),
	go("a stale offer version", startBody({ offer_version: 2 })),
	go("a draft offer", startBody(), startable({ offer: { status: "draft" } })),
	go(
		"a superseded offer",
		startBody(),
		startable({ offer: { status: "superseded" } }),
	),
	go(
		"a withdrawn offer",
		startBody(),
		startable({ offer: { status: "withdrawn" } }),
	),
	go(
		"an unknown request id",
		startBody(),
		startable(),
		{},
		{ path: `${BASE}/nope/project`, params: { id: "nope" } },
	),
	go("a software request that is not software", startBody(), {
		owner_requests: [rows.ownerRequest("r1", { kind: "service" })],
	}),
	go("a project is already there", startBody(), {
		...startable(),
		software_projects: [
			rows.softwareProject("r1", "o1", { terms_json: offerTerms() }),
		],
	}),
	go(
		"a mixed-case owner email",
		startBody(),
		startable(),
		{},
		{ as: asOwner("Owner@Example.TEST") },
	),
	go("a blank next date", startBody({ next_update_on: "" })),
	go("an invoice-mode offer", startBody(), startable({ mode: "invoice" })),
	go(
		"a three-milestone offer",
		startBody(),
		startable({ fees: [100_000, 200_000, 300_000] }),
	),
	go(
		"an offer whose terms are not valid",
		startBody(),
		startable({ offer: { terms_json: "{}" } }),
	),
	// first payment
	go(
		"a paid deposit invoice is named",
		startBody({ deposit_invoice_id: "i1" }),
		startable({ extra: { software_invoices: [invoice("i1", "paid")] } }),
	),
	go(
		"an open invoice is named",
		startBody({ deposit_invoice_id: "i1" }),
		startable({ extra: { software_invoices: [invoice("i1", "open")] } }),
	),
	go(
		"a void invoice is named",
		startBody({ deposit_invoice_id: "i1" }),
		startable({ extra: { software_invoices: [invoice("i1", "void")] } }),
	),
	go(
		"a refunded paid invoice is named",
		startBody({ deposit_invoice_id: "i1" }),
		startable({
			extra: {
				software_invoices: [invoice("i1", "paid", { refunded_at: EARLIER })],
			},
		}),
	),
	go("an unknown invoice is named", startBody({ deposit_invoice_id: "nope" })),
	go(
		"an empty invoice id takes the manual path",
		startBody({ deposit_invoice_id: "" }),
	),
	go(
		"a paid invoice of another milestone is named",
		startBody({ deposit_invoice_id: "i1" }),
		startable({
			extra: {
				software_invoices: [invoice("i1", "paid", { milestone_index: 1 })],
			},
		}),
	),
	go(
		"a paid balance invoice is named as the deposit",
		startBody({ deposit_invoice_id: "i1" }),
		startable({
			extra: {
				software_invoices: [invoice("i1", "paid", { kind: "balance" })],
			},
		}),
	),
	go(
		"a paid invoice of another offer is named",
		startBody({ deposit_invoice_id: "i1" }),
		{
			...startable(),
			software_offers: [
				rows.softwareOffer("o1", "r1", {
					terms_json: offerTerms(),
					agreement_details_json: details(),
				}),
				rows.softwareOffer("o2", "r1", {
					version: 2,
					status: "superseded",
					terms_json: offerTerms(),
				}),
			],
			software_invoices: [
				rows.softwareInvoice("i1", "r1", "o2", { status: "paid" }),
			],
		},
	),
	...["creating", "open", "payment_failed", "uncollectible"].map((status) =>
		go(
			`the manual path with a ${status} deposit invoice`,
			startBody(),
			startable({ extra: { software_invoices: [invoice("i1", status)] } }),
		),
	),
	...["paid", "void"].map((status) =>
		go(
			`the manual path with a ${status} deposit invoice`,
			startBody(),
			startable({ extra: { software_invoices: [invoice("i1", status)] } }),
		),
	),
	go(
		"the manual path with an open invoice of another milestone",
		startBody(),
		startable({
			extra: {
				software_invoices: [invoice("i1", "open", { milestone_index: 1 })],
			},
		}),
	),
	go(
		"the manual path with an open balance invoice",
		startBody(),
		startable({
			extra: {
				software_invoices: [invoice("i1", "open", { kind: "balance" })],
			},
		}),
	),
	go(
		"a named paid invoice while another deposit invoice is open",
		startBody({ deposit_invoice_id: "i1" }),
		startable({
			extra: {
				software_invoices: [
					invoice("i1", "paid"),
					invoice("i2", "open", { stripe_invoice_id: "in_2" }),
				],
			},
		}),
	),
	// the invitation email
	go("the invitation is refused with 422", startBody(), startable(), {
		fetches: byHost({ resend: json(422, {}) }),
	}),
	go("the invitation gets a 500", startBody(), startable(), {
		fetches: byHost({ resend: json(500, {}) }),
	}),
	go("the network is down for the invitation", startBody(), startable(), {
		fetches: byHost({ resend: networkDown() }),
	}),
	go("no RESEND_API_KEY for the invitation", startBody(), startable(), {
		omit: ["RESEND_API_KEY"],
	}),
	go("no CONTACT_FROM_EMAIL for the invitation", startBody(), startable(), {
		omit: ["CONTACT_FROM_EMAIL"],
	}),
	go("the invitation claim throws", startBody(), startable(), {
		failures: [{ on: NOTICE_CLAIM, message: "d1 down" }],
	}),
	go("the invitation final write throws", startBody(), startable(), {
		failures: [{ on: NOTICE_FINAL, message: "d1 down" }],
	}),
	go("the invitation recipient lookup throws", startBody(), startable(), {
		failures: [
			{
				on: /SELECT r\.email FROM owner_requests r JOIN software_projects p/,
				message: "d1 down",
			},
		],
	}),
	go(
		"the invitation claim and final write both throw",
		startBody(),
		startable(),
		{
			failures: [
				{ on: NOTICE_CLAIM, message: "d1 down" },
				{ on: NOTICE_FINAL, message: "d1 down" },
			],
		},
	),
	// outages and races
	go("the start batch throws", startBody(), startable(), {
		failures: [{ on: BATCH, message: "d1 down" }],
	}),
	go(
		"the start batch throws with an open deposit invoice",
		startBody(),
		startable({ extra: { software_invoices: [invoice("i1", "open")] } }),
		{ failures: [{ on: BATCH, message: "d1 down" }] },
	),
	go(
		"the start batch throws after the request changed",
		startBody(),
		startable(),
		{
			failures: [{ on: BATCH, message: "d1 down" }],
			interleave: [
				{
					on: BATCH,
					label: "the request changes",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	go(
		"the start batch throws and the invoice list throws",
		startBody(),
		startable(),
		{
			failures: [
				{ on: BATCH, message: "d1 down" },
				{
					on: /FROM software_invoices WHERE request_id=\?/,
					message: "d1 down",
				},
			],
		},
	),
	go(
		"the start batch throws and the request check throws",
		startBody(),
		startable(),
		{
			failures: [
				{ on: BATCH, message: "d1 down" },
				{ on: /^SELECT 1 FROM owner_requests WHERE id=\?/, message: "d1 down" },
			],
		},
	),
	go("the details lookup throws", startBody(), startable(), {
		failures: [
			{
				on: /SELECT agreement_details_json FROM software_offers/,
				message: "d1 down",
			},
		],
	}),
	go("the agreement lookup throws", startBody(), startable(), {
		failures: [
			{
				on: /SELECT \* FROM software_agreements WHERE offer_id=\?/,
				message: "d1 down",
			},
		],
	}),
	go(
		"the request changes between the pre-checks and the batch",
		startBody(),
		startable(),
		{
			interleave: [
				{
					on: BATCH,
					label: "the request changes",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE owner_requests SET updated_at='2026-11-13T11:30:00.000Z'`,
						),
				},
			],
		},
	),
	go("another start wins the race", startBody(), startable(), {
		interleave: [
			{
				on: BATCH,
				label: "a project is started",
				run: (sqlite) =>
					sqlite.exec(
						`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r1','o1','${offerTerms()}','standard','${EARLIER}','${EARLIER}','${EARLIER}','x','${EARLIER}','${EARLIER}')`,
					),
			},
		],
	}),
	go(
		"the request is withdrawn between the pre-checks and the batch",
		startBody(),
		startable(),
		{
			interleave: [
				{
					on: BATCH,
					label: "the request is withdrawn",
					run: (sqlite) =>
						sqlite.exec(`UPDATE owner_requests SET status='withdrawn'`),
				},
			],
		},
	),
	go(
		"the offer is superseded between the pre-checks and the batch",
		startBody(),
		startable(),
		{
			interleave: [
				{
					on: BATCH,
					label: "the offer is superseded",
					run: (sqlite) =>
						sqlite.exec(`UPDATE software_offers SET status='superseded'`),
				},
			],
		},
	),
	go(
		"a deposit invoice opens between the pre-checks and the batch",
		startBody(),
		startable(),
		{
			interleave: [
				{
					on: BATCH,
					label: "an invoice opens",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at) VALUES ('i9','r1','o1',0,'deposit',50000,7,'open','o','${EARLIER}','${EARLIER}')`,
						),
				},
			],
		},
	),
	go(
		"a client signs between the pre-checks and the batch",
		startBody(),
		startable(),
		{
			interleave: [
				{
					on: BATCH,
					label: "a client signs",
					run: (sqlite) => {
						sqlite.exec(`INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES ('template-msa','msa',1,'MSA','${"0".repeat(64)}','${EARLIER}','o');
		INSERT INTO software_agreement_clients(id,recipient_email,legal_name,legal_name_key,entity_type,jurisdiction,business_address,notice_email,created_at) VALUES ('client-1','grace@example.test','G','g','llc','VA','a','grace@example.test','${EARLIER}');
		INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES ('a1','msa','o1','r1','client-1','template-msa','client_signed','MSA','${"0".repeat(64)}','{}','${EARLIER}','2026-11-13','h')`);
					},
				},
			],
		},
	),
	go(
		"the signed SOW ends between the pre-checks and a website batch",
		website(),
		startable({ extra: executedSow() }),
		{
			interleave: [
				{
					on: BATCH,
					label: "the agreement is closed",
					run: (sqlite) =>
						sqlite.exec(`UPDATE software_agreements SET ended_at='${EARLIER}'`),
				},
			],
		},
	),
	go(
		"a delivered copy is withdrawn between the pre-checks and a website batch",
		website(),
		startable({ extra: executedSow() }),
		{
			interleave: [
				{
					on: BATCH,
					label: "a delivery is marked failed",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_agreement_deliveries SET status='failed' WHERE recipient_role='client'`,
						),
				},
			],
		},
	),
	// sequences
	{
		name: "start, then start again",
		music: { seed: startable() },
		fetches: resendOk,
		steps: [act(startBody()), act(startBody(), { advanceMs: 5000 })],
	},
	{
		name: "start refused for a stale date, then started with the fresh date",
		music: { seed: startable() },
		fetches: resendOk,
		steps: [
			act(startBody({ expectedRequestUpdatedAt: "2026-11-13T10:00:00.000Z" })),
			act(startBody(), { advanceMs: 5000 }),
		],
	},
	{
		name: "start refused for a missing purchase order, then started with one",
		music: { seed: withDetails({ po_requirement: "before_start" }) },
		fetches: resendOk,
		steps: [
			act(startBody()),
			act(startBody({ po_number: "PO-1" }), { advanceMs: 5000 }),
		],
	},
	{
		name: "start refused while an invoice is open, then started once it is void",
		music: {
			seed: startable({
				extra: { software_invoices: [invoice("i1", "open")] },
			}),
		},
		fetches: resendOk,
		steps: [
			act(startBody()),
			act(startBody(), {
				advanceMs: 5000,
				before: {
					label: "the invoice is voided in Stripe",
					run: (world) => {
						world.music.exec(`UPDATE software_invoices SET status='void'`);
					},
				},
			}),
		],
	},
	{
		name: "a start whose invitation was refused, then a second start",
		music: { seed: startable() },
		fetches: byHost({ resend: [json(500, {}), json(200, {})] }),
		steps: [act(startBody()), act(startBody(), { advanceMs: 5000 })],
	},
];

defineCorpus("owner-request-project-start", POST, cases);
