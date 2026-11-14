import { expect, it } from "vitest";
import { stripeFake } from "./stripe-fetch";

it("answers the Stripe calls an invoice makes, in order, and records them", async () => {
	const stripe = stripeFake({ invoiceIds: ["in_one", "in_two"] });

	const first = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
		body: "customer=cus_1",
	});

	const second = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
		body: "customer=cus_1",
	});

	expect(await first.json()).toMatchObject({ id: "in_one" });
	expect(await second.json()).toMatchObject({ id: "in_two" });
	expect(
		stripe
			.calls()
			.map((call) => [call.method, call.path, call.form.get("customer")]),
	).toEqual([
		["POST", "/v1/invoices", "cus_1"],
		["POST", "/v1/invoices", "cus_1"],
	]);
});

it("refuses invoice creation with a 400 when asked to", async () => {
	const stripe = stripeFake({ refuseInvoices: true });

	const refused = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
	});

	expect(refused.status).toBe(400);
	expect(await refused.json()).toMatchObject({
		error: { type: "invalid_request_error" },
	});
});

it("refuses only the first invoice creations when asked to, then answers", async () => {
	const stripe = stripeFake({
		invoiceIds: ["in_retry"],
		refuseFirstInvoices: 1,
	});

	const refused = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
	});

	const answered = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
	});

	expect(refused.status).toBe(400);
	expect(await answered.json()).toMatchObject({ id: "in_retry" });
});

it("gives the sent invoice the due date it was asked to carry", async () => {
	const stripe = stripeFake({ dueDate: "2026-10-07T12:00:00Z" });

	const sent = await stripe.fetch(
		"https://api.stripe.com/v1/invoices/in_fake/send",
		{ method: "POST" },
	);

	expect(await sent.json()).toMatchObject({
		due_date: Date.parse("2026-10-07T12:00:00Z") / 1000,
	});
});

it("answers invoice creation with the named error body, and marks it not retryable when asked", async () => {
	const stripe = stripeFake({
		invoiceFailure: {
			status: 402,
			type: "card_error",
			message: "Card declined",
			retry: false,
		},
	});

	const failed = await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
	});

	expect(failed.status).toBe(402);
	expect(failed.headers.get("stripe-should-retry")).toBe("false");
	expect(await failed.json()).toEqual({
		error: { type: "card_error", message: "Card declined" },
	});
});

it("drops the connection on invoice creation when asked to", async () => {
	const stripe = stripeFake({ invoiceFailure: "connection" });

	await expect(
		stripe.fetch("https://api.stripe.com/v1/invoices", { method: "POST" }),
	).rejects.toThrow("socket hang up");
});

it("answers the send call with a draft that has no hosted URL when asked to", async () => {
	const stripe = stripeFake({
		unusableSend: true,
		dueDate: "2026-10-07T12:00:00Z",
	});

	const sent = await stripe.fetch(
		"https://api.stripe.com/v1/invoices/in_fake/send",
		{ method: "POST" },
	);

	const body = await sent.json();

	expect(body).toMatchObject({ status: "draft" });
	expect(body).not.toHaveProperty("hosted_invoice_url");
	expect(body).not.toHaveProperty("due_date");
});

it("records the Idempotency-Key header of each request", async () => {
	const stripe = stripeFake();

	await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
		headers: {
			"Idempotency-Key": "audio-request:one:booking:attempt-0:invoice",
		},
		body: "customer=cus_1",
	});
	await stripe.fetch("https://api.stripe.com/v1/invoices", {
		method: "POST",
		body: "customer=cus_1",
	});

	expect(stripe.calls().map((call) => call.idempotencyKey)).toEqual([
		"audio-request:one:booking:attempt-0:invoice",
		null,
	]);
});

it("refuses any request to a host other than api.stripe.com", async () => {
	const stripe = stripeFake();

	await expect(
		stripe.fetch("https://example.com/v1/invoices", { method: "POST" }),
	).rejects.toThrow("no answer scripted");
	expect(stripe.calls()).toEqual([]);
});
