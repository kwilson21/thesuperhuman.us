import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { D1PublicationJournal } from '~/lib/publication/journal';
import { D1PublicationOutbox } from '~/lib/publication/outbox';
import { deliver } from '~/lib/publication/delivery';
import type { Publication } from '~/lib/publication/contract';

// Native loading avoids older Vite versions treating node:sqlite as a package.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const base: Publication = { version: 1, projectId: 'threadline', eventId: 'one', entryId: 'first',
  expectedRevision: 0, operation: 'publish', origin: 'work', occurredOn: '2026-09-05',
  threadId: null, milestoneId: null, story: { headline: 'Return to work with context',
    summary: 'A clearer view of the work underway.', technicalDetail: null,
    delivery: 'implemented', basis: 'repository-verified' } };

// Execute the production SQL against SQLite, with the transaction guarantee D1 provides.
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0001_publication_journal.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../../migrations/0002_publication_outbox.sql', import.meta.url), 'utf8'));
  let fail = false;
  const db = {
    prepare: (query: string) => ({ bind: (...args: unknown[]) => ({ query, args }) }),
    batch: async (statements: { query: string; args: never[] }[]) => {
      sql.exec('BEGIN');
      try {
        const results = statements.map((s, i) => {
          if (fail && i === 1) throw new Error('interrupted');
          return { results: sql.prepare(s.query).all(...s.args) };
        });
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { journal: new D1PublicationJournal(db as unknown as D1Database), db: db as unknown as D1Database, sql,
    interrupt: () => { fail = true; } };
}

describe('durable publication delivery', () => {
  it('recovers pending work across instances and stores receipts without retaining prose', async () => {
    const { db, journal, sql } = fixture();
    const outbox = new D1PublicationOutbox(db);
    await outbox.prepare(base);
    expect(await new D1PublicationOutbox(db).pending('threadline')).toEqual([base]);
    expect(await outbox.pending('other')).toEqual([]);
    const ports = { outbox, journal, mayPublish: async () => true };
    const first = await deliver(base, ports);
    expect(first.status).toBe('delivered');
    expect(await deliver(base, ports)).toEqual(first);
    expect(await outbox.pending('threadline')).toEqual([]);
    expect(sql.prepare('SELECT payload FROM publication_outbox').get().payload).toBeNull();
    expect((await deliver({ ...base, occurredOn: '2026-09-04' }, ports)).status).toBe('conflict');
  });
  it('repairs a lost acknowledgement with the original journal receipt', async () => {
    const { db, journal } = fixture();
    const outbox = new D1PublicationOutbox(db);
    await outbox.prepare(base);
    const accepted = await journal.commit(base);
    const result = await deliver(base, { outbox, journal, mayPublish: async () => true });
    expect(result).toEqual({ status: 'delivered', receipt: 'receipt' in accepted ? accepted.receipt : null });
  });
  it('redacts pending and delivered entry content even when withdrawal bypasses MCP', async () => {
    const { db, journal, sql } = fixture();
    const outbox = new D1PublicationOutbox(db);
    const ports = { outbox, journal, mayPublish: async () => true };
    await deliver(base, ports);
    await outbox.prepare({ ...base, eventId: 'pending-fix', operation: 'correct', expectedRevision: 1 });
    const withdrawal: Publication = { ...base, eventId: 'remove', operation: 'withdraw', story: null, expectedRevision: 1 };
    await journal.commit(withdrawal);
    expect(sql.prepare('SELECT COUNT(*) n FROM publication_outbox WHERE payload IS NOT NULL').get().n).toBe(0);
    expect((await deliver(base, ports)).status).toBe('withdrawn');
    expect((await deliver(withdrawal, ports)).status).toBe('delivered');
    expect(await outbox.pending('threadline')).toEqual([]);
  });
  it('holds queued work when current audience policy denies publication', async () => {
    const { db, journal } = fixture();
    const outbox = new D1PublicationOutbox(db);
    expect((await deliver(base, { outbox, journal, mayPublish: async () => false })).status).toBe('held');
    expect(await outbox.pending('threadline')).toEqual([base]);
  });
});
