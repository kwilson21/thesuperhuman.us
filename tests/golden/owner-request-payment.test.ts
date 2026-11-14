import type { JsonValue } from "../helpers/json";
import { POST as webhook } from "~/pages/api/stripe/webhook";
import { POST } from "~/pages/api/owner/requests/[id]/payment";
import {
	attempt,
	audioEvent,
	audioPayment,
	audioSeed,
	audioTables,
	balanceEvent,
	balanceInvoice,
	bookingInvoice,
	EARLIER,
	isoAt,
	type Loose,
	NOW_SECONDS,
	sendAnswer,
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
	json,
	networkDown,
	rows,
	type Responder,
	text,
	type Case,
	type SeedRow,
	type Step,
} from "./harness";

// The Stripe SDK waits about a second between retries of a network failure or a 5xx without a stop header.

// The golden corpus for POST /api/owner/requests/[id]/payment: the owner approves the price of an audio request, records
// a payment that arrived outside Stripe, or has the site create (or replace a void) booking and balance invoice in Stripe.
// The real Stripe SDK runs against scripted answers; every call is recorded with its idempotency key.
//
// Every response branch of the handler, of audio-payments.ts (approveAudioPayment, recordManualPayment,
// replaceTerminalInvoice, reserveInvoiceCreation, recordInvoice) and of stripe-invoicing.ts, and the cases that reach it:
//
//   handler guards
//   403 {ok:false}                 a visitor, a client cookie
//   503 {ok:false}                 no MUSIC_DB, no id param, empty id param
//   400 {ok:false}                 body not JSON, empty, null, array, string, unknown or missing action, every field of
//                                  approve and record-payment-received missing, wrong type, out of range or too long
//   404 {ok:false}                 unknown request id
//   409 {ok:false} (no cache-control)  a software request
//   approve  (cache-control private, no-store from here on)
//   200 {ok:true,payment}          a new approval (odd totals split with the half rounded up), an identical repeat, a
//                                  repeat with another offerAcceptedAt (ignored), a withdrawn request, unicode and markup
//                                  in the service name, an owner email in capitals (audit stores lower case)
//   409 {ok:false}                 a repeat with another service or total; the insert batch fails; a race on the insert
//   record-payment-received
//   409 {ok:false}                 no payment row; an invoice exists; creation reserved; references deleted; balance
//                                  before the booking is paid; the batch fails; a race that adds an invoice first
//   200 {ok:true,payment}          booking and balance from not_created with each method, with and without a reference,
//                                  a repeat for an installment already paid outside Stripe, a zero balance
//   create-booking-invoice and create-balance-invoice
//   200 existing payment           the invoice id is already there (no Stripe call)
//   200 {ok:true,payment}          a new invoice: customer, invoice, item, finalize, send, then the database record
//   503 {ok:false}                 payments flag off or missing, no secret key, no webhook secret
//   409 {ok:false}                 no payment row, balance before the booking is paid, creation already reserved, paid
//                                  outside Stripe, references deleted, a reserved row left by a failed earlier try
//   409 or 502 {ok:false}          a Stripe refusal or outage at each of the five calls. The status is 502 only when the
//                                  error text contains "Stripe" or "hosted payment URL", so a 4xx whose message does not
//                                  say Stripe is a 409
//   502                            malformed send answers (draft, no url, http url, not JSON)
//   503 {ok:false,recoveryPending:true}  the record batch fails or another invoice took the slot
//   replace-booking-invoice and replace-balance-invoice
//   200 {ok:true,payment}          a void invoice is cleared (attempt count +1) and a new one created with new keys
//   409 {ok:false}                 a replace from any status but void, or with no invoice
//   503 {ok:false}                 Stripe unavailable (checked before the database changes)
//   502 / 409                      Stripe fails after the replacement was recorded (the row stays reserved)
//   sequences                      approve then create then webhook paid then balance; the stuck reservation (create
//                                  fails, the same create again, a manual payment, then a webhook recovers it); repeated
//                                  creates; replace after a void webhook

const BASE = "/api/owner/requests/r1/payment";

type Body = Loose | JsonValue | undefined;

const command = (body: Body, extra: Partial<Step> = {}): Step => ({
	as: asOwner(),
	path: BASE,
	params: { id: "r1" },
	body: body === undefined ? undefined : JSON.stringify(body),
	headers: { "content-type": "application/json" },
	dump: { music: audioTables },
	...extra,
});

const payCase = (
	name: string,
	payment: SeedRow | null,
	body: Body,
	extra: Partial<Case> = {},
): Case => ({
	name,
	music: { seed: audioSeed(payment) },
	steps: [command(body)],
	...extra,
});

const approve = {
	action: "approve",
	approvedService: "Vocal mix",
	totalAmountCents: 10_000,
	offerAccepted: true,
};

const record = (installment: string, method = "Zelle", over: Loose = {}) => ({
	action: "record-payment-received",
	installment,
	method,
	received: true,
	...over,
});

const CREATE_BOOKING = { action: "create-booking-invoice" };
const CREATE_BALANCE = { action: "create-balance-invoice" };
const REPLACE_BOOKING = { action: "replace-booking-invoice" };
const REPLACE_BALANCE = { action: "replace-balance-invoice" };

