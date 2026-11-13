import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import { partial } from "../helpers/doubles";
import { fakeBatch } from "../helpers/d1";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { testRuntime } from "../helpers/runtime";

const verify = vi.hoisted(() => vi.fn());

vi.mock("~/lib/stripe-invoicing", () => ({ verifyStripeWebhook: verify }));

import { POST } from "~/pages/api/stripe/webhook";
import { replaceTerminalInvoice } from "~/lib/audio-payments";
import {
	eventTypes,
	expectedStatus,
	orderMatrix,
	type Arrival,
	type EventStatus,
} from "../helpers/invoice-event-order";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;

beforeEach(() => {
	vi.clearAllMocks();
	sql = new DatabaseSync(":memory:");
	sql.exec(
		readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
	);
	sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('request-1','service','artist@example.com','Mix','reviewed','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z');
    INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,stripe_customer_id,booking_invoice_id,booking_invoice_url,booking_status,created_at,updated_at)
    VALUES ('request-1','Mix',20000,10000,10000,'2026-09-20T12:00:00Z','cus_1','in_booking','https://invoice.stripe.com/booking','open','2026-09-20T12:00:00Z','2026-09-20T12:00:00Z')`);

	// This fake runs every batch statement for effect and never returns its rows, as the webhook test expects.
	db = sqliteD1(sql, /(?!)/);
});

function context(signature = "valid"): APIContext {
	return partial<APIContext>({
		request: new Request("https://thesuperhuman.us/api/stripe/webhook", {
			method: "POST",
			headers: {
				"stripe-signature": signature,
				"content-type": "application/json",
			},
			body: '{"raw":true}',
		}),
		locals: {
			runtime: testRuntime({ MUSIC_DB: db, STRIPE_PAYMENTS_ENABLED: "true" }),
		},
	});
}

function event(type: string, id = "evt_1") {
	return {
		id,
		type,
		created: 1_790_000_000,
		data: {
			object: {
				id: "in_booking",
				customer: "cus_1",
				hosted_invoice_url: "https://invoice.stripe.com/booking",
				total: 10000,
				currency: "usd",
				metadata: { audio_request_id: "request-1", installment: "booking" },
			},
		},
	};
}

it("rejects missing or invalid signatures without changing D1", async () => {
	expect((await POST(context(""))).status).toBe(400);
	verify.mockRejectedValueOnce(new Error("bad signature"));
	expect((await POST(context())).status).toBe(400);
	expect(
		sql.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events").get(),
	).toEqual({ total: 0 });
	expect(
		sql.prepare("SELECT booking_status FROM audio_payments").get(),
	).toEqual({ booking_status: "open" });
});

it.each([
	["invoice.sent", "open"],
	["invoice.paid", "paid"],
	["invoice.payment_failed", "payment_failed"],
	["invoice.voided", "void"],
	["invoice.marked_uncollectible", "uncollectible"],
])("projects %s as %s", async (type, status) => {
	verify.mockResolvedValueOnce(event(type));
	expect((await POST(context())).status).toBe(200);
	expect(
		sql.prepare("SELECT booking_status FROM audio_payments").get(),
	).toEqual({ booking_status: status });
});

it("acknowledges unrelated events without storing them", async () => {
	verify.mockResolvedValueOnce(event("customer.created"));
	expect((await POST(context())).status).toBe(200);
	expect(
		sql.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events").get(),
	).toEqual({ total: 0 });
});

it("applies a replayed event only once", async () => {
	verify.mockResolvedValue(event("invoice.paid"));
	expect((await POST(context())).status).toBe(200);
	expect((await POST(context())).status).toBe(200);
	expect(
		sql.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events").get(),
	).toEqual({ total: 1 });
});

it("dead-letters an audio invoice whose request metadata does not match a stored payment", async () => {
	const value = event("invoice.paid");
	value.data.object.metadata.audio_request_id = "another-request";
	verify.mockResolvedValueOnce(value);
	expect((await POST(context())).status).toBe(200);
	expect(
		sql.prepare("SELECT reason FROM stripe_unmatched_events").get(),
	).toEqual({ reason: "request-not-found" });
	expect(
		sql.prepare("SELECT booking_status FROM audio_payments").get(),
	).toEqual({ booking_status: "open" });
});

it("recovers a recognized audio invoice that is not recorded yet", async () => {
	sql
		.prepare(`UPDATE audio_payments SET booking_invoice_id=NULL,booking_invoice_url=NULL,booking_status='not_created'
    WHERE request_id='request-1'`)
		.run();
	verify.mockResolvedValueOnce(event("invoice.paid"));
	expect((await POST(context())).status).toBe(200);
	expect(
		sql
			.prepare("SELECT booking_invoice_id,booking_status FROM audio_payments")
			.get(),
	).toEqual({ booking_invoice_id: "in_booking", booking_status: "paid" });
	expect(
		sql.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events").get(),
	).toEqual({ total: 1 });
});

it("dead-letters a late event for a replaced invoice without reviving it", async () => {
	sql
		.prepare(`INSERT INTO stripe_invoice_attempts(invoice_id,request_id,installment,created_at)
    VALUES ('in_booking','request-1','booking','2026-09-20T12:00:00Z')`)
		.run();
	sql
		.prepare(
			"UPDATE audio_payments SET booking_status='void' WHERE request_id='request-1'",
		)
		.run();
	await replaceTerminalInvoice(db, {
		requestId: "request-1",
		installment: "booking",
		actor: "owner@example.com",
	});
	verify.mockResolvedValueOnce(event("invoice.paid", "evt_replaced_paid"));
	expect((await POST(context())).status).toBe(200);
	expect(
		sql
			.prepare("SELECT booking_invoice_id,booking_status FROM audio_payments")
			.get(),
	).toEqual({ booking_invoice_id: null, booking_status: "not_created" });
	expect(
		sql.prepare("SELECT invoice_id,reason FROM stripe_unmatched_events").get(),
	).toEqual({ invoice_id: "in_booking", reason: "invoice-conflict" });
});

it.each([
	["invoice.sent", "open"],
	["invoice.paid", "paid"],
	["invoice.payment_failed", "payment_failed"],
	["invoice.voided", "void"],
	["invoice.marked_uncollectible", "uncollectible"],
])(
	"routes software %s without touching audio payments",
	async (type, status) => {
		sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('software','software','client@example.com','Tool','new','now','now');
    INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('offer','software',1,'sent','{}','now','now');
    INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at)
      VALUES ('local','software','offer',0,'deposit',10000,7,'creating','owner','now','now')`);

		const value = {
			id: "evt_software",
			type,
			created: 1790000000,
			data: {
				object: {
					id: "in_software",
					customer: "cus_software",
					total: 10000,
					currency: "usd",
					due_date: 1790600000,
					hosted_invoice_url: "https://example.com/pay",
					metadata: {
						software_request_id: "software",
						software_offer_id: "offer",
						software_invoice_id: "local",
						milestone_index: "0",
						kind: "deposit",
					},
				},
			},
		};

		verify.mockResolvedValue(value);
		expect((await POST(context())).status).toBe(200);
		expect((await POST(context())).status).toBe(200);
		expect(
			sql
				.prepare("SELECT status,stripe_invoice_id FROM software_invoices")
				.get(),
		).toEqual({ status, stripe_invoice_id: "in_software" });
		expect(
			sql.prepare("SELECT booking_status FROM audio_payments").get(),
		).toEqual({ booking_status: "open" });
		expect(
			sql
				.prepare(
					"SELECT count(*) AS n FROM software_project_audit WHERE action='invoice-status-updated'",
				)
				.get(),
		).toEqual({ n: 1 });
		expect(
			sql.prepare("SELECT count(*) AS n FROM stripe_webhook_events").get(),
		).toEqual({ n: 1 });
	},
);

