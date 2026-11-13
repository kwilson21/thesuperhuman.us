// Row builders with the defaults a corpus would otherwise each invent: an owner request, the software offer, link,
// project and invoice that hang off it, and a signed agreement with the template and client it needs. Each takes the
// columns a case cares about and fills the rest with fixed values. Timestamps are on the frozen clock's day.
import type { SeedRow } from "./db";

const EARLIER = "2026-11-13T11:00:00.000Z";

export const ownerRequest = (id: string, over: SeedRow = {}): SeedRow => ({
	id,
	kind: "service",
	name: "Grace Hopper",
	email: "grace@example.test",
	summary: "A request",
	status: "new",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

export const softwareRequest = (id: string, over: SeedRow = {}): SeedRow =>
	ownerRequest(id, { kind: "software", summary: "Build a tool", ...over });

export const softwareOffer = (
	id: string,
	requestId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	version: 1,
	status: "sent",
	terms_json: "{}",
	created_at: EARLIER,
	updated_at: EARLIER,
	sent_at: EARLIER,
	sent_by: "owner@example.test",
	...over,
});

export const offerLink = (requestId: string, over: SeedRow = {}): SeedRow => ({
	request_id: requestId,
	token_hash: `hash-${requestId}`,
	created_at: EARLIER,
	...over,
});

export const softwareProject = (
	requestId: string,
	offerId: string,
	over: SeedRow = {},
): SeedRow => ({
	request_id: requestId,
	offer_id: offerId,
	terms_json: "{}",
	payment_mode: "standard",
	signatures_recorded_at: EARLIER,
	first_payment_recorded_at: EARLIER,
	started_at: EARLIER,
	started_by: "owner@example.test",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

export const softwareInvoice = (
	id: string,
	requestId: string,
	offerId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	request_id: requestId,
	offer_id: offerId,
	milestone_index: 0,
	kind: "deposit",
	amount_cents: 50_000,
	days_until_due: 7,
	status: "open",
	created_by: "owner@example.test",
	created_at: EARLIER,
	updated_at: EARLIER,
	...over,
});

const SHA = "0".repeat(64);

/** The template and client every agreement points at. Seed these once, before any agreement. */
export const agreementBase = () => ({
	software_agreement_templates: [
		{
			id: "template-msa",
			kind: "msa",
			version: 1,
			text: "MSA",
			sha256: SHA,
			published_at: EARLIER,
			published_by: "owner@example.test",
		},
	],
	software_agreement_clients: [
		{
			id: "client-1",
			recipient_email: "grace@example.test",
			legal_name: "Grace Hopper LLC",
			legal_name_key: "grace hopper llc",
			entity_type: "llc",
			jurisdiction: "VA",
			business_address: "1 Main St",
			notice_email: "grace@example.test",
			created_at: EARLIER,
		},
	],
});

export const agreement = (
	id: string,
	requestId: string,
	offerId: string,
	over: SeedRow = {},
): SeedRow => ({
	id,
	kind: "msa",
	offer_id: offerId,
	request_id: requestId,
	client_id: "client-1",
	template_id: "template-msa",
	status: "client_signed",
	canonical_text: "MSA",
	text_sha256: SHA,
	values_json: "{}",
	created_at: EARLIER,
	effective_on: "2026-11-13",
	review_session_hash: "review-hash",
	...over,
});