const stripeWith = (
	name: string,
	payment: SeedRow | null,
	body: Body,
	extra: Partial<Case>,
): Case => payCase(name, payment, body, { fetches: stripeScript(), ...extra });

const stripeCase = (
	name: string,
	payment: SeedRow | null,
	body: Body,
	answers: Parameters<typeof stripeScript>[0] = {},
	extra: Partial<Case> = {},
): Case =>
	payCase(name, payment, body, { fetches: stripeScript(answers), ...extra });

const guards: Case[] = [
	payCase("not the owner: a visitor", {}, approve, {
		steps: [command(approve, { as: asVisitor() })],
	}),
	payCase("not the owner: a client cookie", {}, approve, {
		steps: [command(approve, { as: asClientCookie("forged") })],
	}),
	{
		name: "no database binding",
		music: { missing: true },
		steps: [command(approve)],
	},
	payCase("no id param", {}, approve, {
		steps: [command(approve, { params: {} })],
	}),
	payCase("an empty id param", {}, approve, {
		steps: [command(approve, { params: { id: "" } })],
	}),
	payCase("bad JSON", {}, undefined, {
		steps: [command(undefined, { body: "{nope" })],
	}),
	payCase("an empty body", {}, undefined, {
		steps: [command(undefined, { body: "" })],
	}),
	payCase("a null body", {}, null),
	payCase("an array body", {}, []),
	payCase("a string body", {}, "approve"),
	payCase("an unknown action", {}, { action: "refund" }),
	payCase("no action", {}, { approvedService: "Vocal mix" }),
	payCase("an action that is not text", {}, { action: 7 }),
	payCase("an unknown request id", {}, approve, {
		steps: [
			command(approve, {
				path: "/api/owner/requests/nope/payment",
				params: { id: "nope" },
			}),
		],
	}),
	{
		name: "a software request",
		music: { seed: { owner_requests: [rows.softwareRequest("r1")] } },
		steps: [command(approve)],
	},
	{
		name: "a software request asking for an invoice",
		music: { seed: { owner_requests: [rows.softwareRequest("r1")] } },
		steps: [command(CREATE_BOOKING)],
	},
];

const approveBody = (over: Loose) => ({ ...approve, ...over });

const approving: Case[] = [
	payCase("approve a new price", null, approve),
	payCase(
		"approve: 2 cents splits 1 and 1",
		null,
		approveBody({ totalAmountCents: 2 }),
	),
	payCase(
		"approve: 3 cents splits 2 and 1",
		null,
		approveBody({ totalAmountCents: 3 }),
	),
	payCase(
		"approve: 101 cents splits 51 and 50",
		null,
		approveBody({ totalAmountCents: 101 }),
	),
	payCase(
		"approve: 10001 cents",
		null,
		approveBody({ totalAmountCents: 10_001 }),
	),
	payCase(
		"approve: the largest price",
		null,
		approveBody({ totalAmountCents: 100_000_000 }),
	),
	payCase(
		"approve: one cent over the largest price",
		null,
		approveBody({ totalAmountCents: 100_000_001 }),
	),
	payCase("approve: 1 cent", null, approveBody({ totalAmountCents: 1 })),
	payCase("approve: zero", null, approveBody({ totalAmountCents: 0 })),
	payCase("approve: negative", null, approveBody({ totalAmountCents: -500 })),
	payCase(
		"approve: a fraction of a cent",
		null,
		approveBody({ totalAmountCents: 100.5 }),
	),
	payCase(
		"approve: a total sent as text",
		null,
		approveBody({ totalAmountCents: "10000" }),
	),
	payCase(
		"approve: no total",
		null,
		approveBody({ totalAmountCents: undefined }),
	),
	payCase(
		"approve: an astronomically large total",
		null,
		approveBody({ totalAmountCents: 1e21 }),
	),
	payCase(
		"approve: offerAccepted false",
		null,
		approveBody({ offerAccepted: false }),
	),
	payCase(
		"approve: offerAccepted as text",
		null,
		approveBody({ offerAccepted: "true" }),
	),
	payCase(
		"approve: no offerAccepted",
		null,
		approveBody({ offerAccepted: undefined }),
	),
	payCase(
		"approve: no service",
		null,
		approveBody({ approvedService: undefined }),
	),
	payCase(
		"approve: a blank service",
		null,
		approveBody({ approvedService: "   " }),
	),
	payCase(
		"approve: a service that is not text",
		null,
		approveBody({ approvedService: 5 }),
	),
	payCase(
		"approve: a service of 160 characters",
		null,
		approveBody({ approvedService: "s".repeat(160) }),
	),
	payCase(
		"approve: a service of 161 characters",
		null,
		approveBody({ approvedService: "s".repeat(161) }),
	),
	payCase(
		"approve: a service of 160 characters inside spaces",
		null,
		approveBody({ approvedService: ` ${"s".repeat(160)} ` }),
	),
	payCase(
		"approve: a service with markup and quotes",
		null,
		approveBody({ approvedService: `<b>Mix</b> & "master" 'x'` }),
	),
	payCase(
		"approve: a service in unicode",
		null,
		approveBody({ approvedService: "Mélange vocal 🎤 – 日本語" }),
	),
	payCase(
		"approve: extra fields are dropped",
		null,
		approveBody({ extra: true, installment: "booking" }),
	),
	payCase(
		"approve: the owner email in capitals is stored in lower case",
		null,
		approve,
		{
			steps: [command(approve, { as: asOwner("Owner@Example.TEST") })],
		},
	),
	payCase("approve: a blank owner email", null, approve, {
		steps: [command(approve, { as: asOwner("  ") })],
	}),
	payCase("approve: a withdrawn request is still approved", null, approve, {
		music: {
			seed: {
				owner_requests: [rows.ownerRequest("r1", { status: "withdrawn" })],
			},
		},
	}),
	payCase("approve: the same terms again", {}, approve),
	payCase(
		"approve: the same terms with the service in spaces",
		{},
		approveBody({ approvedService: "  Vocal mix  " }),
	),
	payCase(
		"approve: the same terms with another offer time on file",
		{ offer_accepted_at: "2026-01-01T00:00:00.000Z" },
		approve,
	),
	payCase(
		"approve: another total than the approved one",
		{},
		approveBody({ totalAmountCents: 20_000 }),
	),
	payCase(
		"approve: another service than the approved one",
		{},
		approveBody({ approvedService: "Mastering" }),
	),
	payCase(
		"approve: the same terms after an invoice exists hides the customer id",
		{ ...bookingInvoice("open") },
		approve,
	),
	payCase("outage: the first read fails on approve", null, approve, {
		failures: [
			{
				on: /FROM audio_payments WHERE request_id=\?/,
				message: "D1 unavailable",
			},
		],
	}),
	payCase("outage: the request kind read fails on approve", null, approve, {
		failures: [
			{ on: /SELECT kind FROM owner_requests/, message: "D1 unavailable" },
		],
	}),
	payCase("outage: the approval batch fails", null, approve, {
		failures: [{ on: /INSERT INTO audio_payments/, message: "D1 unavailable" }],
	}),
	payCase("outage: the read after the approval fails", null, approve, {
		failures: [
			{
				on: /FROM audio_payments WHERE request_id=\?/,
				message: "D1 unavailable",
				nth: 3,
			},
		],
	}),
	payCase("race: another approval lands before the insert", null, approve, {
		interleave: [
			{
				on: /INSERT INTO audio_payments/,
				label: "another approval inserts the payment",
				run: (sqlite) =>
					sqlite.exec(
						`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,currency,booking_amount_cents,balance_amount_cents,offer_accepted_at,booking_status,balance_status,created_at,updated_at) VALUES ('r1','Other',500,'usd',250,250,'${EARLIER}','not_created','not_created','${EARLIER}','${EARLIER}')`,
					),
			},
		],
	}),
	{
		name: "approve twice, then the same terms a third time",
		music: { seed: audioSeed(null) },
		steps: [
			command(approve),
			command(approve, { advanceMs: 60_000 }),
			command(approveBody({ totalAmountCents: 9_999 }), { advanceMs: 60_000 }),
		],
	},
];

