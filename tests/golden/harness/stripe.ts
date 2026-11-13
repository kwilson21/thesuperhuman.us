// A signed Stripe webhook request, built the way Stripe signs it, so the route's real signature check runs.
import { createHmac } from "node:crypto";
import { START } from "./determinism";

/**
 * The `stripe-signature` header value for `payload`: `t=<seconds>,v1=<hmac>`. `at` defaults to the frozen clock's start, so a
 * case passes Stripe's five-minute tolerance and a case can pass an older one to fail it.
 */
export function signStripeWebhook(
	payload: string,
	secret: string,
	at: number = Date.parse(START) / 1000,
): string {
	const signature = createHmac("sha256", secret)
		.update(`${at}.${payload}`)
		.digest("hex");

	return `t=${at},v1=${signature}`;
}
