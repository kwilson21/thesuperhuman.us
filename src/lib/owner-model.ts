export const ownerRequestKinds = ['purchase', 'merchandise', 'service'] as const;
export const ownerRequestStatuses = ['new', 'reviewed', 'resolved', 'withdrawn'] as const;

export type OwnerRequestKind = typeof ownerRequestKinds[number];
export type OwnerRequestStatus = typeof ownerRequestStatuses[number];

export function safeExternalUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
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
  details: Record<string, unknown>;
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
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    status: row.status,
    privateNote: row.private_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    contactDeleteAfter: row.contact_delete_after,
  };
}