const manual: Case[] = [
	payCase("manual: no payment row", null, record("booking")),
	payCase("manual: a booking payment", {}, record("booking")),
	...[
		"Zelle",
		"Venmo",
		"PayPal",
		"Cash App",
		"Cash",
		"Bank transfer",
		"Other",
	].map((method) =>
		payCase(
			`manual: a booking payment by ${method}`,
			{},
			record("booking", method),
		),
	),
	payCase("manual: an unknown method", {}, record("booking", "Bitcoin")),
	payCase("manual: a method in lower case", {}, record("booking", "zelle")),
	payCase("manual: an unknown installment", {}, record("deposit")),
	payCase(
		"manual: no installment",
		{},
		{ action: "record-payment-received", method: "Zelle", received: true },
	),
	payCase(
		"manual: received false",
		{},
		record("booking", "Zelle", { received: false }),
	),
	payCase(
		"manual: no received",
		{},
		record("booking", "Zelle", { received: undefined }),
	),
	payCase(
		"manual: a reference",
		{},
		record("booking", "Zelle", { reference: "ZL-2026/11:A#1.b_c" }),
	),
	payCase(
		"manual: a reference with spaces around and inside",
		{},
		record("booking", "Zelle", { reference: "  A   B  " }),
	),
	payCase(
		"manual: an empty reference",
		{},
		record("booking", "Zelle", { reference: "" }),
	),
	payCase(
		"manual: a reference of 120 characters",
		{},
		record("booking", "Zelle", { reference: "r".repeat(120) }),
	),
	payCase(
		"manual: a reference of 121 characters",
		{},
		record("booking", "Zelle", { reference: "r".repeat(121) }),
	),
	payCase(
		"manual: a reference with markup",
		{},
		record("booking", "Zelle", { reference: "<b>x</b>" }),
	),
	payCase(
		"manual: a reference with unicode",
		{},
		record("booking", "Zelle", { reference: "référence" }),
	),
	payCase(
		"manual: a reference that is not text",
		{},
		record("booking", "Zelle", { reference: 12 }),
	),
	payCase(
		"manual: a booking already paid outside Stripe",
		{ booking_status: "paid" },
		record("booking"),
	),
	payCase(
		"manual: a booking with an open invoice",
		{ ...bookingInvoice("open") },
		record("booking"),
	),
	payCase(
		"manual: a booking with a paid invoice",
		{ ...bookingInvoice("paid") },
		record("booking"),
	),
	payCase(
		"manual: a booking with a void invoice",
		{ ...bookingInvoice("void") },
		record("booking"),
	),
	payCase(
		"manual: a booking whose invoice creation is reserved",
		{ booking_creation_started_at: EARLIER },
		record("booking"),
	),
	payCase(
		"manual: a booking whose Stripe references were deleted",
		{ external_refs_deleted_at: EARLIER },
		record("booking"),
	),
	payCase(
		"manual: a balance before the booking is paid",
		{},
		record("balance"),
	),
	payCase(
		"manual: a balance after the booking is paid",
		{ booking_status: "paid" },
		record("balance", "Venmo", { reference: "V-1" }),
	),
	payCase(
		"manual: a balance after a Stripe-paid booking",
		{ ...bookingInvoice("paid") },
		record("balance"),
	),
	payCase(
		"manual: a balance already paid outside Stripe",
		{ booking_status: "paid", balance_status: "paid" },
		record("balance"),
	),
	payCase(
		"manual: a balance with an open invoice",
		{ ...balanceInvoice("open") },
		record("balance"),
	),
	payCase(
		"manual: a zero balance (a total of one cent)",
		{
			total_amount_cents: 1,
			booking_amount_cents: 1,
			balance_amount_cents: 0,
			booking_status: "paid",
		},
		record("balance"),
	),
	payCase(
		"manual: an odd total, the booking half",
		{
			total_amount_cents: 10_001,
			booking_amount_cents: 5_001,
			balance_amount_cents: 5_000,
		},
		record("booking", "Cash"),
	),
	payCase("manual: the owner email in capitals", {}, record("booking"), {
		steps: [command(record("booking"), { as: asOwner("Owner@Example.TEST") })],
	}),
	payCase("manual: a blank owner email", {}, record("booking"), {
		steps: [command(record("booking"), { as: asOwner("") })],
	}),
	payCase(
		"outage: the payment read fails on a manual payment",
		{},
		record("booking"),
		{
			failures: [
				{
					on: /FROM audio_payments WHERE request_id=\?/,
					message: "D1 unavailable",
					nth: 2,
				},
			],
		},
	),
	payCase("outage: the manual payment batch fails", {}, record("booking"), {
		failures: [
			{
				on: /Received outside Stripe|UPDATE audio_payments SET booking_status='paid'/,
				message: "D1 unavailable",
			},
		],
	}),
	payCase(
		"outage: the read after the manual payment fails",
		{},
		record("booking"),
		{
			failures: [
				{
					on: /FROM audio_payments WHERE request_id=\?/,
					message: "D1 unavailable",
					nth: 3,
				},
			],
		},
	),
	payCase(
		"race: an invoice is recorded before the manual payment batch",
		{},
		record("booking"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET booking_status='paid'/,
					label: "an invoice is recorded on the booking",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_invoice_id='in_race',booking_status='open'`,
						),
				},
			],
		},
	),
	payCase(
		"race: invoice creation is reserved before the manual payment batch",
		{},
		record("booking"),
		{
			interleave: [
				{
					on: /UPDATE audio_payments SET booking_status='paid'/,
					label: "invoice creation is reserved",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_creation_started_at='${EARLIER}'`,
						),
				},
			],
		},
	),
	{
		name: "manual: booking, then balance, then both again",
		music: { seed: audioSeed({}) },
		steps: [
			command(record("booking", "Zelle", { reference: "Z1" })),
			command(record("balance", "Cash"), { advanceMs: 1_000 }),
			command(record("booking", "Venmo"), { advanceMs: 1_000 }),
			command(record("balance", "Venmo"), { advanceMs: 1_000 }),
		],
	},
	{
		name: "manual: the balance first is refused, then the booking, then the balance",
		music: { seed: audioSeed({}) },
		steps: [
			command(record("balance")),
			command(record("booking"), { advanceMs: 1_000 }),
			command(record("balance"), { advanceMs: 1_000 }),
		],
	},
];

