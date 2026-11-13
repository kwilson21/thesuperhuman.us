import { POST } from "~/pages/api/stripe/webhook";
import {
	attempt,
	audioEvent,
	audioSeed,
	audioTables,
	balanceEvent,
	balanceInvoice,
	bookingInvoice,
	EARLIER,
	INVOICE_EVENTS,
	isoAt,
	NOW_SECONDS,
	offerTerms,
	softwareEvent,
	softwareInvoiceRow,
	softwareSeed,
	softwareTables,
	startedProject,
	webhookStep,
} from "./areas/payments";
import {
	defineCorpus,
	rows,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The golden corpus for POST /api/stripe/webhook: Stripe tells the site an invoice was sent, paid, failed, voided or marked
// uncollectible. The real Stripe SDK checks the signature (signStripeWebhook signs on the frozen clock). Nothing here calls
// Stripe; the route only writes to MUSIC_DB.
//
// Every response branch of the handler, applyStripeInvoiceEvent, recoverInvoiceFromWebhook, recordUnmatchedStripeEvent,
// applySoftwareInvoiceEvent and verifyStripeWebhook, and the cases that reach it:
//
//   handler
//   400 {received:false} no signature        no header, empty header (before the database check)
//   503 {received:false} no MUSIC_DB         valid signature and no binding
//   400 {received:false} verify throws       no STRIPE_WEBHOOK_SECRET, no STRIPE_SECRET_KEY, empty secret, wrong secret,
//                                            malformed header, timestamp only, v0 only, 301s old, 10 minutes stale, a body
//                                            changed after signing, non-JSON body, empty body
//   200 {received:true} signature accepted   299s old, ten minutes in the future (the SDK accepts it), two v1 values,
//                                            flag STRIPE_PAYMENTS_ENABLED off or missing (the webhook ignores the flag)
//   200 {received:true} ignored              array, string and empty-object bodies; nine unrelated event types; metadata
//                                            missing, empty, no installment, installment not booking/balance, no invoice id,
//                                            empty request id, software metadata with no invoice id
//   uncaught (handler rejects)               body null, no data.object, data.object null; the first payment read fails;
//                                            the known-attempt check fails; any failure inside recovery or while recording
//                                            an unmatched event; an unreadable created time on an unmatched invoice
//   500 {received:false}                     the status apply throws (duplicate check, invoice read, batch, read after the
//                                            batch, a created time that is not a date); software apply throws
//   audio path (applyStripeInvoiceEvent)     5 event types x 7 booking starting statuses, 5 balance events, 6 other balance
//                                            starts, event older / equal / newer than the stored time, out-of-order and
//                                            duplicate deliveries, races (same event recorded first, paid outside Stripe,
//                                            a newer event first)
//   audio conflict (known attempt)           an invoice that is not the request's but is in stripe_invoice_attempts
//   audio recovery                           unknown invoice for each event type and installment; wrong amount, no total,
//                                            wrong or no currency, balance before booking paid, booking paid outside Stripe,
//                                            reserved creation (cleared), deleted references (discarded), no payment row or
//                                            request ("request-not-found"), customer as object or absent, a later event
//                                            after recovery, and races before the recovery batch
//   software path (applySoftwareInvoiceEvent)
//                                            5 events x 6 starting statuses for a deposit; balance and milestone kinds; the
//                                            milestone payment row and its audit for a paid balance or milestone with a
//                                            project; mismatches of local id, request, offer, milestone, kind, Stripe id,
//                                            status without an id, total, currency, retention fence, deleted references (all
//                                            recorded as unmatched); ordering by time and by status rank; duplicates;
//                                            hosted url, due date and customer handling; outages and races
//
// A case that sends a Stripe call is not here: this route makes none.

const WEBHOOK = "/api/stripe/webhook";

type Event = Parameters<typeof webhookStep>[0];

type Options = Parameters<typeof webhookStep>[1];

/** The stripe-signature header of a step built by webhookStep (its headers are a plain object). */
const signatureOf = (step: Step) =>
	typeof step.headers === "object" ? step.headers["stripe-signature"] : "";

const audioCase = (
	name: string,
	payment: SeedRow | null,
	event: Event,
	extra: Partial<Case> = {},
	step: Options = {},
): Case => ({
	name,
	music: { seed: audioSeed(payment) },
	steps: [webhookStep(event, step)],
	...extra,
});

const softwareStep = (event: Event, over: Options = {}) =>
	webhookStep(event, { dump: { music: softwareTables }, ...over });

const softwareCase = (
	name: string,
	invoice: SeedRow | null,
	event: Event,
	extra: Partial<Case> & { seed?: { [table: string]: SeedRow[] } } = {},
): Case => {
	const { seed, ...rest } = extra;

	return {
		name,
		music: {
			seed: softwareSeed({
				software_invoices: invoice ? [invoice] : [],
				...seed,
			}),
		},
		steps: [softwareStep(event)],
		...rest,
	};
};

const FIRST_PAYMENT_READ = /FROM audio_payments WHERE request_id=\?/;
const BY_INVOICE_READ = /FROM audio_payments\s+WHERE booking_invoice_id=\?/;

const webhookEventRow = (id: string, invoice = "in_x"): SeedRow => ({
	id,
	event_type: "invoice.paid",
	invoice_id: invoice,
	occurred_at: isoAt(-90),
	processed_at: isoAt(-80),
});

const transport: Case[] = [
	{
		name: "no stripe-signature header",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			{
				path: WEBHOOK,
				body: JSON.stringify(audioEvent("invoice.paid")),
				dump: { music: audioTables },
			},
		],
	},
	audioCase(
		"an empty stripe-signature header",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ headers: { "stripe-signature": "" } },
	),
	{
		name: "no signature and no database: the signature check comes first",
		music: { missing: true },
		steps: [
			{ path: WEBHOOK, body: JSON.stringify(audioEvent("invoice.paid")) },
		],
	},
	{
		name: "a valid signature and no database binding",
		music: { missing: true },
		steps: [webhookStep(audioEvent("invoice.paid"))],
	},
	audioCase(
		"a valid signature but no STRIPE_WEBHOOK_SECRET",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ omit: ["STRIPE_WEBHOOK_SECRET"] },
	),
	audioCase(
		"a valid signature but no STRIPE_SECRET_KEY",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ omit: ["STRIPE_SECRET_KEY"] },
	),
	audioCase(
		"an empty STRIPE_WEBHOOK_SECRET",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ env: { STRIPE_WEBHOOK_SECRET: "" } },
	),
	audioCase(
		"payments flag off: the webhook still applies the event",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ env: { STRIPE_PAYMENTS_ENABLED: "false" } },
	),
	audioCase(
		"payments flag missing: the webhook still applies the event",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ omit: ["STRIPE_PAYMENTS_ENABLED"] },
	),
	audioCase(
		"a signature made with the wrong secret",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ secret: "whsec_other" },
	),
	audioCase(
		"a signature header that is not t= and v1= pairs",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ headers: { "stripe-signature": "garbage" } },
	),
	audioCase(
		"a signature header with only a timestamp",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ headers: { "stripe-signature": `t=${NOW_SECONDS}` } },
	),
	audioCase(
		"a signature header with only a v0 scheme",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ headers: { "stripe-signature": `t=${NOW_SECONDS},v0=abcd` } },
	),
	audioCase(
		"a signature that is stale by ten minutes",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ at: NOW_SECONDS - 600 },
	),
	audioCase(
		"a signature that is 299 seconds old",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ at: NOW_SECONDS - 299 },
	),
	audioCase(
		"a signature that is 301 seconds old",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ at: NOW_SECONDS - 301 },
	),
	audioCase(
		"a signature dated ten minutes ahead",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{},
		{ at: NOW_SECONDS + 600 },
	),
	{
		name: "a body changed after it was signed",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			{
				...webhookStep(audioEvent("invoice.paid")),
				body: JSON.stringify(audioEvent("invoice.voided")),
			},
		],
	},
	audioCase(
		"a signed body that is not JSON",
		{ ...bookingInvoice("open") },
		"{not json",
	),
	audioCase("a signed empty body", { ...bookingInvoice("open") }, ""),
	audioCase(
		"a signed body that is a JSON array",
		{ ...bookingInvoice("open") },
		"[]",
	),
	audioCase(
		"a signed body that is the JSON null",
		{ ...bookingInvoice("open") },
		"null",
	),
	audioCase(
		"a signed body that is a JSON string",
		{ ...bookingInvoice("open") },
		'"invoice.paid"',
	),
	audioCase("a signed empty object", { ...bookingInvoice("open") }, "{}"),
	audioCase(
		"an invoice event with no data object",
		{ ...bookingInvoice("open") },
		{ id: "evt_1", type: "invoice.paid", created: NOW_SECONDS - 60 },
	),
	audioCase(
		"an invoice event whose data.object is null",
		{ ...bookingInvoice("open") },
		{
			id: "evt_1",
			type: "invoice.paid",
			created: NOW_SECONDS - 60,
			data: { object: null },
		},
	),
	(() => {
		const valid = webhookStep(audioEvent("invoice.paid"));

		return audioCase(
			"a body with two signatures, one valid",
			{ ...bookingInvoice("open") },
			audioEvent("invoice.paid"),
			{},
			{
				headers: {
					"stripe-signature": `${signatureOf(valid)},v1=${"0".repeat(64)}`,
				},
			},
		);
	})(),
];

