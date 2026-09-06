import { canonicalPublication } from './canonical';
import { parsePublication, type Publication, type PublicationJournal, type CommitResult } from './contract';

/** D1 batch is a transaction. No acceptance decision relies on a prior read. */
export class D1PublicationJournal implements PublicationJournal {
  constructor(private readonly db: D1Database) {}

  async commit(input: Publication): Promise<CommitResult> {
    const p = parsePublication(input);
    if (!p || p.expectedRevision === Number.MAX_SAFE_INTEGER) return { status: 'rejected' };
    const payload = canonicalPublication(p);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const statements = [
      this.db.prepare(`INSERT INTO publication_events
        (project_id,event_id,entry_id,revision,operation,origin,payload_hash,payload)
        SELECT ?1,?2,?3,?4+1,?5,?6,?7,?8
        WHERE ?4 = (SELECT COALESCE(MAX(revision),0) FROM publication_events WHERE project_id=?1)
          AND NOT EXISTS (SELECT 1 FROM publication_events WHERE project_id=?1 AND event_id=?2)
          AND NOT EXISTS (SELECT 1 FROM publication_events WHERE project_id=?1 AND entry_id=?3 AND operation='withdraw')
          AND (?5='withdraw' OR
            (?5='publish' AND NOT EXISTS (SELECT 1 FROM publication_events WHERE project_id=?1 AND entry_id=?3)) OR
            (?5='correct' AND EXISTS (SELECT 1 FROM publication_events WHERE project_id=?1 AND entry_id=?3)))
        RETURNING revision`).bind(p.projectId, p.eventId, p.entryId, p.expectedRevision,
          p.operation, p.origin, hash, payload),
      // Only a matching, accepted withdrawal can erase content. Hashes preserve retry identity.
      this.db.prepare(`UPDATE publication_events SET payload=NULL
        WHERE project_id=?1 AND entry_id=?2 AND EXISTS
          (SELECT 1 FROM publication_events WHERE project_id=?1 AND event_id=?3
            AND payload_hash=?4 AND operation='withdraw')`)
        .bind(p.projectId, p.entryId, p.eventId, hash),
      this.db.prepare(`SELECT revision,published_at,payload_hash FROM publication_events
        WHERE project_id=?1 AND event_id=?2`).bind(p.projectId, p.eventId),
      this.db.prepare(`SELECT 1 FROM publication_events
        WHERE project_id=?1 AND entry_id=?2 AND operation='withdraw'`).bind(p.projectId, p.entryId),
    ];
    const [insert, , receipt, tombstone] = await this.db.batch(statements);
    const row = receipt.results[0] as { revision: number; published_at: string; payload_hash: string } | undefined;
    if (row && row.payload_hash !== hash) return { status: 'conflict' };
    if (tombstone.results.length && p.operation !== 'withdraw') return { status: 'withdrawn' };
    if (!row) return { status: tombstone.results.length ? 'withdrawn' : 'conflict' };
    return { status: insert.results.length ? 'accepted' : 'duplicate', receipt: {
      projectId: p.projectId, eventId: p.eventId, revision: row.revision, publishedAt: row.published_at,
    } };
  }
}