// Delivery order. Stripe does not guarantee it. The principle (tests/helpers/invoice-event-order.ts): money received is
// never lost to delivery order, and otherwise a stale event never undoes a newer status. Each row below delivers two
// real events through the route: first one that applies to a fresh invoice, then a second one that is older than, the same
// second as, or newer than the first.

const BASE = 1_790_000_000;

const arrivalOffset: Record<Arrival, number> = {
	older: -60,
	same: 0,
	newer: 60,
};

function audioEventAt(status: EventStatus, id: string, created: number) {
	return { ...event(eventTypes[status], id), created };
}

function seedSoftware() {
	sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('software','software','client@example.com','Tool','new','now','now');
    INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('offer','software',1,'sent','{}','now','now');
    INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at)
      VALUES ('local','software','offer',0,'deposit',10000,7,'creating','owner','now','now')`);
}

function softwareEventAt(status: EventStatus, id: string, created: number) {
	return {
		id,
		type: eventTypes[status],
		created,
		data: {
			object: {
				id: "in_software",
				customer: "cus_software",
				total: 10000,
				currency: "usd",
				due_date: 1790600000,
				hosted_invoice_url: "https://example.com/pay",
				metadata: {
					software_request_id: "software",
					software_offer_id: "offer",
					software_invoice_id: "local",
					milestone_index: "0",
					kind: "deposit",
				},
			},
		},
	};
}

const audioStatus = () =>
	sql.prepare("SELECT booking_status AS status FROM audio_payments").get();

const softwareStatus = () =>
	sql.prepare("SELECT status FROM software_invoices").get();

describe.each(["audio", "software"] as const)("%s event order", (kind) => {
	const make = kind === "audio" ? audioEventAt : softwareEventAt;
	const read = kind === "audio" ? audioStatus : softwareStatus;
	const tie = kind === "audio" ? "latest" : "rank";

	it.each(orderMatrix)(
		"first %s, then %s arriving %s",
		async (first, second, arrival) => {
			if (kind === "software") seedSoftware();
			verify.mockResolvedValueOnce(make(first, "evt_first", BASE));
			expect((await POST(context())).status).toBe(200);
			verify.mockResolvedValueOnce(
				make(second, "evt_second", BASE + arrivalOffset[arrival]),
			);
			expect((await POST(context())).status).toBe(200);
			expect(read()).toEqual({
				status: expectedStatus(first, second, arrival, tie),
			});
			expect(
				sql
					.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events")
					.get(),
			).toEqual({ total: 2 });
		},
	);

	it("applies an older paid event that arrives after a newer invoice.payment_failed, and a redelivery changes nothing", async () => {
		if (kind === "software") seedSoftware();
		verify.mockResolvedValueOnce(
			make("payment_failed", "evt_failed", BASE + 60),
		);
		await POST(context());
		expect(read()).toEqual({ status: "payment_failed" });
		verify.mockResolvedValue(make("paid", "evt_paid", BASE));
		await POST(context());
		expect(read()).toEqual({ status: "paid" });
		await POST(context());
		expect(read()).toEqual({ status: "paid" });
		expect(
			sql.prepare("SELECT COUNT(*) AS total FROM stripe_webhook_events").get(),
		).toEqual({ total: 2 });
	});
});

// Concurrent delivery. The invoice.paid handler reads the invoice, then writes in one batch. A newer non-paid event for the
// same invoice can commit between the two. The paid event must still apply: the guard in its batch must not depend on the
// time the handler read. (What is guaranteed: a paid event applies to any invoice that is not paid when its batch runs.)

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString();

function commitBeforeNextBatch(run: () => void) {
	const original = db.batch.bind(db);

	db.batch = fakeBatch(async (statements) => {
		run();

		return original(statements);
	});
}

it("audio: an older paid event applies when a newer failure commits between its read and its batch", async () => {
	sql
		.prepare(
			"UPDATE audio_payments SET booking_status_updated_at=? WHERE request_id='request-1'",
		)
		.run(isoOf(BASE - 3600));
	commitBeforeNextBatch(() =>
		sql
			.prepare(
				"UPDATE audio_payments SET booking_status='payment_failed',booking_status_updated_at=? WHERE request_id='request-1'",
			)
			.run(isoOf(BASE)),
	);
	verify.mockResolvedValueOnce(audioEventAt("paid", "evt_paid", BASE - 60));
	expect((await POST(context())).status).toBe(200);
	expect(audioStatus()).toEqual({ status: "paid" });
	expect(
		sql
			.prepare(
				"SELECT COUNT(*) AS total FROM owner_request_audit WHERE action='booking-payment-updated'",
			)
			.get(),
	).toEqual({ total: 1 });
});

it("software: an older paid event applies when a newer failure commits between its read and its batch", async () => {
	seedSoftware();
	commitBeforeNextBatch(() =>
		sql
			.prepare(
				"UPDATE software_invoices SET status='payment_failed',status_updated_at=?,stripe_invoice_id='in_software'",
			)
			.run(isoOf(BASE)),
	);
	verify.mockResolvedValueOnce(softwareEventAt("paid", "evt_paid", BASE - 60));
	expect((await POST(context())).status).toBe(200);
	expect(softwareStatus()).toEqual({ status: "paid" });
});

it("audio recovery: an older paid event applies when a newer failure links the invoice first", async () => {
	sql
		.prepare(
			"UPDATE audio_payments SET booking_invoice_id=NULL,booking_invoice_url=NULL,booking_status='not_created'",
		)
		.run();
	commitBeforeNextBatch(() =>
		sql
			.prepare(
				"UPDATE audio_payments SET booking_invoice_id='in_booking',booking_status='payment_failed',booking_status_updated_at=?,booking_recovery_event_id='evt_failed'",
			)
			.run(isoOf(BASE)),
	);
	verify.mockResolvedValueOnce(audioEventAt("paid", "evt_paid", BASE - 60));
	expect((await POST(context())).status).toBe(200);
	expect(audioStatus()).toEqual({ status: "paid" });
});
