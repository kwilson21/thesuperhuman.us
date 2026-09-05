export const WORK_FEED_KEY = 'work-feed:current';

export const WORK_FEED_STATUSES = ['active', 'paused', 'revised'] as const;

export type WorkFeedStatus = (typeof WORK_FEED_STATUSES)[number];

export interface WorkFeedLink {
  label: string;
  url: string;
}

export interface PublicWorkUpdate {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  headline: string;
  summary: string;
  status: WorkFeedStatus;
  revision: number;
  updatedAt: string;
  links: WorkFeedLink[];
}

export type WorkFeedValidation =
  | { ok: true; value: PublicWorkUpdate }
  | { ok: false; error: string };

const UPDATE_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'projectName',
  'headline',
  'summary',
  'status',
  'revision',
  'updatedAt',
  'links',
]);
const LINK_KEYS = new Set(['label', 'url']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validatePublicWorkUpdate(value: unknown): WorkFeedValidation {
  if (!isRecord(value) || !hasOnlyKeys(value, UPDATE_KEYS)) {
    return { ok: false, error: 'Update contains unsupported fields.' };
  }
  if (value.schemaVersion !== 1) {
    return { ok: false, error: 'Unsupported schema version.' };
  }
  if (
    typeof value.projectId !== 'string'
    || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value.projectId)
  ) {
    return { ok: false, error: 'Invalid project ID.' };
  }
  if (!boundedString(value.projectName, 80)) {
    return { ok: false, error: 'Invalid project name.' };
  }
  if (!boundedString(value.headline, 140)) {
    return { ok: false, error: 'Invalid headline.' };
  }
  if (!boundedString(value.summary, 500)) {
    return { ok: false, error: 'Invalid summary.' };
  }
  if (!WORK_FEED_STATUSES.includes(value.status as WorkFeedStatus)) {
    return { ok: false, error: 'Invalid status.' };
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    return { ok: false, error: 'Invalid revision.' };
  }
  if (
    typeof value.updatedAt !== 'string'
    || value.updatedAt.length > 40
    || !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return { ok: false, error: 'Invalid update timestamp.' };
  }
  if (!Array.isArray(value.links) || value.links.length > 5) {
    return { ok: false, error: 'Invalid links.' };
  }
  const links: WorkFeedLink[] = [];
  for (const link of value.links) {
    if (
      !isRecord(link)
      || !hasOnlyKeys(link, LINK_KEYS)
      || !boundedString(link.label, 40)
      || !isSafeHttpsUrl(link.url)
    ) {
      return { ok: false, error: 'Invalid link.' };
    }
    links.push({ label: link.label, url: link.url });
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      projectId: value.projectId,
      projectName: value.projectName,
      headline: value.headline,
      summary: value.summary,
      status: value.status as WorkFeedStatus,
      revision: value.revision as number,
      updatedAt: value.updatedAt,
      links,
    },
  };
}

export function parseStoredWorkUpdate(value: string | null): PublicWorkUpdate | null {
  if (!value) return null;
  try {
    const validation = validatePublicWorkUpdate(JSON.parse(value));
    return validation.ok ? validation.value : null;
  } catch {
    return null;
  }
}

export function allowedWorkFeedProjects(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
}

export async function secretsMatch(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
