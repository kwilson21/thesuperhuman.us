import type { APIRoute } from "astro";
import type Stripe from "stripe";
import {
	applyStripeInvoiceEvent,
	getAudioPayment,
	isKnownInvoiceAttempt,
	recordUnmatchedStripeEvent,
	recoverInvoiceFromWebhook,
	type Installment,
	type InvoiceStatus,
} from "~/lib/audio-payments";
import { applySoftwareInvoiceEvent } from "~/lib/software-invoices";
import { verifyStripeWebhook } from "~/lib/stripe-invoicing";

export const prerender = false;

const eventStatuses: Partial<
	Record<Stripe.Event.Type, Exclude<InvoiceStatus, "not_created" | "draft">>
> = {
	"invoice.sent": "open",
	"invoice.paid": "paid",
	"invoice.payment_failed": "payment_failed",
	"invoice.voided": "void",
	"invoice.marked_uncollectible": "uncollectible",
};

// The five invoice events that eventStatuses maps; each carries a Stripe.Invoice as data.object.
type InvoiceEvent =
	| Stripe.InvoiceSentEvent
	| Stripe.InvoicePaidEvent
	| Stripe.InvoicePaymentFailedEvent
	| Stripe.InvoiceVoidedEvent
	| Stripe.InvoiceMarkedUncollectibleEvent;

function isInvoiceEvent(event: Stripe.Event): event is InvoiceEvent {
	return (
		event.type === "invoice.sent" ||
		event.type === "invoice.paid" ||
		event.type === "invoice.payment_failed" ||
		event.type === "invoice.voided" ||
		event.type === "invoice.marked_uncollectible"
	);
}

function isInstallment(value: string | undefined): value is Installment {
	return value === "booking" || value === "balance";
}

/** The Stripe invoice id stored on the row for this installment, or null when none is linked. */
function invoiceIdOf(
	payment: Awaited<ReturnType<typeof getAudioPayment>>,
	installment: Installment,
): string | null {
	if (!payment) return null;

	return installment === "booking"
		? payment.bookingInvoiceId
		: payment.balanceInvoiceId;
}

function isCustomerId(
	customer: Stripe.Invoice["customer"],
): customer is string {
	return typeof customer === "string";
}

export const POST: APIRoute = async ({ request, locals }) => {
	const signature = request.headers.get("stripe-signature");

	if (!signature) return Response.json({ received: false }, { status: 400 });
	const db = locals.runtime.env.MUSIC_DB;

	if (!db) return Response.json({ received: false }, { status: 503 });
	const rawBody = await request.text();
	let event: Awaited<ReturnType<typeof verifyStripeWebhook>>;

	try {
		event = await verifyStripeWebhook(locals.runtime.env, rawBody, signature);
	} catch {
		return Response.json({ received: false }, { status: 400 });
	}

	const status = eventStatuses[event.type];

	if (!status || !isInvoiceEvent(event))
		return Response.json({ received: true });
	const invoice = event.data.object;

	if (
		!invoice.metadata?.audio_request_id &&
		invoice.metadata?.software_request_id &&
		invoice.id
	) {
		try {
			await applySoftwareInvoiceEvent(db, {
				eventId: event.id,
				eventType: event.type,
				invoiceId: invoice.id,
				requestId: invoice.metadata.software_request_id,
				localId: invoice.metadata.software_invoice_id ?? "",
				offerId: invoice.metadata.software_offer_id ?? "",
				milestone: invoice.metadata.milestone_index ?? "",
				kind: invoice.metadata.kind ?? "",
				status,
				occurredAt: new Date(event.created * 1000).toISOString(),
				total: invoice.total ?? -1,
				currency: invoice.currency ?? "",
				customerId: isCustomerId(invoice.customer)
					? invoice.customer
					: (invoice.customer?.id ?? null),
				hostedUrl: invoice.hosted_invoice_url ?? null,
				dueAt: invoice.due_date
					? new Date(invoice.due_date * 1000).toISOString()
					: null,
			});

			return Response.json({ received: true });
		} catch {
			return Response.json({ received: false }, { status: 500 });
		}
	}

	const requestId = invoice.metadata?.audio_request_id;
	const installment = invoice.metadata?.installment;

	if (!invoice.id || !requestId || !isInstallment(installment)) {
		return Response.json({ received: true });
	}

	const linkedInvoiceId = invoiceIdOf(
		await getAudioPayment(db, requestId),
		installment,
	);

	if (linkedInvoiceId !== invoice.id) {
		if (await isKnownInvoiceAttempt(db, invoice.id)) {
			// An attempt row is written in the same batch that links its invoice, so the row is read again: the invoice may
			// have been linked since the first read. Only a different linked id is a conflict.
			const linkedNow = invoiceIdOf(
				await getAudioPayment(db, requestId),
				installment,
			);

			if (linkedNow !== invoice.id) {
				await recordUnmatchedStripeEvent(db, {
					eventId: event.id,
					eventType: event.type,
					invoiceId: invoice.id,
					requestId,
					installment: installment,
					status,
					occurredAt: new Date(event.created * 1000).toISOString(),
					reason: "invoice-conflict",
				});

				return Response.json({ received: true });
			}
		} else {
			const customerId = isCustomerId(invoice.customer)
				? invoice.customer
				: (invoice.customer?.id ?? null);

			const recovery = await recoverInvoiceFromWebhook(db, {
				eventId: event.id,
				eventType: event.type,
				requestId,
				installment: installment,
				invoiceId: invoice.id,
				stripeCustomerId: customerId,
				hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
				status,
				occurredAt: new Date(event.created * 1000).toISOString(),
				totalAmountCents: invoice.total ?? -1,
				currency: invoice.currency ?? "",
			});

			// "current": the invoice was linked since the first read, so the event is applied below like any other.
			if (recovery !== "current") return Response.json({ received: true });
		}
	}

	try {
		await applyStripeInvoiceEvent(db, {
			eventId: event.id,
			eventType: event.type,
			invoiceId: invoice.id,
			status,
			occurredAt: new Date(event.created * 1000).toISOString(),
		});

		return Response.json({ received: true });
	} catch {
		return Response.json({ received: false }, { status: 500 });
	}
};