const unrelated: Case[] = [
	"customer.created",
	"invoice.created",
	"invoice.finalized",
	"invoice.updated",
	"invoice.payment_succeeded",
	"invoice.deleted",
	"payment_intent.succeeded",
	"checkout.session.completed",
	"",
].map((type) =>
	audioCase(
		`an unrelated event type: ${type || "empty"}`,
		{ ...bookingInvoice("open") },
		audioEvent(type),
	),
);

// An audio booking invoice in each status, hit by each invoice event.
const STARTS = [
	"not_created",
	"draft",
	"open",
	"payment_failed",
	"paid",
	"void",
	"uncollectible",
] as const;

const bookingMatrix: Case[] = STARTS.flatMap((start) =>
	INVOICE_EVENTS.map((type) =>
		audioCase(
			`booking ${start} then ${type}`,
			{ ...bookingInvoice(start) },
			audioEvent(type),
		),
	),
);

const balanceMatrix: Case[] = [
	...INVOICE_EVENTS.map((type) =>
		audioCase(
			`balance open then ${type}`,
			{ ...balanceInvoice("open") },
			balanceEvent(type),
		),
	),
	...STARTS.flatMap((start) =>
		start === "open"
			? []
			: [
					audioCase(
						`balance ${start} then invoice.paid`,
						{ ...balanceInvoice(start) },
						balanceEvent("invoice.paid"),
					),
				],
	),
];

