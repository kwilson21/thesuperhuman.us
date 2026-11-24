import Stripe from "stripe";
import type { AudioPayment, Installment } from "./audio-payments";

// SDK upgrades must not silently migrate the invoice API contract. This is the
// version used by Stripe 22.6.2 before the SDK 23 upgrade. RequestOptions supports
// an explicit version string without suppressing the SDK's types. Our adapters
// use only the request/response fields shared by these versions; migration to
// Endive requires separate sandbox and webhook-version verification.
export const STRIPE_INVOICE_API_VERSION = "2026-08-26.dahlia";

export type StripeInvoiceOptions = {
	idempotencyKey: string;
	apiVersion: typeof STRIPE_INVOICE_API_VERSION;
};

export const stripeInvoiceOptions = (
	idempotencyKey: string,
): StripeInvoiceOptions => ({
	idempotencyKey,
	apiVersion: STRIPE_INVOICE_API_VERSION,
});

type InvoiceResult = {
	id: string;
	status?: string | null;
	hosted_invoice_url?: string | null;
};

type StripeInvoicingClient = {
	customers: {
		create(
			params: Stripe.CustomerCreateParams,
			options: StripeInvoiceOptions,
		): Promise<{ id: string }>;
	};
	invoices: {
		create(
			params: Stripe.InvoiceCreateParams,
			options: StripeInvoiceOptions,
		): Promise<{ id: string }>;
		finalizeInvoice(
			id: string,
			params: Stripe.InvoiceFinalizeInvoiceParams,
			options: StripeInvoiceOptions,
		): Promise<InvoiceResult>;
		sendInvoice(
			id: string,
			params: Stripe.InvoiceSendInvoiceParams,
			options: StripeInvoiceOptions,
		): Promise<InvoiceResult>;
	};
	invoiceItems: {
		create(
			params: Stripe.InvoiceItemCreateParams,
			options: StripeInvoiceOptions,
		): Promise<{ id: string }>;
	};
};

type InvoiceRequest = { name: string; email: string; summary: string };

export type CreatedStripeInvoice = {
	stripeCustomerId: string;
	invoiceId: string;
	hostedInvoiceUrl: string;
	status: "open";
};

/** A Stripe call the site could not complete, or an answer from Stripe the site cannot use. */
export class StripeProviderError extends Error {}

/**
 * True when Stripe refused, could not be reached, or answered unusably: an SDK error by its type, or this module's
 * provider error. A conflict the site raises itself is not one of these.
 */
export function isStripeProviderFailure(error: Error): boolean {
	return (
		error instanceof StripeProviderError ||
		error instanceof Stripe.errors.StripeError
	);
}

export function stripeAvailable(env: Env): boolean {
	return env.STRIPE_PAYMENTS_ENABLED === "true" && stripeWebhookAvailable(env);
}

export function stripeWebhookAvailable(env: Env): boolean {
	return Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET);
}

export function stripeClient(env: Env, invoiceCreation = true): Stripe {
	if (invoiceCreation ? !stripeAvailable(env) : !stripeWebhookAvailable(env)) {
		throw invoiceCreation
			? new StripeProviderError("Stripe invoice creation is unavailable.")
			: new Error("Stripe webhooks are unavailable.");
	}

	return new Stripe(env.STRIPE_SECRET_KEY!, {
		httpClient: Stripe.createFetchHttpClient(),
	});
}

export async function createInvoiceWithClient(
	stripe: StripeInvoicingClient,
	request: InvoiceRequest,
	payment: AudioPayment,
	installment: Installment,
): Promise<CreatedStripeInvoice> {
	const customerKey = `audio-request:${payment.requestId}`;

	const attempt =
		installment === "booking"
			? payment.bookingAttemptCount
			: payment.balanceAttemptCount;

	const rootKey = `${customerKey}:${installment}:attempt-${attempt}`;

	const customerId =
		payment.stripeCustomerId ??
		(
			await stripe.customers.create(
				{
					email: request.email,
					name: request.name || undefined,
					metadata: { audio_request_id: payment.requestId },
				},
				stripeInvoiceOptions(`${customerKey}:customer`),
			)
		).id;

	const invoice = await stripe.invoices.create(
		{
			customer: customerId,
			collection_method: "send_invoice",
			days_until_due: 7,
			auto_advance: false,
			description: `${request.summary} · Audio services by Kazon`,
			metadata: { audio_request_id: payment.requestId, installment },
		},
		stripeInvoiceOptions(`${rootKey}:invoice`),
	);

	const booking = installment === "booking";
	await stripe.invoiceItems.create(
		{
			customer: customerId,
			invoice: invoice.id,
			amount: booking ? payment.bookingAmountCents : payment.balanceAmountCents,
			currency: payment.currency,
			description: `Audio services by Kazon · ${payment.approvedService} · ${booking ? "50% booking payment" : "remaining balance"}`,
			metadata: { audio_request_id: payment.requestId, installment },
		},
		stripeInvoiceOptions(`${rootKey}:item`),
	);
	await stripe.invoices.finalizeInvoice(
		invoice.id,
		{},
		stripeInvoiceOptions(`${rootKey}:finalize`),
	);

	const sent = await stripe.invoices.sendInvoice(
		invoice.id,
		{},
		stripeInvoiceOptions(`${rootKey}:send`),
	);

	if (
		sent.status !== "open" ||
		!sent.hosted_invoice_url?.startsWith("https://")
	) {
		throw new StripeProviderError(
			"Stripe did not return a hosted payment URL.",
		);
	}

	return {
		stripeCustomerId: customerId,
		invoiceId: sent.id,
		hostedInvoiceUrl: sent.hosted_invoice_url,
		status: "open",
	};
}

export async function createBookingInvoice(
	env: Env,
	request: InvoiceRequest,
	payment: AudioPayment,
) {
	return createInvoiceWithClient(
		stripeClient(env),
		request,
		payment,
		"booking",
	);
}

export async function createBalanceInvoice(
	env: Env,
	request: InvoiceRequest,
	payment: AudioPayment,
) {
	return createInvoiceWithClient(
		stripeClient(env),
		request,
		payment,
		"balance",
	);
}

export async function verifyStripeWebhook(
	env: Env,
	rawBody: string,
	signature: string,
): Promise<Stripe.Event> {
	return stripeClient(env, false).webhooks.constructEventAsync(
		rawBody,
		signature,
		env.STRIPE_WEBHOOK_SECRET!,
		undefined,
		Stripe.createSubtleCryptoProvider(),
	);
}