const STEPS: StripeStep[] = ["customer", "invoice", "item", "finalize", "send"];

const creating: Case[] = [
	stripeCase("create booking invoice", {}, CREATE_BOOKING),
	stripeCase(
		"create booking invoice with the customer already known",
		{ stripe_customer_id: "cus_known" },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice for an odd total",
		{
			total_amount_cents: 10_001,
			booking_amount_cents: 5_001,
			balance_amount_cents: 5_000,
		},
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice for a one cent total",
		{ total_amount_cents: 1, booking_amount_cents: 1, balance_amount_cents: 0 },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice for the largest total",
		{
			total_amount_cents: 100_000_000,
			booking_amount_cents: 50_000_000,
			balance_amount_cents: 50_000_000,
		},
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice with a service name in markup and unicode",
		{ approved_service: `<b>Mix</b> & "x" 🎤` },
		CREATE_BOOKING,
	),
	stripeWith(
		"create booking invoice for a request with markup and a long summary",
		{},
		CREATE_BOOKING,
		{
			music: {
				seed: {
					owner_requests: [
						rows.ownerRequest("r1", {
							name: `<i>Grace</i> & "H"`,
							summary: `${"s".repeat(400)} <script>`,
						}),
					],
					audio_payments: [audioPayment("r1")],
				},
			},
		},
	),
	stripeWith(
		"create booking invoice for a request with no name",
		{},
		CREATE_BOOKING,
		{
			music: {
				seed: {
					owner_requests: [rows.ownerRequest("r1", { name: "" })],
					audio_payments: [audioPayment("r1")],
				},
			},
		},
	),
	stripeCase(
		"create booking invoice when the invoice exists: no Stripe call",
		{ ...bookingInvoice("open") },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice when the invoice is void: no Stripe call",
		{ ...bookingInvoice("void") },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice with no payment row",
		null,
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice while creation is reserved",
		{ booking_creation_started_at: EARLIER },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice for a booking paid outside Stripe",
		{ booking_status: "paid" },
		CREATE_BOOKING,
	),
	stripeCase(
		"create booking invoice after the Stripe references were deleted",
		{ external_refs_deleted_at: EARLIER },
		CREATE_BOOKING,
	),
	stripeWith("create booking invoice with the flag off", {}, CREATE_BOOKING, {
		env: { STRIPE_PAYMENTS_ENABLED: "false" },
	}),
	stripeWith(
		"create booking invoice with the flag missing",
		{},
		CREATE_BOOKING,
		{ omit: ["STRIPE_PAYMENTS_ENABLED"] },
	),
	stripeWith("create booking invoice with no secret key", {}, CREATE_BOOKING, {
		omit: ["STRIPE_SECRET_KEY"],
	}),
	stripeWith(
		"create booking invoice with no webhook secret",
		{},
		CREATE_BOOKING,
		{ omit: ["STRIPE_WEBHOOK_SECRET"] },
	),
	stripeWith(
		"create booking invoice with the flag off and an invoice already there",
		{ ...bookingInvoice("open") },
		CREATE_BOOKING,
		{ env: { STRIPE_PAYMENTS_ENABLED: "false" } },
	),
	stripeCase(
		"create balance invoice after a Stripe-paid booking",
		{ ...bookingInvoice("paid") },
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice after a booking paid outside Stripe",
		{ booking_status: "paid", stripe_customer_id: "cus_1" },
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice for an odd total",
		{
			...bookingInvoice("paid"),
			total_amount_cents: 10_001,
			booking_amount_cents: 5_001,
			balance_amount_cents: 5_000,
		},
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice for a one cent total (a zero balance)",
		{
			total_amount_cents: 1,
			booking_amount_cents: 1,
			balance_amount_cents: 0,
			booking_status: "paid",
		},
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice for a one cent total, Stripe refuses a zero amount",
		{
			total_amount_cents: 1,
			booking_amount_cents: 1,
			balance_amount_cents: 0,
			booking_status: "paid",
		},
		CREATE_BALANCE,
		{ item: stripeError(400, "Invalid positive integer") },
	),
	stripeCase(
		"create balance invoice before the booking is paid",
		{ ...bookingInvoice("open") },
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice with nothing created yet",
		{},
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice with no payment row",
		null,
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice when it exists: no Stripe call",
		{ ...balanceInvoice("open") },
		CREATE_BALANCE,
	),
	stripeCase(
		"create balance invoice while creation is reserved",
		{ ...bookingInvoice("paid"), balance_creation_started_at: EARLIER },
		CREATE_BALANCE,
	),
	stripeWith(
		"create balance invoice with the flag off",
		{ ...bookingInvoice("paid") },
		CREATE_BALANCE,
		{ env: { STRIPE_PAYMENTS_ENABLED: "false" } },
	),
];

