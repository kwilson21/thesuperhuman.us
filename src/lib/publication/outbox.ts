import { parsePublication, type Publication, type Receipt } from './contract';
import { OutboxError, type Outbox } from './delivery';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
}

/** The private queue is in the same D1 database as the public journal. */
export class D1PublicationOutbox implements Outbox {
  constructor(private readonly db: D1Database) {}

  async prepare(input: Publication): Promise<{ publication: Publication; receipt: Receipt | null }> {
    const publication = parsePublication(input);
    if (!publication) throw new Error('Invalid envelope');
    const payload = canonical(publication);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const [, stored, withdrawn] = await this.db.batch([
      this.db.prepare(`INSERT INTO publication_outbox(project_id,event_id,entry_id,payload_hash,payload)
        SELECT ?1,?2,?3,?4,?5 WHERE NOT EXISTS
          (SELECT 1 FROM publication_events WHERE project_id=?1 AND entry_id=?3 AND operation='withdraw')
        ON CONFLICT(project_id,event_id) DO NOTHING`)
        .bind(publication.projectId, publication.eventId, publication.entryId, hash, payload),
      this.db.prepare('SELECT payload_hash,receipt FROM publication_outbox WHERE project_id=?1 AND event_id=?2')
        .bind(publication.projectId, publication.eventId),
      this.db.prepare("SELECT 1 FROM publication_events WHERE project_id=?1 AND entry_id=?2 AND operation='withdraw'")
        .bind(publication.projectId, publication.entryId),
    ]);
    const row = stored.results[0] as { payload_hash: string; receipt: string | null } | undefined;
    if (row && row.payload_hash !== hash) throw new OutboxError('conflict');
    if (withdrawn.results.length && publication.operation !== 'withdraw') throw new OutboxError('withdrawn');
    // An HTTP-origin withdrawal can be retried through MCP without retaining its envelope.
    if (!row && publication.operation !== 'withdraw') throw new Error('Queue unavailable');
    let receipt: Receipt | null = null;
    try { receipt = row?.receipt ? JSON.parse(row.receipt) : null; } catch { /* journal repairs it */ }
    return { publication, receipt };
  }

  async acknowledge(receipt: Receipt): Promise<void> {
    await this.db.batch([this.db.prepare(`UPDATE publication_outbox SET receipt=?3,payload=NULL
      WHERE project_id=?1 AND event_id=?2`).bind(receipt.projectId, receipt.eventId, JSON.stringify(receipt))]);
  }

  /** Authenticated callers only; never automatically replay a queue after a policy change. */
  async pending(projectId: string): Promise<Publication[]> {
    const [rows] = await this.db.batch([this.db.prepare(`SELECT payload FROM publication_outbox
      WHERE project_id=?1 AND payload IS NOT NULL AND receipt IS NULL ORDER BY CAST(json_extract(payload,'$.expectedRevision') AS INTEGER),event_id LIMIT 100`).bind(projectId)]);
    return rows.results.flatMap(row => {
      const value = parsePublication(JSON.parse((row as { payload: string }).payload));
      return value ? [value] : [];
    });
  }
}
