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

/** How the incoming event's time compares with the stored one; "first" when no event has been applied yet. */
export type TimeRelation = "first" | "older" | "same" | "newer";

/** The order of statuses that breaks a same-second tie for software invoices; an unknown status ranks 0. */
export function rankOf(status: string): number {
	//@ verify
	//@ ensures \result === (status === "paid" ? 5 : status === "void" ? 4 : status === "uncollectible" ? 3 : status === "payment_failed" ? 2 : status === "open" ? 1 : 0)
	if (status === "paid") return 5;

	if (status === "void") return 4;

	if (status === "uncollectible") return 3;

	if (status === "payment_failed") return 2;

	if (status === "open") return 1;

	return 0;
}

/**
 * The rule itself, over the time relation instead of the two time strings. Checked by LemmaScript and Dafny
 * (docs/verification.md, "Verified modules"): it never changes a paid invoice; applies a paid event to any invoice that is
 * not paid yet, whatever the times; and otherwise applies exactly the events that are newer, the first one, or tied and
 * allowed by the tie rule.
 */
export function decideByOrder(
	storedStatus: string,
	incomingStatus: string,
	relation: TimeRelation,
	sameTime: "latest" | "rank",
): "apply" | "ignore" {
	//@ verify
	//@ ensures storedStatus === "paid" ==> \result === "ignore"
	//@ ensures (storedStatus !== "paid" && incomingStatus === "paid") ==> \result === "apply"
	//@ ensures (storedStatus !== "paid" && incomingStatus !== "paid" && relation === "older") ==> \result === "ignore"
	//@ ensures (storedStatus !== "paid" && incomingStatus !== "paid" && (relation === "first" || relation === "newer")) ==> \result === "apply"
	//@ ensures (storedStatus !== "paid" && incomingStatus !== "paid" && relation === "same" && sameTime === "latest") ==> \result === "apply"
	//@ ensures (storedStatus !== "paid" && incomingStatus !== "paid" && relation === "same" && sameTime === "rank") ==> (\result === "apply" <==> rankOf(incomingStatus) > rankOf(storedStatus))
	if (storedStatus === "paid") return "ignore";

	if (incomingStatus === "paid") return "apply";

	if (relation === "first" || relation === "newer") return "apply";

	if (relation === "older") return "ignore";

	if (sameTime === "latest") return "apply";

	return rankOf(incomingStatus) > rankOf(storedStatus) ? "apply" : "ignore";
}

/** The stored status after one event: the incoming status if the rule applies the event, else the stored one. */
export function nextStatus(
	storedStatus: string,
	incomingStatus: string,
	relation: TimeRelation,
	sameTime: "latest" | "rank",
): string {
	//@ verify
	//@ ensures \result === incomingStatus || \result === storedStatus
	return decideByOrder(storedStatus, incomingStatus, relation, sameTime) ===
		"apply"
		? incomingStatus
		: storedStatus;
}

/** One delivered event, as the rule sees it: its status and how its time compares with the stored time when it arrives. */
export type EventStep = { status: string; relation: TimeRelation };

/**
 * The stored status after the first `n` events of a delivery sequence, applied one after another. Lemmas, checked by
 * Dafny by induction over the sequence (not restatements of the function body): a paid invoice stays paid whatever
 * follows, and a sequence that contains a paid event ends paid in whatever order its events arrive.
 */
export function statusAfter(
	storedStatus: string,
	steps: EventStep[],
	n: number,
	sameTime: "latest" | "rank",
): string {
	//@ verify
	//@ type n nat
	//@ requires n <= steps.length
	//@ ensures storedStatus === "paid" ==> \result === "paid"
	//@ ensures exists(i: nat, i < n && steps[i].status === "paid") ==> \result === "paid"
	//@ decreases n
	if (n === 0) return storedStatus;
	// SAFETY: n is at most steps.length and at least 1 here, so index n - 1 is in the array.
	const step = steps[n - 1] as EventStep;

	return nextStatus(
		statusAfter(storedStatus, steps, n - 1, sameTime),
		step.status,
		step.relation,
		sameTime,
	);
}

/**
 * Redelivery changes nothing: after an event is handled once, handling it again (now the same time as the stored one if it
 * was applied, unchanged if it was ignored) leaves the status as it was. The result is always true.
 */
export function redeliveryChangesNothing(
	storedStatus: string,
	incomingStatus: string,
	relation: TimeRelation,
	sameTime: "latest" | "rank",
): boolean {
	//@ verify
	//@ ensures \result === true
	const first = nextStatus(storedStatus, incomingStatus, relation, sameTime);

	const relationAfter: TimeRelation =
		decideByOrder(storedStatus, incomingStatus, relation, sameTime) === "apply"
			? "same"
			: relation;

	return nextStatus(first, incomingStatus, relationAfter, sameTime) === first;
}

//@ skip
function relateTimes(
	incomingAt: string,
	storedAt: string | null,
): TimeRelation {
	// Not checked. LemmaScript reads the string comparison (as a lexicographic order), but proving that two times are
	// "same" only when they are equal needs a hand-written Dafny lemma about that recursive order (irreflexivity), which
	// would mean committing a .dfy file. The matrix in tests/lib/invoice-event-order.test.ts covers it instead.
	if (!storedAt) return "first";

	if (incomingAt > storedAt) return "newer";

	if (incomingAt < storedAt) return "older";

	return "same";
}

/** What invoiceEventDecision reads: the stored row and the incoming event. */
export type InvoiceEventInput = {
	storedStatus: string;
	/** The ISO time of the event that set the stored status; null before any event was applied. */
	storedAt: string | null;
	incomingStatus: string;
	incomingAt: string;
	sameTime: "latest" | "rank";
};

//@ skip
export function invoiceEventDecision(
	input: InvoiceEventInput,
): "apply" | "ignore" {
	return decideByOrder(
		input.storedStatus,
		input.incomingStatus,
		relateTimes(input.incomingAt, input.storedAt),
		input.sameTime,
	);
}

const LATEST_TIME = "9999-12-31T23:59:59.999Z";

/**
 * The time to bind to a "stored time is not after this" guard: the event's own time, except for a paid event, which is
 * bound later than any stored time so the guard cannot drop it. The bound value is never stored.
 */
export function guardTime(status: string, occurredAt: string): string {
	return status === "paid" ? LATEST_TIME : occurredAt;
}
