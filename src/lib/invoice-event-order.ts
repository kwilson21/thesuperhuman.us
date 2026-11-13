// Whether a Stripe invoice event changes a stored invoice. Stripe does not deliver events in order, so the rule is about
// facts, not arrival order:
//   1. Money received is never lost. A paid invoice stays paid, and a paid event applies to any invoice that is not paid
//      yet, however old the event is.
//   2. Otherwise a stale event never undoes a newer status: an older event is ignored and a newer one applies.
//   3. Two events with the same created second are a tie. Audio payments apply the later arrival ("latest"); software
//      invoices apply the higher-ranked status ("rank").
// The SQL that stores the result keeps only the compare-and-set guard for this rule, so a race between two deliveries
// cannot undo it. The guard compares the stored time with a bound time; guardTime gives that bound, which lets an older
// paid event pass.

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
 * The time to bind to a "stored time is not after this" guard. It is the event's own time, except for a paid event that is
 * older than the stored time: that one is bound later than any stored time, so the guard passes while the invoice is not
 * paid. (Only the stale-read case needs this; the guard's `status<>'paid'` still keeps a paid invoice paid.)
 */
export function guardTime(input: {
	incomingStatus: string;
	incomingAt: string;
	storedAt: string | null;
}): string {
	return input.incomingStatus === "paid" &&
		input.storedAt &&
		input.incomingAt < input.storedAt
		? LATEST_TIME
		: input.incomingAt;
}
