// Whether a Stripe invoice event changes a stored invoice. Stripe does not deliver events in order, so the rule is about
// facts, not arrival order:
//   1. Money received is never lost. A paid invoice stays paid, and a paid event applies to any invoice that is not paid
//      yet, however old the event is.
//   2. Otherwise a stale event never undoes a newer status: an older event is ignored and a newer one applies.
//   3. Two events with the same created second are a tie. Audio payments apply the later arrival ("latest"); software
//      invoices apply the higher-ranked status ("rank").
// The SQL that stores the result keeps only a compare-and-set guard. What is guaranteed: a paid event applies to any
// invoice that is not paid when its batch runs, even if a newer event committed after the handler read the invoice (the
// guard never depends on the time that was read), and a paid invoice is never overwritten. What is not: for events that
// are not paid, the decision uses the stored time read earlier, and the guard compares times again at write time, so two
// near-simultaneous non-paid events settle by the write-time guard only. The software copy of the non-paid tie-break lives
// in the SQL of applySoftwareInvoiceEvent; keep the two in step.

const statusRank = new Map([
	["paid", 5],
	["void", 4],
	["uncollectible", 3],
	["payment_failed", 2],
	["open", 1],
]);

const rankOf = (status: string) => statusRank.get(status) ?? 0;

export function invoiceEventDecision(input: {
	storedStatus: string;
	/** The ISO time of the event that set the stored status; null before any event was applied. */
	storedAt: string | null;
	incomingStatus: string;
	incomingAt: string;
	sameTime: "latest" | "rank";
}): "apply" | "ignore" {
	if (input.storedStatus === "paid") return "ignore";

	if (input.incomingStatus === "paid") return "apply";

	if (!input.storedAt || input.incomingAt > input.storedAt) return "apply";

	if (input.incomingAt < input.storedAt) return "ignore";

	if (input.sameTime === "latest") return "apply";

	return rankOf(input.incomingStatus) > rankOf(input.storedStatus)
		? "apply"
		: "ignore";
}

const LATEST_TIME = "9999-12-31T23:59:59.999Z";

/**
 * The time to bind to a "stored time is not after this" guard: the event's own time, except for a paid event, which is
 * bound later than any stored time so the guard cannot drop it. The bound value is never stored.
 */
export function guardTime(status: string, occurredAt: string): string {
	return status === "paid" ? LATEST_TIME : occurredAt;
}
