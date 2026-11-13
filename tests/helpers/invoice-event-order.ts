// The order matrix for Stripe invoice events, shared by the rule test and the webhook route test.
//
// The one principle behind every expected outcome:
//   1. The terminal facts about money are never lost to delivery order. "paid" is the one the site handles; once an invoice
//      is paid it stays paid, and a paid event applies whenever the invoice is not paid yet, however old the event is.
//      (void, uncollectible and refunds are not terminal facts about money received: the site does not handle refunds, and
//      Stripe cannot void or mark a paid invoice, so a paid-then-void pair cannot occur in practice. The conservative
//      reading is that received money stays recorded as paid.)
//   2. Otherwise a stale event never undoes a newer status: an older event is ignored, a newer one applies.
//   3. Two events with the same created second are a tie. Audio payments apply the later arrival; software invoices apply
//      the higher-ranked status (paid, void, uncollectible, payment_failed, open) and ignore an equal or lower one.
// The expectations below are written from that principle, not read back from the code under test.

export const eventTypes = {
	open: "invoice.sent",
	paid: "invoice.paid",
	payment_failed: "invoice.payment_failed",
	void: "invoice.voided",
	uncollectible: "invoice.marked_uncollectible",
} as const;

export type EventStatus = keyof typeof eventTypes;

export const eventStatuses: EventStatus[] = [
	"open",
	"paid",
	"payment_failed",
	"void",
	"uncollectible",
];

export type Arrival = "older" | "same" | "newer";

export const arrivals: Arrival[] = ["older", "same", "newer"];

const rank: Record<EventStatus, number> = {
	paid: 5,
	void: 4,
	uncollectible: 3,
	payment_failed: 2,
	open: 1,
};

/** The final status after `incoming` arrives, `arrival` relative to the time of the event that set `stored`. */
export function expectedStatus(
	stored: EventStatus,
	incoming: EventStatus,
	arrival: Arrival,
	tie: "latest" | "rank",
): EventStatus {
	if (stored === "paid") return "paid";

	if (incoming === "paid") return "paid";

	if (arrival === "older") return stored;

	if (arrival === "newer") return incoming;

	if (tie === "latest") return incoming;

	return rank[incoming] > rank[stored] ? incoming : stored;
}

/** Every ordered pair of statuses with each arrival: 5 x 5 x 3 = 75 rows. */
export const orderMatrix: [EventStatus, EventStatus, Arrival][] =
	eventStatuses.flatMap((stored) =>
		eventStatuses.flatMap((incoming) =>
			arrivals.map((arrival): [EventStatus, EventStatus, Arrival] => [
				stored,
				incoming,
				arrival,
			]),
		),
	);
