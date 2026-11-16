// Observe headers before the golden recorder normalizes SDK metadata. No network
// request escapes this fake; exercise the actual SDK's serialization and retry.
import type Stripe from "stripe";
import { expect, vi } from "vitest";
import { stripeClient } from "~/lib/stripe-invoicing";
import { partial } from "./doubles";
import { stripeFake } from "./stripe-fetch";

export async function verifyStripeRequestContract(
	run: (client: Stripe) => Promise<unknown>,
) {
	const fake = stripeFake();

	const calls: { path: string; version: string | null; key: string | null }[] =
		[];

	let refused = false;
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);
			expect(new URL(url).hostname).toBe("api.stripe.com");

			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined),
			);

			const path = new URL(url).pathname;
			calls.push({
				path,
				version: headers.get("stripe-version"),
				key: headers.get("idempotency-key"),
			});

			if (path === "/v1/invoices" && !refused) {
				refused = true;

				return Response.json(
					{ error: { type: "api_error", message: "retry test" } },
					{ status: 503, headers: { "stripe-should-retry": "true" } },
				);
			}

			return fake.fetch(input, init);
		},
	);

	try {
		await run(
			stripeClient(
				partial<Env>({
					STRIPE_PAYMENTS_ENABLED: "true",
					STRIPE_SECRET_KEY: "sk_test_contract",
					STRIPE_WEBHOOK_SECRET: "whsec_contract",
				}),
			),
		);
	} finally {
		vi.unstubAllGlobals();
	}

	expect(calls.map((call) => call.path)).toEqual([
		"/v1/customers",
		"/v1/invoices",
		"/v1/invoices",
		"/v1/invoiceitems",
		"/v1/invoices/in_fake/finalize",
		"/v1/invoices/in_fake/send",
	]);
	expect(calls.map((call) => call.version)).toEqual(
		Array(6).fill("2026-08-26.dahlia"),
	);
	expect(
		calls.every(
			(call) => call.key && !call.key.startsWith("stripe-node-retry-"),
		),
	).toBe(true);
	expect(calls[1].key).toBe(calls[2].key);
	expect(new Set(calls.map((call) => call.key)).size).toBe(5);
}
