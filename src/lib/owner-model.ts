import type { RawValue } from "./fields";
import type { JsonValue } from "./json-value";
import { safeHttpsUrl } from "./link-check";

export const ownerRequestKinds = [
	"purchase",
	"merchandise",
	"service",
	"software",
] as const;

export const ownerRequestStatuses = [
	"new",
	"reviewed",
	"resolved",
	"withdrawn",
] as const;

export type OwnerRequestKind = (typeof ownerRequestKinds)[number];

export type OwnerRequestStatus = (typeof ownerRequestStatuses)[number];

/** A request's submitted details: a JSON object whose values are JSON values, or absent. */
export type RequestDetails = { [name: string]: JsonValue | undefined };

export function safeExternalUrl(value: RawValue) {
	return safeHttpsUrl(value);
}

export type OwnerRequest = {
	id: string;
	kind: OwnerRequestKind;
	releaseId: string | null;
	serviceId: string | null;
	campaignId: string | null;
	name: string;
	email: string;
	cityRegion: string;
	summary: string;
	details: RequestDetails;
	status: OwnerRequestStatus;
	privateNote: string;
	createdAt: string;
	updatedAt: string;
	resolvedAt: string | null;
	contactDeleteAfter: string | null;
};

export type OwnerRequestRow = {
	id: string;
	kind: OwnerRequestKind;
	release_id: string | null;
	service_id: string | null;
	campaign_id: string | null;
	name: string;
	email: string;
	city_region: string;
	summary: string;
	details_json: string;
	status: OwnerRequestStatus;
	private_note: string;
	created_at: string;
	updated_at: string;
	resolved_at: string | null;
	contact_delete_after: string | null;
};

export function ownerRequestFromRow(row: OwnerRequestRow): OwnerRequest {
	// SAFETY: details_json only ever holds a JSON object. createOwnerRequest (owner-requests.ts) stores JSON.stringify of a
	// RequestDetails object or "{}", music-demand.ts stores a JSON object or "{}", software-brief-copy.ts only json_set's
	// keys on it, and scripts/owner-retention.mjs sets it to '{}' (the column default is '{}' too). So the parsed value is an
	// object, and every value in it is a JSON value (or absent).
	const details = JSON.parse(row.details_json) as RequestDetails;

	return {
		id: row.id,
		kind: row.kind,
		releaseId: row.release_id,
		serviceId: row.service_id,
		campaignId: row.campaign_id,
		name: row.name,
		email: row.email,
		cityRegion: row.city_region,
		summary: row.summary,
		details,
		status: row.status,
		privateNote: row.private_note,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		resolvedAt: row.resolved_at,
		contactDeleteAfter: row.contact_delete_after,
	};
}