const refusals: Case[] = STEPS.flatMap((step) => {
	const customerKnown = {};

	return [
		stripeCase(
			`booking: ${step} refused with 400 and a message that does not name Stripe`,
			customerKnown,
			CREATE_BOOKING,
			{ [step]: stripeError(400, "No such customer: 'cus_x'") },
		),
		stripeCase(
			`booking: ${step} refused with 400 and a message that names Stripe`,
			customerKnown,
			CREATE_BOOKING,
			{ [step]: stripeError(400, "Your Stripe account is restricted") },
		),
		stripeCase(
			`booking: ${step} fails with a 500 that says not to retry`,
			customerKnown,
			CREATE_BOOKING,
			{ [step]: stripeDown() },
		),
		stripeCase(
			`booking: ${step} fails with a 500 whose message does not name Stripe`,
			customerKnown,
			CREATE_BOOKING,
			{
				[step]: stripeError(
					500,
					"Something broke",
					{},
					{ "stripe-should-retry": "false" },
				),
			},
		),
		stripeCase(
			`booking: ${step} cannot be reached`,
			customerKnown,
			CREATE_BOOKING,
			{ [step]: networkDown("socket hang up") },
		),
	];
});

const refusalsBalance: Case[] = STEPS.slice(1).flatMap((step) => [
	stripeCase(
		`balance: ${step} refused with 400 and a message that does not name Stripe`,
		{ ...bookingInvoice("paid") },
		CREATE_BALANCE,
		{ [step]: stripeError(400, "Invalid request") },
	),
	stripeCase(
		`balance: ${step} fails with a 500 that says not to retry`,
		{ ...bookingInvoice("paid") },
		CREATE_BALANCE,
		{ [step]: stripeDown() },
	),
]);

