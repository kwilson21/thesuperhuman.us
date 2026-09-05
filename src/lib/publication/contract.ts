/** Public transport only. Audience review happens before constructing this envelope. */
export interface Story {
  headline: string;
  summary: string;
  technicalDetail: string | null;
  delivery: 'proposed' | 'implemented' | 'tested' | 'available';
  basis: 'agent-reported' | 'repository-verified' | 'human-confirmed';
}

interface PublicationBase {
  version: 1;
  projectId: string;
  eventId: string;
  entryId: string;
  expectedRevision: number;
  origin: 'work' | 'shutdown' | 'backfill';
  occurredOn: string;
  threadId: string | null;
  milestoneId: string | null;
}

export type Publication = PublicationBase & (
  | { operation: 'publish' | 'correct'; story: Story }
  | { operation: 'withdraw'; story: null }
);

export interface Receipt {
  projectId: string;
  eventId: string;
  revision: number;
  publishedAt: string;
}

export type CommitResult =
  | { status: 'accepted' | 'duplicate'; receipt: Receipt }
  | { status: 'conflict' | 'withdrawn' | 'rejected' };

/**
 * Implementations MUST make deduplication, expectedRevision comparison, history,
 * current-view changes and the receipt one atomic per-project operation.
 * A KV get/check/put implementation does not satisfy this port.
 * Event IDs are opaque source-outcome identities shared by backfill and live work.
 * Duplicate IDs with different payloads are conflicts, never successful retries.
 * Withdrawals tombstone entryId and erase served content; replay cannot restore it.
 * Backfill records history without changing current state; timestamps never order writes.
 * The receiver assigns receipt time/revision; the caller cannot claim acceptance.
 */
export interface PublicationJournal {
  commit(publication: Publication): Promise<CommitResult>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function day(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Strict shape validation, NOT content sanitization or publication permission. */
export function parsePublication(value: unknown): Publication | null {
  if (!record(value) || !exact(value, [
    'version', 'projectId', 'eventId', 'entryId', 'expectedRevision', 'operation',
    'origin', 'occurredOn', 'threadId', 'milestoneId', 'story',
  ])) return null;
  if (value.version !== 1 || !id(value.projectId) || !id(value.eventId)
    || !id(value.entryId) || !Number.isSafeInteger(value.expectedRevision)
    || (value.expectedRevision as number) < 0 || !day(value.occurredOn)
    || (value.threadId !== null && !id(value.threadId))
    || (value.milestoneId !== null && !id(value.milestoneId))
    || !['publish', 'correct', 'withdraw'].includes(value.operation as string)
    || !['work', 'shutdown', 'backfill'].includes(value.origin as string)) return null;
  const story = value.story;
  if (value.operation === 'withdraw') {
    if (story !== null) return null;
  } else {
    if (!record(story) || !exact(story, ['headline', 'summary', 'technicalDetail', 'delivery', 'basis'])
      || !text(story.headline, 140) || !text(story.summary, 1000)
      || (story.technicalDetail !== null && !text(story.technicalDetail, 4000))
      || !['proposed', 'implemented', 'tested', 'available'].includes(story.delivery as string)
      || !['agent-reported', 'repository-verified', 'human-confirmed'].includes(story.basis as string)) return null;
  }
  // Detach from the caller so later mutations cannot change a prepared delivery.
  return JSON.parse(JSON.stringify(value)) as Publication;
}