const ordering: Case[] = [
	audioCase(
		"an event older than the stored status time is recorded but not applied",
		{
			...bookingInvoice("payment_failed", {
				booking_status_updated_at: isoAt(-30),
			}),
		},
		audioEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	audioCase(
		"an event at the same time as the stored status time is applied",
		{
			...bookingInvoice("payment_failed", {
				booking_status_updated_at: isoAt(-60),
			}),
		},
		audioEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	audioCase(
		"an event newer than the stored status time is applied",
		{
			...bookingInvoice("payment_failed", {
				booking_status_updated_at: isoAt(-90),
			}),
		},
		audioEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	audioCase(
		"an older paid event after a newer failure is dropped",
		{
			...bookingInvoice("payment_failed", {
				booking_status_updated_at: isoAt(-30),
			}),
		},
		audioEvent("invoice.paid", {}, { created: NOW_SECONDS - 60 }),
	),
	audioCase(
		"a balance event older than the stored balance time is not applied",
		{ ...balanceInvoice("void", { balance_status_updated_at: isoAt(-10) }) },
		balanceEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	{
		name: "paid, then a later sent event",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.paid", {}, { id: "evt_paid" })),
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_sent", created: NOW_SECONDS + 30 },
				),
				{ advanceMs: 90_000, at: NOW_SECONDS + 90 },
			),
		],
	},
	{
		name: "paid, then a payment_failed event",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.paid", {}, { id: "evt_paid" })),
			webhookStep(
				audioEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_fail", created: NOW_SECONDS },
				),
				{ advanceMs: 90_000, at: NOW_SECONDS + 90 },
			),
		],
	},
	{
		name: "sent, failed, then paid, each newer than the last",
		music: { seed: audioSeed({ ...bookingInvoice("draft") }) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_a", created: NOW_SECONDS - 300 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_b", created: NOW_SECONDS - 200 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.paid",
					{},
					{ id: "evt_c", created: NOW_SECONDS - 100 },
				),
			),
		],
	},
	{
		name: "delivery out of order: failed arrives before the older sent",
		music: { seed: audioSeed({ ...bookingInvoice("draft") }) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_b", created: NOW_SECONDS - 200 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_a", created: NOW_SECONDS - 300 },
				),
			),
		],
	},
	{
		name: "delivery out of order: the older paid arrives after a newer sent",
		music: { seed: audioSeed({ ...bookingInvoice("draft") }) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_s", created: NOW_SECONDS - 100 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.paid",
					{},
					{ id: "evt_p", created: NOW_SECONDS - 200 },
				),
			),
		],
	},
	{
		name: "the same event delivered twice",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.paid")),
			webhookStep(audioEvent("invoice.paid")),
		],
	},
	{
		name: "the same event delivered three times",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.payment_failed")),
			webhookStep(audioEvent("invoice.payment_failed")),
			webhookStep(audioEvent("invoice.payment_failed")),
		],
	},
	{
		name: "two events with the same id but different types: the second is a duplicate",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.payment_failed", {}, { id: "evt_same" })),
			webhookStep(audioEvent("invoice.paid", {}, { id: "evt_same" })),
		],
	},
	{
		name: "a duplicate event id for a different invoice of the same request",
		music: { seed: audioSeed({ ...balanceInvoice("open") }) },
		steps: [
			webhookStep(audioEvent("invoice.paid", {}, { id: "evt_same" })),
			webhookStep(balanceEvent("invoice.paid", {}, { id: "evt_same" })),
		],
	},
	{
		name: "a duplicate event id that was recorded for an invoice no longer on any request",
		music: {
			seed: audioSeed(
				{ ...bookingInvoice("open") },
				{ stripe_webhook_events: [webhookEventRow("evt_seen")] },
			),
		},
		steps: [webhookStep(audioEvent("invoice.paid", {}, { id: "evt_seen" }))],
	},
	{
		name: "booking paid, then the balance invoice events",
		music: {
			seed: audioSeed({
				...balanceInvoice("draft", { booking_status: "open" }),
			}),
		},
		steps: [
			webhookStep(audioEvent("invoice.paid", {}, { id: "evt_1" })),
			webhookStep(balanceEvent("invoice.sent", {}, { id: "evt_2" })),
			webhookStep(
				balanceEvent(
					"invoice.paid",
					{},
					{ id: "evt_3", created: NOW_SECONDS - 10 },
				),
			),
		],
	},
	{
		name: "a clock move between two events of the same invoice",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_a", created: NOW_SECONDS - 5 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_b", created: NOW_SECONDS - 5 },
				),
				{ advanceMs: 3_600_000, at: NOW_SECONDS + 3_600 },
			),
		],
	},
];