const stripeOddities: Case[] = [
	stripeCase(
		"booking: an authentication error from Stripe",
		{},
		CREATE_BOOKING,
		{ customer: stripeError(401, "Invalid API Key provided: sk_test_***") },
	),
	stripeCase("booking: a rate limit from Stripe", {}, CREATE_BOOKING, {
		customer: stripeError(
			429,
			"Too many requests",
			{},
			{ "stripe-should-retry": "false" },
		),
	}),
	stripeCase(
		"booking: an idempotency conflict from Stripe",
		{},
		CREATE_BOOKING,
		{
			invoice: stripeError(
				409,
				"Keys for idempotent requests can only be used with the same parameters",
				{ type: "idempotency_error" },
				{ "stripe-should-retry": "false" },
			),
		},
	),
	stripeCase("booking: a retried 500 that then succeeds", {}, CREATE_BOOKING, {
		item: [
			stripeError(500, "Stripe hiccup"),
			json(200, { id: "ii_1", object: "invoiceitem" }),
		],
	}),
	stripeCase("booking: an error body that is not JSON", {}, CREATE_BOOKING, {
		customer: text(400, "<html>bad gateway</html>"),
	}),
	stripeCase("booking: a 200 that is not JSON", {}, CREATE_BOOKING, {
		customer: text(200, "ok"),
	}),
	stripeCase("booking: send answers a draft invoice", {}, CREATE_BOOKING, {
		send: sendAnswer({ status: "draft" }),
	}),
	stripeCase("booking: send answers a void invoice", {}, CREATE_BOOKING, {
		send: sendAnswer({ status: "void" }),
	}),
	stripeCase("booking: send answers no status", {}, CREATE_BOOKING, {
		send: sendAnswer({ status: undefined }),
	}),
	stripeCase("booking: send answers no hosted url", {}, CREATE_BOOKING, {
		send: sendAnswer({ hosted_invoice_url: undefined }),
	}),
	stripeCase("booking: send answers a null hosted url", {}, CREATE_BOOKING, {
		send: sendAnswer({ hosted_invoice_url: null }),
	}),
	stripeCase("booking: send answers an http hosted url", {}, CREATE_BOOKING, {
		send: sendAnswer({ hosted_invoice_url: "http://invoice.stripe.test/i/1" }),
	}),
	stripeCase("booking: send answers an empty hosted url", {}, CREATE_BOOKING, {
		send: sendAnswer({ hosted_invoice_url: "" }),
	}),
	stripeCase(
		"booking: send answers a different invoice id (accepted)",
		{},
		CREATE_BOOKING,
		{ send: sendAnswer({ id: "in_other" }) },
	),
	stripeCase("booking: invoice answers with no id", {}, CREATE_BOOKING, {
		invoice: json(200, { object: "invoice" }),
	}),
	stripeCase("booking: customer answers with no id", {}, CREATE_BOOKING, {
		customer: json(200, { object: "customer" }),
	}),
	stripeCase(
		"balance: send answers a draft invoice",
		{ ...bookingInvoice("paid") },
		CREATE_BALANCE,
		{ send: sendAnswer({ status: "draft" }) },
	),
];

const recording: Case[] = [
	stripeWith(
		"outage: the audit/record batch fails after Stripe created the invoice",
		{},
		CREATE_BOOKING,
		{
			failures: [
				{
					on: /INSERT INTO owner_request_audit \(request_id,action,actor,note,occurred_at\)\s+SELECT/,
					message: "D1 unavailable",
				},
			],
		},
	),
	stripeWith("outage: the read before recording fails", {}, CREATE_BOOKING, {
		failures: [
			{
				on: /FROM audio_payments WHERE request_id=\?/,
				message: "D1 unavailable",
				nth: 4,
			},
		],
	}),
	stripeWith("outage: the read after recording fails", {}, CREATE_BOOKING, {
		failures: [
			{
				on: /FROM audio_payments WHERE request_id=\?/,
				message: "D1 unavailable",
				nth: 5,
			},
		],
	}),
	stripeWith("outage: the reservation fails", {}, CREATE_BOOKING, {
		failures: [
			{ on: /SET booking_creation_started_at=\?/, message: "D1 unavailable" },
		],
	}),
	stripeWith(
		"outage: the first read fails on an invoice request",
		{},
		CREATE_BOOKING,
		{
			failures: [
				{
					on: /FROM audio_payments WHERE request_id=\?/,
					message: "D1 unavailable",
				},
			],
		},
	),
	stripeWith(
		"outage: the request read fails on an invoice request",
		{},
		CREATE_BOOKING,
		{
			failures: [
				{ on: /FROM owner_requests WHERE id=\?/, message: "D1 unavailable" },
			],
		},
	),
	stripeWith(
		"race: another invoice takes the booking while Stripe works",
		{},
		CREATE_BOOKING,
		{
			interleave: [
				{
					on: /INSERT INTO owner_request_audit \(request_id,action,actor,note,occurred_at\)\s+SELECT/,
					label: "a webhook recovers another invoice on the booking",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_invoice_id='in_other',booking_status='open',booking_creation_started_at=NULL`,
						),
				},
			],
		},
	),
	stripeWith(
		"race: the booking is paid outside Stripe while Stripe works",
		{},
		CREATE_BOOKING,
		{
			interleave: [
				{
					on: /INSERT INTO owner_request_audit \(request_id,action,actor,note,occurred_at\)\s+SELECT/,
					label: "the owner records the booking as paid",
					run: (sqlite) =>
						sqlite.exec(`UPDATE audio_payments SET booking_status='paid'`),
				},
			],
		},
	),
	stripeWith(
		"race: the same invoice was already recorded by a webhook",
		{},
		CREATE_BOOKING,
		{
			interleave: [
				{
					on: /INSERT INTO owner_request_audit \(request_id,action,actor,note,occurred_at\)\s+SELECT/,
					label: "a webhook recovers the same invoice",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_invoice_id='in_1',booking_invoice_url='https://invoice.stripe.test/i/1',booking_status='open',stripe_customer_id='cus_1',booking_creation_started_at=NULL`,
						),
				},
			],
		},
	),
	stripeWith(
		"race: another request reserves creation first",
		{},
		CREATE_BOOKING,
		{
			interleave: [
				{
					on: /SET booking_creation_started_at=\?/,
					label: "another request reserves creation",
					run: (sqlite) =>
						sqlite.exec(
							`UPDATE audio_payments SET booking_creation_started_at='${EARLIER}'`,
						),
				},
			],
		},
	),
];

