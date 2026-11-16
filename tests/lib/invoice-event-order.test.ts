import { describe, expect, it } from "vitest";
import { invoiceEventDecision } from "~/lib/invoice-event-order";
import {
	expectedStatus,
	orderMatrix,
	type Arrival,
	type EventStatus,
} from "../helpers/invoice-event-order";

// See tests/helpers/invoice-event-order.ts for the principle every expectation follows: money received is never lost
// to delivery order, and otherwise a stale event never undoes a newer status.

const STORED_AT = "2026-09-20T12:00:00.000Z";

const incomingAt: Record<Arrival, string> = {
	older: "2026-09-20T11:59:00.000Z",
	same: STORED_AT,
	newer: "2026-09-20T12:01:00.000Z",
};

describe("invoiceEventDecision", () => {
	describe.each(["latest", "rank"] as const)("ties: %s", (sameTime) => {
		it.each(orderMatrix)(
			"stored %s, then %s arriving %s",
			(stored, incoming, arrival) => {
				const decision = invoiceEventDecision({
					storedStatus: stored,
					storedAt: STORED_AT,
					incomingStatus: incoming,
					incomingAt: incomingAt[arrival],
					sameTime,
				});

				const final: EventStatus =
					decision === "apply" && stored !== "paid" ? incoming : stored;

				expect(final).toBe(expectedStatus(stored, incoming, arrival, sameTime));
			},
		);
	});

	it("applies the first event of an invoice that has no marker", () => {
		for (const storedStatus of ["not_created", "draft", "creating", "open"]) {
			expect(
				invoiceEventDecision({
					storedStatus,
					storedAt: null,
					incomingStatus: "payment_failed",
					incomingAt: STORED_AT,
					sameTime: "latest",
				}),
			).toBe("apply");
		}
	});

	it("applies an older paid event after a newer non-paid event", () => {
		expect(
			invoiceEventDecision({
				storedStatus: "payment_failed",
				storedAt: incomingAt.newer,
				incomingStatus: "paid",
				incomingAt: incomingAt.older,
				sameTime: "latest",
			}),
		).toBe("apply");
	});

	it("never applies any event to a paid invoice", () => {
		for (const incomingStatus of ["open", "paid", "payment_failed", "void"]) {
			expect(
				invoiceEventDecision({
					storedStatus: "paid",
					storedAt: STORED_AT,
					incomingStatus,
					incomingAt: incomingAt.newer,
					sameTime: "latest",
				}),
			).toBe("ignore");
		}
	});
});