const metadata: Case[] = [
	audioCase(
		"an invoice event with no metadata at all",
		null,
		audioEvent("invoice.paid", { metadata: undefined }),
	),
	audioCase(
		"an invoice event with empty metadata",
		null,
		audioEvent("invoice.paid", { metadata: {} }),
	),
	audioCase(
		"audio metadata with no installment",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", { metadata: { audio_request_id: "r1" } }),
	),
	audioCase(
		"audio metadata with an installment that is not booking or balance",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {
			metadata: { audio_request_id: "r1", installment: "deposit" },
		}),
	),
	audioCase(
		"audio metadata with the installment in capitals",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {
			metadata: { audio_request_id: "r1", installment: "BOOKING" },
		}),
	),
	audioCase(
		"an audio event with no invoice id",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", { id: undefined }),
	),
	audioCase(
		"an audio event with an empty request id",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {
			metadata: { audio_request_id: "", installment: "booking" },
		}),
	),
	audioCase(
		"software and audio metadata together: the audio path wins",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {
			metadata: {
				audio_request_id: "r1",
				installment: "booking",
				software_request_id: "r1",
				software_invoice_id: "si1",
			},
		}),
	),
	{
		name: "software metadata beside an empty audio request id: the software path",
		music: { seed: audioSeed(null) },
		steps: [
			softwareStep(
				audioEvent("invoice.paid", {
					metadata: { audio_request_id: "", software_request_id: "r1" },
				}),
			),
		],
	},
	softwareCase(
		"software metadata and no invoice id",
		softwareInvoiceRow("si1"),
		softwareEvent("invoice.paid", { id: undefined }),
	),
	audioCase(
		"an event for a request that does not exist",
		null,
		audioEvent("invoice.paid", {
			metadata: { audio_request_id: "nope", installment: "booking" },
		}),
	),
	audioCase(
		"an event for a request that has no payment row",
		null,
		audioEvent("invoice.paid"),
	),
	audioCase(
		"an event whose customer is an object",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", { customer: { id: "cus_obj" } }),
	),
	audioCase(
		"an event with a long request id and markup in the metadata",
		null,
		audioEvent("invoice.paid", {
			metadata: {
				audio_request_id: `<b>&"'${"x".repeat(300)}`,
				installment: "booking",
			},
		}),
	),
	audioCase(
		"an event with a missing created time on a matched invoice",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {}, { created: undefined }),
	),
	audioCase(
		"an event whose created time is not a number on a matched invoice",
		{ ...bookingInvoice("open") },
		{ ...audioEvent("invoice.paid"), created: "soon" },
	),
	audioCase(
		"an event whose created time is far beyond the date range, matched",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid", {}, { created: 1e20 }),
	),
	audioCase(
		"an event with a missing created time on an unknown invoice",
		{},
		audioEvent("invoice.paid", {}, { created: undefined }),
	),
	audioCase(
		"an event with a missing created time and missing metadata is ignored before the time is read",
		null,
		audioEvent("invoice.paid", { metadata: {} }, { created: undefined }),
	),
	audioCase(
		"an event with a missing created time on a known attempt",
		null,
		audioEvent("invoice.paid", {}, { created: undefined }),
		{
			music: {
				seed: audioSeed(
					{ ...bookingInvoice("open", { booking_invoice_id: "in_current" }) },
					{ stripe_invoice_attempts: [attempt("in_b1", "r1", "booking")] },
				),
			},
		},
	),
];

// The recovery path: an invoice Stripe knows that the request does not.
const recovery: Case[] = [
	...INVOICE_EVENTS.map((type) =>
		audioCase(
			`recovery: an unknown booking invoice, ${type}`,
			{},
			audioEvent(type),
		),
	),
	...INVOICE_EVENTS.map((type) =>
		audioCase(
			`recovery: an unknown balance invoice after a paid booking, ${type}`,
			{ booking_status: "paid", booking_invoice_id: "in_b1" },
			balanceEvent(type),
		),
	),
	audioCase(
		"recovery: a balance invoice before the booking is paid",
		{},
		balanceEvent("invoice.sent"),
	),
	audioCase(
		"recovery: a booking invoice for the wrong amount",
		{},
		audioEvent("invoice.sent", { total: 4_999 }),
	),
	audioCase(
		"recovery: an invoice with no total",
		{},
		audioEvent("invoice.sent", { total: undefined }),
	),
	audioCase(
		"recovery: an invoice in another currency",
		{},
		audioEvent("invoice.sent", { currency: "eur" }),
	),
	audioCase(
		"recovery: an invoice with no currency",
		{},
		audioEvent("invoice.sent", { currency: undefined }),
	),
	audioCase(
		"recovery: a booking already paid outside Stripe",
		{ booking_status: "paid" },
		audioEvent("invoice.sent"),
	),
	audioCase(
		"recovery: a booking whose creation was reserved",
		{ booking_creation_started_at: EARLIER },
		audioEvent("invoice.sent"),
	),
	audioCase(
		"recovery: a request whose Stripe references were deleted",
		{ external_refs_deleted_at: isoAt(-3600) },
		audioEvent("invoice.sent"),
	),
	audioCase(
		"recovery: an event with a customer object and no hosted url",
		{},
		audioEvent("invoice.sent", {
			customer: { id: "cus_obj" },
			hosted_invoice_url: undefined,
		}),
	),
	audioCase(
		"recovery: an event with no customer",
		{},
		audioEvent("invoice.sent", { customer: undefined }),
	),
	audioCase(
		"recovery: keeps the customer already on the payment when the event has none",
		{ stripe_customer_id: "cus_kept" },
		audioEvent("invoice.sent", { customer: undefined }),
	),
	audioCase(
		"an invoice id that is not the one on the request and is not a known attempt",
		{ ...bookingInvoice("open", { booking_invoice_id: "in_current" }) },
		audioEvent("invoice.paid"),
	),
	audioCase(
		"an old invoice of the request: a known attempt, now replaced",
		null,
		audioEvent("invoice.paid"),
		{
			music: {
				seed: audioSeed(
					{ ...bookingInvoice("open", { booking_invoice_id: "in_current" }) },
					{
						stripe_invoice_attempts: [
							attempt("in_b1", "r1", "booking", { replaced_at: isoAt(-600) }),
						],
					},
				),
			},
		},
	),
	audioCase(
		"a known attempt for a request with no payment row",
		null,
		audioEvent("invoice.paid"),
		{
			music: {
				seed: audioSeed(null, {
					stripe_invoice_attempts: [attempt("in_b1", "r1", "booking")],
				}),
			},
		},
	),
	{
		name: "recovery, then the same event delivered again",
		music: { seed: audioSeed({}) },
		steps: [
			webhookStep(audioEvent("invoice.sent")),
			webhookStep(audioEvent("invoice.sent")),
		],
	},
	{
		name: "recovery by a paid event, then an older sent event",
		music: { seed: audioSeed({}) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.paid",
					{},
					{ id: "evt_p", created: NOW_SECONDS - 30 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.sent",
					{},
					{ id: "evt_s", created: NOW_SECONDS - 60 },
				),
			),
		],
	},
	{
		name: "recovery by a failure event, then a newer paid event",
		music: { seed: audioSeed({}) },
		steps: [
			webhookStep(
				audioEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_f", created: NOW_SECONDS - 60 },
				),
			),
			webhookStep(
				audioEvent(
					"invoice.paid",
					{},
					{ id: "evt_p", created: NOW_SECONDS - 30 },
				),
			),
		],
	},
	{
		name: "recovery clears a reserved creation, then a different invoice id is a conflict",
		music: { seed: audioSeed({ booking_creation_started_at: isoAt(-120) }) },
		steps: [
			webhookStep(audioEvent("invoice.sent", {}, { id: "evt_1" })),
			webhookStep(audioEvent("invoice.paid", { id: "in_b2" }, { id: "evt_2" })),
		],
	},
	{
		name: "two different unknown invoices for the same booking",
		music: { seed: audioSeed({}) },
		steps: [
			webhookStep(
				audioEvent("invoice.sent", { id: "in_first" }, { id: "evt_1" }),
			),
			webhookStep(
				audioEvent("invoice.sent", { id: "in_second" }, { id: "evt_2" }),
			),
		],
	},
];

