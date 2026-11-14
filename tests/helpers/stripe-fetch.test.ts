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
