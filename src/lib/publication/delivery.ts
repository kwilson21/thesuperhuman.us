import { parsePublication, type Publication, type PublicationJournal, type Receipt } from './contract';

/** Private durable storage. Both operations must be atomic and project-scoped. */
export interface Outbox {
  /** Persist before network I/O; an existing event must never be overwritten. */
  prepare(value: Publication): Promise<{ publication: Publication; receipt: Receipt | null }>;
  /** Persist a validated server receipt. Repeating the same acknowledgement is safe. */
  acknowledge(receipt: Receipt): Promise<void>;
}

export interface DeliveryPorts {
  outbox: Outbox;
  journal: PublicationJournal;
  /** Must check the current audience policy on each attempt, not only initial preparation. */
  mayPublish(publication: Publication): Promise<boolean>;
}

export type DeliveryResult =
  | { status: 'delivered'; receipt: Receipt }
  | { status: 'invalid' | 'held' | 'conflict' | 'withdrawn' | 'rejected' | 'pending' };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map(key => JSON.stringify(key) + ':' + canonical(obj[key])).join(',') + '}';
}

function validReceipt(receipt: Receipt, publication: Publication): boolean {
  return receipt !== null && typeof receipt === 'object'
    && receipt.projectId === publication.projectId && receipt.eventId === publication.eventId
    && Number.isSafeInteger(receipt.revision) && receipt.revision > publication.expectedRevision
    && typeof receipt.publishedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.publishedAt)
    && Number.isFinite(Date.parse(receipt.publishedAt))
    && new Date(receipt.publishedAt).toISOString() === receipt.publishedAt;
}

/**
 * Called by existing work/shutdown protocol boundaries; this starts no timers.
 * Transport failures return pending so project handoff can finish normally.
 * Retry the unchanged envelope. Conflicts require fresh canonical-state reconciliation.
 * A delivery receipt confirms ingestion, not that a reader saw the website render.
 */
export async function deliver(input: unknown, ports: DeliveryPorts): Promise<DeliveryResult> {
  const publication = parsePublication(input);
  if (!publication) return { status: 'invalid' };
  try {
    const prepared = await ports.outbox.prepare(publication);
    const stored = parsePublication(prepared.publication);
    if (!stored || canonical(stored) !== canonical(publication)) return { status: 'conflict' };
    // A successful old receipt is not permission to bypass a newly restrictive policy.
    if (!await ports.mayPublish(parsePublication(stored)!)) return { status: 'held' };
    if (prepared.receipt) {
      return validReceipt(prepared.receipt, stored)
        ? { status: 'delivered', receipt: prepared.receipt } : { status: 'pending' };
    }
    const result = await ports.journal.commit(stored);
    if (result.status === 'conflict' || result.status === 'withdrawn' || result.status === 'rejected') {
      return { status: result.status };
    }
    if ((result.status !== 'accepted' && result.status !== 'duplicate')
      || !validReceipt(result.receipt, stored)) return { status: 'pending' };
    await ports.outbox.acknowledge(result.receipt);
    return { status: 'delivered', receipt: result.receipt };
  } catch {
    // No exception text or source details may leak to a public error response.
    return { status: 'pending' };
  }
}