const replacing: Case[] = [
	stripeCase(
		"replace booking: a void invoice is replaced and a new one created",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{},
		{
			music: {
				seed: audioSeed(
					{ ...bookingInvoice("void"), booking_status_updated_at: isoAt(-300) },
					{ stripe_invoice_attempts: [attempt("in_b1", "r1", "booking")] },
				),
			},
		},
	),
	stripeCase(
		"replace booking: a void invoice that has been replaced once before",
		{ ...bookingInvoice("void"), booking_attempt_count: 1 },
		REPLACE_BOOKING,
	),
	stripeCase(
		"replace booking: an open invoice",
		{ ...bookingInvoice("open") },
		REPLACE_BOOKING,
	),
	stripeCase(
		"replace booking: a paid invoice",
		{ ...bookingInvoice("paid") },
		REPLACE_BOOKING,
	),
	stripeCase(
		"replace booking: an uncollectible invoice",
		{ ...bookingInvoice("uncollectible") },
		REPLACE_BOOKING,
	),
	stripeCase(
		"replace booking: a failed invoice",
		{ ...bookingInvoice("payment_failed") },
		REPLACE_BOOKING,
	),
	stripeCase(
		"replace booking: a draft invoice",
		{ ...bookingInvoice("draft") },
		REPLACE_BOOKING,
	),
	stripeCase("replace booking: nothing created yet", {}, REPLACE_BOOKING),
	stripeCase(
		"replace booking: paid outside Stripe",
		{ booking_status: "paid" },
		REPLACE_BOOKING,
	),
	stripeCase("replace booking: no payment row", null, REPLACE_BOOKING),
	stripeCase(
		"replace booking: Stripe unavailable leaves the void invoice alone",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{},
		{ env: { STRIPE_PAYMENTS_ENABLED: "false" } },
	),
	stripeCase(
		"replace booking: no secret key",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{},
		{ omit: ["STRIPE_SECRET_KEY"] },
	),
	stripeCase(
		"replace balance: a void invoice after a paid booking",
		{ ...balanceInvoice("void") },
		REPLACE_BALANCE,
	),
	stripeCase(
		"replace balance: an open invoice",
		{ ...balanceInvoice("open") },
		REPLACE_BALANCE,
	),
	stripeCase(
		"replace balance: nothing created yet",
		{ booking_status: "paid" },
		REPLACE_BALANCE,
	),
	stripeCase(
		"replace booking: Stripe refuses after the replacement was recorded",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{ invoice: stripeError(400, "Invalid request") },
	),
	stripeCase(
		"replace booking: Stripe is down after the replacement was recorded",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{ send: stripeDown() },
	),
	stripeCase(
		"replace booking: the replacement batch fails",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{},
		{
			failures: [
				{
					on: /booking-invoice-replaced|UPDATE stripe_invoice_attempts/,
					message: "D1 unavailable",
				},
			],
		},
	),
	stripeCase(
		"replace booking: the invoice stops being void before the replacement batch",
		{ ...bookingInvoice("void") },
		REPLACE_BOOKING,
		{},
		{
			interleave: [
				{
					on: /UPDATE stripe_invoice_attempts SET replaced_at/,
					label: "a webhook moves the invoice to open",
					run: (sqlite) =>
						sqlite.exec(`UPDATE audio_payments SET booking_status='open'`),
				},
			],
		},
	),
];

// Sequences across the payment route and the webhook.
const WEBHOOK_PATH = "/api/stripe/webhook";

const hook = (
	event: Parameters<typeof webhookStep>[0],
	over: Partial<Step> & { at?: number } = {},
) => webhookStep(event, { handler: webhook, path: WEBHOOK_PATH, ...over });

// The first five Stripe calls make the booking invoice "in_b1"; the later ones make the balance invoice "in_l1".
const bookingScript = stripeScript({}, { invoice: "in_b1" });

