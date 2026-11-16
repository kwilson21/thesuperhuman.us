// Shared seed builders and scripts for the payments golden corpora (the Stripe webhook, the audio payment route and the
// software invoice route). Rows get fixed defaults on the frozen clock's day; a case passes only the columns it cares about.
import { isText } from "~/lib/type-guards";
import type { JsonValue } from "../../helpers/json";
import {
	json,
	networkDown,
	rows,
	signStripeWebhook,
	START,
	type FetchAnswer,
	type FetchCall,
	type Responder,
	type SeedRow,
	type Step,
} from "../harness";

export const SITE = "https://thesuperhuman.us";
export const WEBHOOK_SECRET = "whsec_golden";
export const NOW_SECONDS = Date.parse(START) / 1000;

export const EARLIER = "2026-11-13T11:00:00.000Z";

/** An ISO time, this many seconds from the frozen clock's start. */
export const isoAt = (seconds: number) =>
	new Date((NOW_SECONDS + seconds) * 1000).toISOString();

// ---------------------------------------------------------------------------------------------------------------------
// Audio payments
// ---------------------------------------------------------------------------------------------------------------------

/** An audio_payments row: a 100.00 USD project, split 50.00 and 50.00, nothing invoiced. */
export const audioPayment = (
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	request_id: requestId,
	approved_service: "Vocal mix",
	total_amount_cents: 10_000,
	currency: "usd",
	booking_amount_cents: 5_000,
	balance_amount_cents: 5_000,
	offer_accepted_at: EARLIER,
	booking_status: "not_created",
	balance_status: "not_created",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

/** A booking invoice that exists, in the given status. */
export const bookingInvoice = (
	status: string,
	over: SeedRow = {},
): SeedRow => ({
	stripe_customer_id: "cus_1",
	booking_invoice_id: "in_b1",
	booking_invoice_url: "https://invoice.stripe.test/i/b1",
	booking_status: status,
	...over,
});

/** A paid booking and a balance invoice that exists, in the given status. */
export const balanceInvoice = (
	status: string,
	over: SeedRow = {},
): SeedRow => ({
	stripe_customer_id: "cus_1",
	booking_invoice_id: "in_b1",
	booking_invoice_url: "https://invoice.stripe.test/i/b1",
	booking_status: "paid",
	balance_invoice_id: "in_l1",
	balance_invoice_url: "https://invoice.stripe.test/i/l1",
	balance_status: status,
	...over,
});

export const attempt = (
	invoiceId: string,
	requestId: string,
	installment: "booking" | "balance",
	over: SeedRow = {},
): SeedRow => ({
	invoice_id: invoiceId,
	request_id: requestId,
	installment,
	created_at: EARLIER,
	...over,
});

export const audioTables = [
	"audio_payments",
	"owner_request_audit",
	"stripe_webhook_events",
	"stripe_invoice_attempts",
	"stripe_unmatched_events",
];

/** One service request "r1" with its payment row. */
export const audioSeed = (
	payment: SeedRow | null = {},
	extra: { [table: string]: SeedRow[] } = {},
) => ({
	owner_requests: [rows.ownerRequest("r1")],
	audio_payments: payment ? [audioPayment("r1", payment)] : [],
	...extra,
});

// ---------------------------------------------------------------------------------------------------------------------
// Stripe webhook events
// ---------------------------------------------------------------------------------------------------------------------

export const INVOICE_EVENTS = [
	"invoice.sent",
	"invoice.paid",
	"invoice.payment_failed",
	"invoice.voided",
	"invoice.marked_uncollectible",
] as const;

/** JSON, but a field may be undefined (left out of the body), so a case can drop a field Stripe would send. */
export type Loose = { [name: string]: JsonValue | undefined | Loose | Loose[] };

type Fields = Loose;

/** A Stripe invoice event. `object` replaces default invoice fields (a field set to undefined is left out). */
export function stripeEvent(
	type: string,
	object: Fields = {},
	event: { id?: string; created?: number | undefined } = {},
) {
	return {
		id: event.id ?? "evt_1",
		object: "event",
		type,
		created: Object.hasOwn(event, "created") ? event.created : NOW_SECONDS - 60,
		data: { object: { object: "invoice", ...object } },
	};
}

/** An audio booking invoice event for request r1. */
export const audioEvent = (
	type: string,
	object: Fields = {},
	event: { id?: string; created?: number | undefined } = {},
) =>
	stripeEvent(
		type,
		{
			id: "in_b1",
			customer: "cus_1",
			total: 5_000,
			currency: "usd",
			hosted_invoice_url: "https://invoice.stripe.test/i/b1",
			metadata: { audio_request_id: "r1", installment: "booking" },
			...object,
		},
		event,
	);

/** An audio balance invoice event for request r1. */
export const balanceEvent = (
	type: string,
	object: Fields = {},
	event: { id?: string; created?: number | undefined } = {},
) =>
	audioEvent(
		type,
		{
			id: "in_l1",
			hosted_invoice_url: "https://invoice.stripe.test/i/l1",
			metadata: { audio_request_id: "r1", installment: "balance" },
			...object,
		},
		event,
	);

/** A software invoice event; the metadata names the local invoice "si1" of offer "o1", milestone 0, a deposit. */
export const softwareEvent = (
	type: string,
	object: Fields = {},
	event: { id?: string; created?: number | undefined } = {},
	metadata: { [name: string]: string | undefined } = {},
) =>
	stripeEvent(
		type,
		{
			id: "in_s1",
			customer: "cus_s1",
			total: 50_000,
			currency: "usd",
			hosted_invoice_url: "https://invoice.stripe.test/i/s1",
			metadata: {
				software_request_id: "r1",
				software_invoice_id: "si1",
				software_offer_id: "o1",
				milestone_index: "0",
				kind: "deposit",
				...metadata,
			},
			...object,
		},
		event,
	);

/** A signed webhook request. `at` signs at another time (seconds), `secret` with another secret. */
export function webhookStep(
	event: Loose | JsonValue | string,
	over: Partial<Step> & { at?: number; secret?: string } = {},
): Step {
	const { at, secret, ...step } = over;
	const body = isText(event) ? event : JSON.stringify(event);

	return {
		path: "/api/stripe/webhook",
		body,
		headers: {
			"stripe-signature": signStripeWebhook(body, secret ?? WEBHOOK_SECRET, at),
		},
		dump: { music: audioTables },
		...step,
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// Software offers and invoices
// ---------------------------------------------------------------------------------------------------------------------

/** Valid offer terms. `fees` are each milestone's fee in cents. */
export const offerTerms = (
	paymentMode: "standard" | "invoice" = "standard",
	fees: number[] = [100_000],
) =>
	JSON.stringify({
		outcome: "A scheduling tool",
		summary: "A small tool",
		milestones: fees.map((feeCents, index) => ({
			name: `Milestone ${index + 1}`,
			deliverables: [`Deliverable ${index + 1}`],
			acceptance: ["It works"],
			feeCents,
		})),
		clientInputs: "",
		exclusions: "",
		timing: "",
		paymentMode,
	});

export const softwareInvoiceRow = (id: string, over: SeedRow = {}): SeedRow =>
	rows.softwareInvoice(id, "r1", "o1", {
		status: "creating",
		days_until_due: 7,
		amount_cents: 50_000,
		allow_card: 0,
		attempt: 0,
		creation_started_at: EARLIER,
		...over,
	});

export const softwareTables = [
	"software_invoices",
	"software_project_audit",
	"software_milestone_payments",
	"software_milestone_deposits",
	"stripe_webhook_events",
	"software_stripe_unmatched_events",
];

/** A software request "r1" with one sent offer "o1" of the given payment mode. */
export const softwareSeed = (
	extra: { [table: string]: SeedRow[] } = {},
	mode: "standard" | "invoice" = "standard",
	fees: number[] = [100_000],
) => ({
	owner_requests: [rows.softwareRequest("r1", { status: "reviewed" })],
	software_offers: [
		rows.softwareOffer("o1", "r1", { terms_json: offerTerms(mode, fees) }),
	],
	...extra,
});

/** A project row for "r1" and "o1" in the given payment mode. */
export const startedProject = (
	mode: "standard" | "invoice" = "standard",
	over: SeedRow = {},
): SeedRow =>
	rows.softwareProject("r1", "o1", {
		terms_json: offerTerms(mode),
		payment_mode: mode,
		...over,
	});

// ---------------------------------------------------------------------------------------------------------------------
// Stripe answers
// ---------------------------------------------------------------------------------------------------------------------

export type StripeStep = "customer" | "invoice" | "item" | "finalize" | "send";

const SENT = {
	id: "in_1",
	object: "invoice",
	status: "open",
	hosted_invoice_url: "https://invoice.stripe.test/i/1",
	due_date: 1_795_000_000,
};

/** A Stripe error answer, in the shape the real API sends. */
export const stripeError = (
	status: number,
	message: string,
	extra: { [name: string]: JsonValue } = {},
	headers: { [name: string]: string } = {},
): FetchAnswer =>
	json(
		status,
		{
			error: {
				type: status >= 500 ? "api_error" : "invalid_request_error",
				message,
				...extra,
			},
		},
		headers,
	);

/** A 5xx that tells the SDK not to retry, so a case does not wait for its backoff. */
export const stripeDown = (message = "Stripe is having trouble"): FetchAnswer =>
	stripeError(500, message, {}, { "stripe-should-retry": "false" });

const stripeStep = (call: FetchCall): StripeStep | null => {
	const { pathname } = new URL(call.url);

	if (pathname === "/v1/customers") return "customer";

	if (pathname === "/v1/invoices") return "invoice";

	if (pathname === "/v1/invoiceitems") return "item";

	if (pathname.endsWith("/finalize")) return "finalize";

	if (pathname.endsWith("/send")) return "send";

	return null;
};

/**
 * Stripe answers by what the call is for, never by call number (the SDK retries, which shifts numbers). Every step
 * succeeds unless `answers` names one. `answers` may give a list: the n-th call to that step gets the n-th answer.
 */
export function stripeScript(
	answers: {
		[Step in StripeStep]?: FetchAnswer | readonly FetchAnswer[];
	} = {},
	ids: { customer?: string; invoice?: string } = {},
): Responder {
	const counts = new Map<StripeStep, number>();
	const invoice = ids.invoice ?? "in_1";

	const defaults = {
		customer: json(200, { id: ids.customer ?? "cus_1", object: "customer" }),
		invoice: json(200, { id: invoice, object: "invoice" }),
		item: json(200, { id: "ii_1", object: "invoiceitem" }),
		finalize: json(200, { ...SENT, id: invoice, status: "open" }),
		send: json(200, { ...SENT, id: invoice }),
	};

	return (call) => {
		if (call.host !== "stripe")
			return networkDown(`no answer for ${call.host}`);

		const step = stripeStep(call);

		if (!step) return networkDown(`unexpected Stripe call ${call.url}`);

		const n = counts.get(step) ?? 0;
		counts.set(step, n + 1);
		const given = answers[step];

		if (given === undefined) return defaults[step];

		if (!Array.isArray(given)) return given;

		return given[Math.min(n, given.length - 1)] ?? defaults[step];
	};
}

/** A `send` answer that is a 200 with the given fields (the malformed answers a real response could carry). */
export const sendAnswer = (fields: {
	[name: string]: JsonValue | undefined;
}): FetchAnswer => ({
	kind: "response",
	status: 200,
	text: JSON.stringify({ ...SENT, ...fields }),
	headers: { "content-type": "application/json" },
});
