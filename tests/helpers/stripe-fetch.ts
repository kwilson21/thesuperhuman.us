// A fake Stripe API at the fetch boundary. The real Stripe SDK and the real stripe-invoicing code run; this answers the
// requests they send, the way the Stripe API does for the calls stripe-invoicing.ts makes, and records each one.
import { isText } from "~/lib/type-guards";
import {
	EffectLog,
	json,
	recordingFetch,
	type Responder,
} from "../golden/harness";

export type StripeFakeOptions = {
	/** The id each invoices.create call returns, in order. The last id repeats for later creates. */
	readonly invoiceIds?: readonly string[];
	/** Refuse invoice creation with a 400, which the SDK does not retry. */
	readonly refuseInvoices?: boolean;
};

/** One request the Stripe SDK made: its method, path, form-encoded body and Idempotency-Key header (null if none). */
export type StripeCall = {
	readonly method: string;
	readonly path: string;
	readonly form: URLSearchParams;
	readonly idempotencyKey: string | null;
};

const refused = json(400, {
	error: {
		type: "invalid_request_error",
		message: "Stripe unavailable",
	},
});

function stripeAnswers({
	invoiceIds = ["in_fake"],
	refuseInvoices = false,
}: StripeFakeOptions): Responder {
	let created = 0;

	return ({ url, method }) => {
		const { pathname } = new URL(url);
		const finalize = /^\/v1\/invoices\/([^/]+)\/finalize$/.exec(pathname);
		const send = /^\/v1\/invoices\/([^/]+)\/send$/.exec(pathname);

		if (method === "POST" && pathname === "/v1/customers")
			return json(200, { id: "cus_1", object: "customer" });

		if (method === "POST" && pathname === "/v1/invoices") {
			if (refuseInvoices) return refused;

			const id =
				invoiceIds[Math.min(created, invoiceIds.length - 1)] ?? "in_fake";

			created += 1;

			return json(200, { id, object: "invoice", status: "draft" });
		}

		if (method === "POST" && pathname === "/v1/invoiceitems")
			return json(200, { id: "ii_fake", object: "invoiceitem" });

		if (method === "POST" && finalize)
			return json(200, { id: finalize[1], object: "invoice", status: "open" });

		if (method === "POST" && send)
			return json(200, {
				id: send[1],
				object: "invoice",
				status: "open",
				hosted_invoice_url: `https://invoice.stripe.com/${send[1]}`,
			});

		return json(404, {
			error: {
				type: "invalid_request_error",
				message: `no fake answer for ${method} ${pathname}`,
			},
		});
	};
}

/**
 * A fetch to stub globally for the Stripe SDK, and the calls it makes. A request to any host other than api.stripe.com
 * throws, so a test cannot reach another service through it by accident.
 */
export function stripeFake(options: StripeFakeOptions = {}) {
	const log = new EffectLog();
	const answer = recordingFetch(stripeAnswers(options), log);

	return {
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : String(input);

			if (new URL(url).hostname !== "api.stripe.com")
				throw new Error(`stripe-fetch: no answer scripted for ${url}`);

			return answer(input, init);
		},
		calls: (): StripeCall[] =>
			log.entries.flatMap((entry) => {
				if (entry.kind !== "fetch") return [];

				const { body } = entry;
				const { pathname } = new URL(entry.url);

				return [
					{
						method: entry.method,
						path: pathname,
						form: new URLSearchParams(isText(body) ? body : ""),
						idempotencyKey: entry.headers["idempotency-key"] ?? null,
					},
				];
			}),
	};
}
