import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { APIContext } from "astro";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { double, partial } from "../helpers/doubles";
import type { TestRuntime } from "../helpers/runtime";
import { sqliteD1 } from "../helpers/sqlite-d1";
import type { JsonObject } from "../helpers/json";
import { stripeFake } from "../helpers/stripe-fetch";

import { POST } from "~/pages/api/owner/requests/[id]/payment";
import {
	applyOwnerRetention,
	previewOwnerRetention,
} from "../../scripts/owner-retention.mjs";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;
let stripe: ReturnType<typeof stripeFake>;

beforeEach(() => {
	sql = new DatabaseSync(":memory:");
	sql.exec(
		readFileSync(new URL("../../db/music.sql", import.meta.url), "utf8"),
	);
	sql.exec(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,status,created_at,updated_at)
    VALUES ('request-1','service','two-track-mix-master','Artist','artist@example.com','Old News mix','reviewed','2026-09-19T12:00:00Z','2026-09-19T12:00:00Z')`);

	db = sqliteD1(sql);
	stripe = stripeFake({ invoiceIds: ["in_booking", "in_replacement"] });
	vi.stubGlobal("fetch", stripe.fetch);
});

afterEach(() => {
	sql.close();
	vi.unstubAllGlobals();
});

const stripeEnv = {
	STRIPE_PAYMENTS_ENABLED: "true",
	STRIPE_SECRET_KEY: "sk_test_1",
	STRIPE_WEBHOOK_SECRET: "whsec_1",
};

function context(
	body: JsonObject,
	owner = true,
	env: Partial<Record<string, string>> = {},
): APIContext {
	return partial<APIContext>({
		params: { id: "request-1" },
		request: new Request(
			"https://thesuperhuman.us/api/owner/requests/request-1/payment",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		),
		locals: partial<APIContext["locals"]>({
			owner: owner ? { email: "owner@example.com" } : undefined,
			runtime: partial<TestRuntime>({
				env: partial<TestRuntime["env"]>({
					MUSIC_DB: db,
					...stripeEnv,
					...env,
				}),
			}),
		}),
	});
}

it("requires owner access and valid explicit offer acceptance", async () => {
	expect(
		(
			await POST(
				context(
					{
						action: "approve",
						approvedService: "Mix",
						totalAmountCents: 20_000,
						offerAccepted: true,
					},
					false,
				),
			)
		).status,
	).toBe(403);
	expect(
		(
			await POST(
				context({
					action: "approve",
					approvedService: "Mix",
					totalAmountCents: 20_000,
					offerAccepted: false,
				}),
			)
		).status,
	).toBe(400);
	expect(
		(
			await POST(
				context({
					action: "approve",
					approvedService: "Mix",
					totalAmountCents: 150.5,
					offerAccepted: true,
				}),
			)
		).status,
	).toBe(400);
	expect(
		(
			await POST(
				context({
					action: "approve",
					approvedService: "Mix",
					totalAmountCents: 1,
					offerAccepted: true,
				}),
			)
		).status,
	).toBe(400);
});

it("persists approved terms before any Stripe call", async () => {
	const response = await POST(
		context({
			action: "approve",
			approvedService: "Two-track vocal mix + master",
			totalAmountCents: 20_000,
			offerAccepted: true,
		}),
	);

	expect(response.status).toBe(200);
	expect(stripe.calls()).toEqual([]);
	expect(
		sql
			.prepare("SELECT total_amount_cents,booking_status FROM audio_payments")
			.get(),
	).toEqual({ total_amount_cents: 20_000, booking_status: "not_created" });
});

it("rejects changed terms after approval instead of reporting stale terms as saved", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mastering",
			totalAmountCents: 7_500,
			offerAccepted: true,
		}),
	);

	const response = await POST(
		context({
			action: "approve",
			approvedService: "Two-track vocal mix + master",
			totalAmountCents: 20_000,
			offerAccepted: true,
		}),
	);

	expect(response.status).toBe(409);
	expect(
		sql
			.prepare("SELECT approved_service,total_amount_cents FROM audio_payments")
			.get(),
	).toEqual({ approved_service: "Mastering", total_amount_cents: 7_500 });
});

it("creates and records one booking invoice after approval", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Two-track vocal mix + master",
			totalAmountCents: 20_000,
			offerAccepted: true,
		}),
	);

	const response = await POST(context({ action: "create-booking-invoice" }));

	expect(response.status).toBe(200);
	expect(
		stripe
			.calls()
			.find((call) => call.path === "/v1/customers")
			?.form.get("email"),
	).toBe("artist@example.com");
	expect(
		stripe
			.calls()
			.find((call) => call.path === "/v1/invoiceitems")
			?.form.get("amount"),
	).toBe("10000");
	expect(
		stripe.calls().find((call) => call.path === "/v1/invoices")?.idempotencyKey,
	).toBe("audio-request:request-1:booking:attempt-0:invoice");
	expect(
		sql
			.prepare("SELECT booking_invoice_id,booking_status FROM audio_payments")
			.get(),
	).toEqual({ booking_invoice_id: "in_booking", booking_status: "open" });
	await POST(context({ action: "create-booking-invoice" }));
	expect(
		stripe.calls().filter((call) => call.path === "/v1/invoices"),
	).toHaveLength(1);
});

it("does not create an invoice after retention deletes a withdrawn request", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mix",
			totalAmountCents: 20_000,
			offerAccepted: true,
		}),
	);
	sql.exec("UPDATE owner_requests SET status='withdrawn' WHERE id='request-1'");
	sql.exec(
		"UPDATE audio_projects SET revoked_at='2026-09-19',content_deleted_at='2026-09-20' WHERE request_id='request-1'",
	);

	const retentionDb = {
		query: async (query: string) => sql.prepare(query).all(),
		batch: async (queries: string[]) => {
			sql.exec("BEGIN");

			try {
				const result = queries.map((query) => sql.prepare(query).all());
				sql.exec("COMMIT");

				return result;
			} catch (error) {
				sql.exec("ROLLBACK");
				throw error;
			}
		},
	};

	const retentionNow = new Date();

	const review = await previewOwnerRetention(
		retentionDb,
		"Local test data",
		retentionNow,
	);

	const originalPrepare = db.prepare.bind(db);
	db.prepare = (query: string) => {
		const prepared = originalPrepare(query);

		if (
			!query.startsWith(
				"UPDATE audio_payments SET booking_creation_started_at=",
			)
		)
			return prepared;

		return double<D1PreparedStatement>({
			bind: (...args: unknown[]) => {
				const bound = prepared.bind(...args);

				return double<D1PreparedStatement>({
					run: async () => {
						await applyOwnerRetention(
							retentionDb,
							review,
							"Local test data",
							retentionNow,
						);

						return bound.run();
					},
				});
			},
		});
	};

	const response = await POST(context({ action: "create-booking-invoice" }));

	expect(response.status).toBe(409);
	expect(stripe.calls()).toEqual([]);
	expect(
		sql
			.prepare("SELECT name,email FROM owner_requests WHERE id=?")
			.get("request-1"),
	).toEqual({ name: "", email: "" });
});

it("does not create a balance invoice before Stripe confirms the booking payment", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Two-track vocal mix + master",
			totalAmountCents: 20_000,
			offerAccepted: true,
		}),
	);

	const response = await POST(context({ action: "create-balance-invoice" }));

	expect(response.status).toBe(409);
	expect(stripe.calls()).toEqual([]);
});

it("returns service unavailable without calling Stripe when invoice creation is disabled", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mastering",
			totalAmountCents: 7_500,
			offerAccepted: true,
		}),
	);

	const response = await POST(
		context({ action: "create-booking-invoice" }, true, {
			STRIPE_PAYMENTS_ENABLED: "false",
		}),
	);

	expect(response.status).toBe(503);
	expect(stripe.calls()).toEqual([]);
});

it("does not record invoice success when Stripe fails", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mastering",
			totalAmountCents: 7_500,
			offerAccepted: true,
		}),
	);
	stripe = stripeFake({ refuseInvoices: true });
	vi.stubGlobal("fetch", stripe.fetch);

	const response = await POST(context({ action: "create-booking-invoice" }));

	expect(response.status).toBe(502);
	expect(
		stripe.calls().filter((call) => call.path === "/v1/invoices"),
	).toHaveLength(1);
	expect(
		sql
			.prepare("SELECT booking_invoice_id,booking_status FROM audio_payments")
			.get(),
	).toEqual({ booking_invoice_id: null, booking_status: "not_created" });
	expect(
		sql.prepare("SELECT booking_creation_started_at FROM audio_payments").get()
			?.booking_creation_started_at,
	).toBeTruthy();
});

it("reports pending recovery when D1 fails after Stripe sends the invoice", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mastering",
			totalAmountCents: 7_500,
			offerAccepted: true,
		}),
	);
	const working = db;
	db = double<D1Database>({
		...working,
		batch: async () => {
			throw new Error("D1 unavailable");
		},
	});

	const response = await POST(context({ action: "create-booking-invoice" }));

	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({
		ok: false,
		recoveryPending: true,
	});
	expect(
		stripe.calls().filter((call) => call.path === "/v1/invoices"),
	).toHaveLength(1);
});

it("creates a replacement after a voided booking invoice", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mastering",
			totalAmountCents: 7_500,
			offerAccepted: true,
		}),
	);
	await POST(context({ action: "create-booking-invoice" }));
	sql
		.prepare(
			"UPDATE audio_payments SET booking_status='void' WHERE request_id='request-1'",
		)
		.run();

	const response = await POST(context({ action: "replace-booking-invoice" }));

	expect(response.status).toBe(200);

	const invoices = stripe
		.calls()
		.filter((call) => call.path === "/v1/invoices");

	expect(invoices).toHaveLength(2);
	// The replacement is a new attempt, so Stripe does not return the voided invoice for its key.
	expect(invoices.map((call) => call.idempotencyKey)).toEqual([
		"audio-request:request-1:booking:attempt-0:invoice",
		"audio-request:request-1:booking:attempt-1:invoice",
	]);
	expect(
		sql
			.prepare("SELECT booking_invoice_id,booking_status FROM audio_payments")
			.get(),
	).toEqual({ booking_invoice_id: "in_replacement", booking_status: "open" });
});

it("records a payment received outside Stripe with invoices off, and never calls Stripe for it", async () => {
	const received = {
		action: "record-payment-received",
		installment: "booking",
		method: "Zelle",
		received: true,
	};

	// Stripe is off for every request in this test: no payment provider keys and invoices disabled.
	const stripeOff = {
		STRIPE_PAYMENTS_ENABLED: "false",
		STRIPE_SECRET_KEY: "",
		STRIPE_WEBHOOK_SECRET: "",
	};

	const off = (body: JsonObject, owner = true) =>
		context(body, owner, stripeOff);

	expect((await POST(off(received))).status).toBe(409);
	await POST(
		off({
			action: "approve",
			approvedService: "Mix",
			totalAmountCents: 15_000,
			offerAccepted: true,
		}),
	);
	expect((await POST(off({ ...received, received: false }))).status).toBe(400);
	expect((await POST(off({ ...received, method: "Bitcoin" }))).status).toBe(
		400,
	);
	expect((await POST(off(received, false))).status).toBe(403);
	expect((await POST(off(received))).status).toBe(200);
	expect(
		sql
			.prepare("SELECT booking_status,booking_invoice_id FROM audio_payments")
			.get(),
	).toEqual({ booking_status: "paid", booking_invoice_id: null });
	// Stripe is configured again here, so the 409 comes from the paid booking and not from Stripe being off.
	expect(
		(await POST(context({ action: "create-booking-invoice" }))).status,
	).toBe(409);
	expect(stripe.calls()).toEqual([]);
});

it("records a payment received outside Stripe without a Stripe request while Stripe is configured", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mix",
			totalAmountCents: 15_000,
			offerAccepted: true,
		}),
	);

	expect(
		(
			await POST(
				context({
					action: "record-payment-received",
					installment: "booking",
					method: "Zelle",
					received: true,
				}),
			)
		).status,
	).toBe(200);
	expect(stripe.calls()).toEqual([]);
});

it("records the balance only after the booking and rejects a reference that is not a transaction ID", async () => {
	await POST(
		context({
			action: "approve",
			approvedService: "Mix",
			totalAmountCents: 15_000,
			offerAccepted: true,
		}),
	);

	const received = {
		action: "record-payment-received",
		method: "Cash App",
		received: true,
	};

	expect(
		(await POST(context({ ...received, installment: "balance" }))).status,
	).toBe(409);
	expect(
		(
			await POST(
				context({
					...received,
					installment: "booking",
					reference: "Jane (555) 123",
				}),
			)
		).status,
	).toBe(400);
	expect(
		(
			await POST(
				context({
					...received,
					installment: "booking",
					reference: "TX-4411/09",
				}),
			)
		).status,
	).toBe(200);
	expect(
		(await POST(context({ ...received, installment: "balance" }))).status,
	).toBe(200);
	expect(
		sql
			.prepare("SELECT booking_status,balance_status FROM audio_payments")
			.get(),
	).toEqual({ booking_status: "paid", balance_status: "paid" });
});