const balanceScript = stripeScript({}, { invoice: "in_l1" });

const twoInvoices: Responder = (call) =>
	call.n < 5 ? bookingScript(call) : balanceScript(call);

const sequences: Case[] = [
	{
		name: "the whole life: approve, create, Stripe says paid, create the balance, Stripe says paid",
		music: { seed: audioSeed(null) },
		fetches: twoInvoices,
		steps: [
			command(approve),
			command(CREATE_BOOKING, { advanceMs: 1_000 }),
			hook(
				audioEvent(
					"invoice.paid",
					{ total: 5_000 },
					{ id: "evt_1", created: NOW_SECONDS + 10 },
				),
				{ advanceMs: 1_000 },
			),
			command(CREATE_BALANCE, { advanceMs: 1_000 }),
			hook(
				balanceEvent(
					"invoice.paid",
					{},
					{ id: "evt_2", created: NOW_SECONDS + 20 },
				),
				{ advanceMs: 1_000 },
			),
		],
	},
	{
		name: "create twice: the second returns the first invoice with no Stripe call",
		music: { seed: audioSeed({}) },
		fetches: stripeScript(),
		steps: [
			command(CREATE_BOOKING),
			command(CREATE_BOOKING, { advanceMs: 1_000 }),
		],
	},
	{
		name: "the stuck reservation: create fails at send, create again, a manual payment, then a webhook recovers it",
		music: { seed: audioSeed({}) },
		fetches: stripeScript(
			{ send: stripeError(400, "Invalid request") },
			{ invoice: "in_1" },
		),
		steps: [
			command(CREATE_BOOKING),
			command(CREATE_BOOKING, { advanceMs: 60_000 }),
			command(record("booking"), { advanceMs: 60_000 }),
			hook(
				audioEvent(
					"invoice.sent",
					{ id: "in_1" },
					{ id: "evt_1", created: NOW_SECONDS + 30 },
				),
				{ advanceMs: 60_000 },
			),
			command(CREATE_BOOKING, { advanceMs: 60_000 }),
		],
	},
	{
		name: "the stuck reservation a day later is still stuck",
		music: { seed: audioSeed({}) },
		fetches: stripeScript({ finalize: stripeDown() }),
		steps: [
			command(CREATE_BOOKING),
			command(CREATE_BOOKING, { advanceMs: 86_400_000 }),
		],
	},
	{
		name: "a failed create and a replace do not unstick a reserved booking",
		music: { seed: audioSeed({}) },
		fetches: stripeScript({ item: stripeError(400, "Invalid request") }),
		steps: [
			command(CREATE_BOOKING),
			command(REPLACE_BOOKING, { advanceMs: 1_000 }),
		],
	},
	{
		name: "void by webhook, replace, create the replacement",
		music: {
			seed: audioSeed(
				{ ...bookingInvoice("open") },
				{ stripe_invoice_attempts: [attempt("in_b1", "r1", "booking")] },
			),
		},
		fetches: stripeScript({}, { invoice: "in_b2" }),
		steps: [
			hook(
				audioEvent(
					"invoice.voided",
					{},
					{ id: "evt_v", created: NOW_SECONDS - 10 },
				),
			),
			command(REPLACE_BOOKING, { advanceMs: 1_000 }),
			hook(
				audioEvent(
					"invoice.paid",
					{ id: "in_b2" },
					{ id: "evt_p", created: NOW_SECONDS + 5 },
				),
				{ advanceMs: 1_000 },
			),
			hook(
				audioEvent(
					"invoice.paid",
					{ id: "in_b1" },
					{ id: "evt_old", created: NOW_SECONDS + 6 },
				),
				{ advanceMs: 1_000 },
			),
		],
	},
	{
		name: "approve, then approve with other terms, then create",
		music: { seed: audioSeed(null) },
		fetches: stripeScript(),
		steps: [
			command(approve),
			command(approveBody({ totalAmountCents: 4_000 }), { advanceMs: 1_000 }),
			command(CREATE_BOOKING, { advanceMs: 1_000 }),
		],
	},
	{
		name: "manual booking payment, then a create-booking-invoice is refused",
		music: { seed: audioSeed({}) },
		fetches: stripeScript(),
		steps: [
			command(record("booking")),
			command(CREATE_BOOKING, { advanceMs: 1_000 }),
		],
	},
	{
		name: "a retried create after a network failure that then recovers",
		music: { seed: audioSeed({}) },
		fetches: stripeScript({
			customer: [
				networkDown("socket hang up"),
				json(200, { id: "cus_1", object: "customer" }),
			],
		}),
		steps: [command(CREATE_BOOKING)],
	},
	{
		name: "a webhook for the booking arrives while creation is reserved",
		music: { seed: audioSeed({ booking_creation_started_at: EARLIER }) },
		fetches: stripeScript(),
		steps: [
			hook(audioEvent("invoice.paid", { id: "in_late" }, { id: "evt_l" })),
			command(CREATE_BOOKING, { advanceMs: 1_000 }),
		],
	},
];

const cases: Case[] = [
	...guards,
	...approving,
	...manual,
	...creating,
	...refusals,
	...refusalsBalance,
	...stripeOddities,
	...recording,
	...replacing,
	...sequences,
];

defineCorpus("owner-request-payment", POST, cases);