// Outages and races on the audio statements.
const audioOutages: Case[] = [
	audioCase(
		"outage: the first payment read fails",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ failures: [{ on: FIRST_PAYMENT_READ, message: "D1 unavailable" }] },
	),
	audioCase(
		"outage: the duplicate check fails",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{
			failures: [
				{
					on: /SELECT id FROM stripe_webhook_events/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: the invoice read fails",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{ failures: [{ on: BY_INVOICE_READ, message: "D1 unavailable", nth: 1 }] },
	),
	audioCase(
		"outage: the status batch fails",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{
			failures: [
				{
					on: /INSERT INTO stripe_webhook_events \(id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: the read after the status batch fails",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{
			failures: [{ on: FIRST_PAYMENT_READ, message: "D1 unavailable", nth: 2 }],
		},
	),
	{
		name: "outage: the status batch fails, then Stripe redelivers the event",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		failures: [
			{
				on: /INSERT INTO stripe_webhook_events \(id/,
				message: "D1 unavailable",
			},
		],
		steps: [
			webhookStep(audioEvent("invoice.paid")),
			webhookStep(audioEvent("invoice.paid")),
		],
	},
	{
		name: "outage: the read after the status batch fails, then Stripe redelivers the event",
		music: { seed: audioSeed({ ...bookingInvoice("open") }) },
		failures: [{ on: FIRST_PAYMENT_READ, message: "D1 unavailable", nth: 2 }],
		steps: [
			webhookStep(audioEvent("invoice.paid")),
			webhookStep(audioEvent("invoice.paid")),
		],
	},
	audioCase(
		"outage: the known-attempt check fails",
		{ ...bookingInvoice("open", { booking_invoice_id: "in_current" }) },
		audioEvent("invoice.paid"),
		{
			failures: [
				{
					on: /FROM stripe_invoice_attempts WHERE invoice_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: recording the conflict of a known attempt fails",
		null,
		audioEvent("invoice.paid"),
		{
			music: {
				seed: audioSeed(
					{ ...bookingInvoice("open", { booking_invoice_id: "in_current" }) },
					{ stripe_invoice_attempts: [attempt("in_b1", "r1", "booking")] },
				),
			},
			failures: [
				{
					on: /INSERT OR IGNORE INTO stripe_unmatched_events\s+\(event_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: the payment read inside recovery fails",
		{},
		audioEvent("invoice.sent"),
		{
			failures: [{ on: FIRST_PAYMENT_READ, message: "D1 unavailable", nth: 2 }],
		},
	),
	audioCase(
		"outage: the recovery batch fails",
		{},
		audioEvent("invoice.sent"),
		{
			failures: [
				{
					on: /INSERT OR IGNORE INTO stripe_webhook_events/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: the read after the recovery batch fails",
		{},
		audioEvent("invoice.sent"),
		{
			failures: [
				{
					on: /SELECT event_id FROM stripe_unmatched_events/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"outage: recording an unmatched event in recovery fails",
		{ booking_status: "paid" },
		audioEvent("invoice.sent"),
		{
			failures: [
				{
					on: /INSERT OR IGNORE INTO stripe_unmatched_events\s+\(event_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	audioCase(
		"race: the same event id is recorded by another delivery before the status batch",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.paid"),
		{
			interleave: [
				{
					on: /INSERT INTO stripe_webhook_events \(id/,
					label: "another delivery records evt_1",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO stripe_webhook_events(id,event_type,invoice_id,occurred_at,processed_at) VALUES ('evt_1','invoice.paid','in_b1','${isoAt(-60)}','${isoAt(0)}')`,
						),
				},
			],
		},
	),
	audioCase(
		"race: the booking is paid outside Stripe before the status batch",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.payment_failed"),
		{
			interleave: [
				{
					on: /INSERT INTO stripe_webhook_events \(id/,
					label: "the owner records the booking as paid",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_status='paid',booking_status_updated_at='${isoAt(-5)}'`,
						),
				},
			],
		},
	),
	audioCase(
		"race: a newer event lands before the status batch",
		{ ...bookingInvoice("open") },
		audioEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
		{
			interleave: [
				{
					on: /INSERT INTO stripe_webhook_events \(id/,
					label: "a newer event sets the status",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_status='payment_failed',booking_status_updated_at='${isoAt(-10)}'`,
						),
				},
			],
		},
	),
	audioCase(
		"race: another invoice takes the booking before the recovery batch",
		{},
		audioEvent("invoice.sent"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET stripe_customer_id=COALESCE/,
					label: "another invoice is recorded on the booking",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_invoice_id='in_other',booking_status='open'`,
						),
				},
			],
		},
	),
	audioCase(
		"race: the booking is paid outside Stripe before the recovery batch",
		{},
		audioEvent("invoice.sent"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET stripe_customer_id=COALESCE/,
					label: "the owner records the booking as paid",
					run: (sqlite) =>
						sqlite.exec(`UPDATE audio_payments SET booking_status='paid'`),
				},
			],
		},
	),
	audioCase(
		"race: the Stripe references are deleted before the recovery batch",
		{},
		audioEvent("invoice.sent"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET stripe_customer_id=COALESCE/,
					label: "retention deletes the Stripe references",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET external_refs_deleted_at='${isoAt(-1)}'`,
						),
				},
			],
		},
	),
	audioCase(
		"race: the same event is recorded before the recovery batch",
		{},
		audioEvent("invoice.sent"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET stripe_customer_id=COALESCE/,
					label: "another delivery records evt_1",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO stripe_webhook_events(id,event_type,invoice_id,occurred_at,processed_at) VALUES ('evt_1','invoice.sent','in_b1','${isoAt(-60)}','${isoAt(0)}')`,
						),
				},
			],
		},
	),
];

// Software invoices.
const siOpen = (over: SeedRow = {}) =>
	softwareInvoiceRow("si1", {
		status: "open",
		stripe_invoice_id: "in_s1",
		hosted_invoice_url: "https://invoice.stripe.test/i/s1",
		creation_started_at: null,
		...over,
	});

const SOFTWARE_STARTS = [
	"creating",
	"open",
	"payment_failed",
	"uncollectible",
	"void",
	"paid",
] as const;

const softwareMatrix: Case[] = SOFTWARE_STARTS.flatMap((start) =>
	INVOICE_EVENTS.map((type) =>
		softwareCase(
			`software deposit ${start} then ${type}`,
			start === "creating"
				? softwareInvoiceRow("si1")
				: siOpen({ status: start }),
			softwareEvent(type),
		),
	),
);

const balanceRow = (over: SeedRow = {}) =>
	siOpen({
		kind: "balance",
		amount_cents: 50_000,
		days_until_due: 15,
		...over,
	});

const balanceMeta = { kind: "balance" };

const milestoneRow = (over: SeedRow = {}) =>
	siOpen({
		kind: "milestone",
		amount_cents: 100_000,
		days_until_due: 30,
		...over,
	});

const milestoneMeta = { kind: "milestone" };

const withProject = (mode: "standard" | "invoice" = "standard") => ({
	software_projects: [startedProject(mode)],
});

const softwareKinds: Case[] = [
	...INVOICE_EVENTS.map((type) =>
		softwareCase(
			`software balance open then ${type}`,
			balanceRow(),
			softwareEvent(type, {}, {}, balanceMeta),
			{ seed: withProject() },
		),
	),
	...INVOICE_EVENTS.map((type) =>
		softwareCase(
			`software milestone open then ${type}`,
			milestoneRow(),
			softwareEvent(type, { total: 100_000 }, {}, milestoneMeta),
			{ seed: withProject("invoice") },
		),
	),
	softwareCase(
		"software balance paid with a started project records the milestone payment",
		balanceRow(),
		softwareEvent("invoice.paid", {}, {}, balanceMeta),
		{ seed: withProject() },
	),
	softwareCase(
		"software balance paid with no project records no milestone payment",
		balanceRow(),
		softwareEvent("invoice.paid", {}, {}, balanceMeta),
	),
	softwareCase(
		"software balance paid when the milestone payment is already recorded",
		balanceRow(),
		softwareEvent("invoice.paid", {}, {}, balanceMeta),
		{
			seed: {
				...withProject(),
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
	),
	softwareCase(
		"software deposit paid with a started project records no milestone payment",
		siOpen(),
		softwareEvent("invoice.paid"),
		{ seed: withProject() },
	),
	softwareCase(
		"software balance paid for an offer that is not the project's",
		balanceRow({ offer_id: "o2" }),
		softwareEvent(
			"invoice.paid",
			{},
			{},
			{ ...balanceMeta, software_offer_id: "o2" },
		),
		{
			seed: {
				...withProject(),
				software_offers: [
					rows.softwareOffer("o1", "r1", { terms_json: offerTerms() }),
					rows.softwareOffer("o2", "r1", { version: 2, status: "superseded" }),
				],
			},
		},
	),
	softwareCase(
		"software balance for milestone 2 paid",
		balanceRow({ milestone_index: 1 }),
		softwareEvent(
			"invoice.paid",
			{},
			{},
			{ ...balanceMeta, milestone_index: "1" },
		),
		{ seed: withProject() },
	),
];

const softwareMismatch: Case[] = [
	softwareCase(
		"software: an unknown local invoice id",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { software_invoice_id: "nope" }),
	),
	softwareCase(
		"software: no local invoice id in the metadata",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { software_invoice_id: undefined }),
	),
	softwareCase(
		"software: a request id that is not the invoice's",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { software_request_id: "r2" }),
	),
	softwareCase(
		"software: an offer id that is not the invoice's",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { software_offer_id: "o9" }),
	),
	softwareCase(
		"software: no offer id in the metadata",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { software_offer_id: undefined }),
	),
	softwareCase(
		"software: a milestone that is not the invoice's",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { milestone_index: "1" }),
	),
	softwareCase(
		"software: no milestone in the metadata",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { milestone_index: undefined }),
	),
	softwareCase(
		"software: a kind that is not the invoice's",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { kind: "balance" }),
	),
	softwareCase(
		"software: no kind in the metadata",
		siOpen(),
		softwareEvent("invoice.paid", {}, {}, { kind: undefined }),
	),
	softwareCase(
		"software: a Stripe invoice id that is not the one recorded",
		siOpen(),
		softwareEvent("invoice.paid", { id: "in_other" }),
	),
	softwareCase(
		"software: a status that is not creating and no Stripe invoice recorded",
		siOpen({ stripe_invoice_id: null }),
		softwareEvent("invoice.paid"),
	),
	softwareCase(
		"software: a total that is not the invoice amount",
		siOpen(),
		softwareEvent("invoice.paid", { total: 50_001 }),
	),
	softwareCase(
		"software: no total",
		siOpen(),
		softwareEvent("invoice.paid", { total: undefined }),
	),
	softwareCase(
		"software: a currency that is not usd",
		siOpen(),
		softwareEvent("invoice.paid", { currency: "eur" }),
	),
	softwareCase(
		"software: no currency",
		siOpen(),
		softwareEvent("invoice.paid", { currency: undefined }),
	),
	softwareCase(
		"software: the invoice is fenced for retention",
		siOpen({ retention_fenced_at: EARLIER }),
		softwareEvent("invoice.paid"),
	),
	softwareCase(
		"software: the invoice's Stripe references were deleted",
		siOpen({ external_refs_deleted_at: EARLIER }),
		softwareEvent("invoice.paid"),
	),
	softwareCase(
		"software: no invoice rows at all",
		null,
		softwareEvent("invoice.paid"),
	),
	{
		name: "software: an unmatched event delivered twice",
		music: { seed: softwareSeed({ software_invoices: [siOpen()] }) },
		steps: [
			softwareStep(softwareEvent("invoice.paid", { total: 1 })),
			softwareStep(softwareEvent("invoice.paid", { total: 1 })),
		],
	},
	{
		name: "software: an unmatched event is retried after the invoice is repaired",
		music: {
			seed: softwareSeed({ software_invoices: [siOpen({ amount_cents: 99 })] }),
		},
		steps: [
			softwareStep(softwareEvent("invoice.paid")),
			softwareStep(softwareEvent("invoice.paid"), {
				before: {
					label: "the invoice amount is corrected",
					run: (world) =>
						world.music.exec("UPDATE software_invoices SET amount_cents=50000"),
				},
			}),
		],
	},
];

const softwareOrdering: Case[] = [
	softwareCase(
		"software: an event older than the stored status time is not applied",
		siOpen({ status: "payment_failed", status_updated_at: isoAt(-30) }),
		softwareEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: an older paid event after a newer failure is dropped",
		siOpen({ status: "payment_failed", status_updated_at: isoAt(-30) }),
		softwareEvent("invoice.paid", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: an event newer than the stored status time is applied",
		siOpen({ status: "payment_failed", status_updated_at: isoAt(-90) }),
		softwareEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: a paid event at the same time as an open status is applied",
		siOpen({ status_updated_at: isoAt(-60) }),
		softwareEvent("invoice.paid", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: an open event at the same time as a failed status is not applied",
		siOpen({ status: "payment_failed", status_updated_at: isoAt(-60) }),
		softwareEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: a failed event at the same time as an open status is applied",
		siOpen({ status_updated_at: isoAt(-60) }),
		softwareEvent("invoice.payment_failed", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: a void event at the same time as an uncollectible status is applied",
		siOpen({ status: "uncollectible", status_updated_at: isoAt(-60) }),
		softwareEvent("invoice.voided", {}, { created: NOW_SECONDS - 60 }),
	),
	softwareCase(
		"software: an event of the same status at the same time is not applied",
		siOpen({ status_updated_at: isoAt(-60) }),
		softwareEvent("invoice.sent", {}, { created: NOW_SECONDS - 60 }),
	),
	{
		name: "software: paid, then a later void event",
		music: { seed: softwareSeed({ software_invoices: [siOpen()] }) },
		steps: [
			softwareStep(softwareEvent("invoice.paid", {}, { id: "evt_a" })),
			softwareStep(
				softwareEvent(
					"invoice.voided",
					{},
					{ id: "evt_b", created: NOW_SECONDS + 30 },
				),
				{ advanceMs: 90_000, at: NOW_SECONDS + 90 },
			),
		],
	},
	{
		name: "software: creating, sent, failed, then paid in order",
		music: {
			seed: softwareSeed({ software_invoices: [softwareInvoiceRow("si1")] }),
		},
		steps: [
			softwareStep(
				softwareEvent(
					"invoice.sent",
					{},
					{ id: "evt_a", created: NOW_SECONDS - 300 },
				),
			),
			softwareStep(
				softwareEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_b", created: NOW_SECONDS - 200 },
				),
			),
			softwareStep(
				softwareEvent(
					"invoice.paid",
					{},
					{ id: "evt_c", created: NOW_SECONDS - 100 },
				),
			),
		],
	},
	{
		name: "software: out of order, the older sent arrives after the newer failure",
		music: {
			seed: softwareSeed({ software_invoices: [softwareInvoiceRow("si1")] }),
		},
		steps: [
			softwareStep(
				softwareEvent(
					"invoice.payment_failed",
					{},
					{ id: "evt_b", created: NOW_SECONDS - 200 },
				),
			),
			softwareStep(
				softwareEvent(
					"invoice.sent",
					{},
					{ id: "evt_a", created: NOW_SECONDS - 300 },
				),
			),
		],
	},
	{
		name: "software: the same event delivered twice",
		music: { seed: softwareSeed({ software_invoices: [siOpen()] }) },
		steps: [
			softwareStep(softwareEvent("invoice.paid")),
			softwareStep(softwareEvent("invoice.paid")),
		],
	},
	{
		name: "software: a balance paid event delivered twice with a project",
		music: {
			seed: softwareSeed({
				software_invoices: [balanceRow()],
				...withProject(),
			}),
		},
		steps: [
			softwareStep(softwareEvent("invoice.paid", {}, {}, balanceMeta)),
			softwareStep(softwareEvent("invoice.paid", {}, {}, balanceMeta)),
		],
	},
	{
		name: "software: an event id already recorded for audio is a duplicate",
		music: {
			seed: softwareSeed({
				software_invoices: [siOpen()],
				stripe_webhook_events: [webhookEventRow("evt_1")],
			}),
		},
		steps: [softwareStep(softwareEvent("invoice.paid"))],
	},
	softwareCase(
		"software: a hosted url that is not https is not stored",
		softwareInvoiceRow("si1"),
		softwareEvent("invoice.sent", {
			hosted_invoice_url: "http://invoice.stripe.test/i/s1",
		}),
	),
	softwareCase(
		"software: no hosted url keeps the stored one",
		siOpen(),
		softwareEvent("invoice.payment_failed", { hosted_invoice_url: undefined }),
	),
	softwareCase(
		"software: a due date is stored",
		softwareInvoiceRow("si1"),
		softwareEvent("invoice.sent", { due_date: NOW_SECONDS + 86_400 * 7 }),
	),
	softwareCase(
		"software: a customer object",
		softwareInvoiceRow("si1"),
		softwareEvent("invoice.sent", { customer: { id: "cus_obj" } }),
	),
	softwareCase(
		"software: no customer keeps the stored one",
		siOpen({ stripe_customer_id: "cus_kept" }),
		softwareEvent("invoice.payment_failed", { customer: undefined }),
	),
	softwareCase(
		"software: a missing created time",
		siOpen(),
		softwareEvent("invoice.paid", {}, { created: undefined }),
	),
];

const softwareOutages: Case[] = [
	softwareCase(
		"software outage: the invoice read fails",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			failures: [
				{
					on: /SELECT \* FROM software_invoices WHERE id=\? AND request_id=\?/,
					message: "D1 unavailable",
				},
			],
		},
	),
	softwareCase(
		"software outage: the duplicate check fails",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			failures: [
				{
					on: /SELECT 1 FROM stripe_webhook_events WHERE id=\?/,
					message: "D1 unavailable",
				},
			],
		},
	),
	softwareCase(
		"software outage: the status batch fails",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			failures: [
				{
					on: /UPDATE software_invoices SET stripe_invoice_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	softwareCase(
		"software outage: the read after the batch fails",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			failures: [
				{
					on: /SELECT 1 FROM software_stripe_unmatched_events WHERE event_id/,
					message: "D1 unavailable",
				},
			],
		},
	),
	softwareCase(
		"software outage: recording an unmatched event fails",
		siOpen(),
		softwareEvent("invoice.paid", { total: 1 }),
		{
			failures: [
				{
					on: /INSERT OR IGNORE INTO software_stripe_unmatched_events/,
					message: "D1 unavailable",
				},
			],
		},
	),
	{
		name: "software outage: the batch fails, then Stripe redelivers",
		music: { seed: softwareSeed({ software_invoices: [siOpen()] }) },
		failures: [
			{
				on: /UPDATE software_invoices SET stripe_invoice_id/,
				message: "D1 unavailable",
			},
		],
		steps: [
			softwareStep(softwareEvent("invoice.paid")),
			softwareStep(softwareEvent("invoice.paid")),
		],
	},
	softwareCase(
		"software race: the invoice is paid by another event before the batch",
		siOpen(),
		softwareEvent("invoice.payment_failed"),
		{
			interleave: [
				{
					on: /UPDATE software_invoices SET stripe_invoice_id/,
					label: "another event marks the invoice paid",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_invoices SET status='paid',status_updated_at='${isoAt(-5)}'`,
						),
				},
			],
		},
	),
	softwareCase(
		"software race: the invoice is fenced for retention before the batch",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			interleave: [
				{
					on: /UPDATE software_invoices SET stripe_invoice_id/,
					label: "retention fences the invoice",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE software_invoices SET retention_fenced_at='${isoAt(-1)}'`,
						),
				},
			],
		},
	),
	softwareCase(
		"software race: the same event is recorded by another delivery before the batch",
		siOpen(),
		softwareEvent("invoice.paid"),
		{
			interleave: [
				{
					on: /UPDATE software_invoices SET stripe_invoice_id/,
					label: "another delivery records evt_1",
					run: (sqlite) =>
						sqlite.exec(
							`INSERT INTO stripe_webhook_events(id,event_type,invoice_id,occurred_at,processed_at) VALUES ('evt_1','invoice.paid','in_s1','${isoAt(-60)}','${isoAt(0)}')`,
						),
				},
			],
		},
	),
];

const cases: Case[] = [
	...transport,
	...unrelated,
	...bookingMatrix,
	...balanceMatrix,
	...ordering,
	...metadata,
	...recovery,
	...audioOutages,
	...softwareMatrix,
	...softwareKinds,
	...softwareMismatch,
	...softwareOrdering,
	...softwareOutages,
];

defineCorpus("stripe-webhook", POST, cases);
