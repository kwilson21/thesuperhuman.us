import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { D1PublicationJournal } from '~/lib/publication/journal';
import { readProject } from '~/lib/publication/read';
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

describe('transactional publication journal', () => {
  it('keeps old backfill out of current focus and clears withdrawn current work', async () => {
    const { journal, db } = fixture();
    expect(await readProject(db, 'threadline')).toEqual({ projectId: 'threadline', revision: 0, current: null, history: [] });
    await journal.commit(base);
    await journal.commit({ ...base, entryId: 'past', eventId: 'past', origin: 'backfill',
      occurredOn: '2026-09-01', expectedRevision: 1 });
    const feed = await readProject(db, 'threadline');
    expect(feed.current?.entryId).toBe('first');
    expect(feed.history.map(e => e.entryId)).toEqual(['first', 'past']);
    expect(feed.history[1].backfilled).toBe(true);
    await journal.commit({ ...base, operation: 'withdraw', story: null, eventId: 'remove', expectedRevision: 2 });
    expect((await readProject(db, 'threadline')).current).toBeNull();
    expect((await readProject(db, 'threadline')).history.map(e => e.entryId)).toEqual(['past']);
  });
  it('applies corrections without moving focus and prevents backfill corrections changing current', async () => {
    const { journal, db } = fixture(); await journal.commit(base);
    await journal.commit({ ...base, entryId: 'next', eventId: 'next', expectedRevision: 1 });
    await journal.commit({ ...base, operation: 'correct', eventId: 'fix', expectedRevision: 2 });
    expect((await readProject(db, 'threadline')).current?.entryId).toBe('next');
    await journal.commit({ ...base, entryId: 'next', operation: 'correct', eventId: 'historical-fix',
      origin: 'backfill', expectedRevision: 3, story: { ...base.story!, headline: 'Historical correction' } });
    expect((await readProject(db, 'threadline')).current?.story.headline).toBe(base.story?.headline);
    expect((await readProject(db, 'other')).history).toEqual([]);
  });
  it('allows one winner for competing expected revisions and isolates projects', async () => {
    const { journal } = fixture();
    const results = await Promise.all([journal.commit(base),
      journal.commit({ ...base, eventId: 'two', entryId: 'second' })]);
    expect(results.map(r => r.status).sort()).toEqual(['accepted', 'conflict']);
    expect((await journal.commit({ ...base, projectId: 'other' })).status).toBe('accepted');
  });
  it('returns the same receipt for reordered exact retries but conflicts on changed content', async () => {
    const { journal } = fixture(); const first = await journal.commit(base);
    expect(await journal.commit(Object.fromEntries(Object.entries(base).reverse()) as Publication))
      .toEqual({ ...first, status: 'duplicate' });
    expect((await journal.commit({ ...base, occurredOn: '2026-09-04' })).status).toBe('conflict');
  });
  it('redacts all entry content and prevents live or historical resurrection', async () => {
    const { journal, sql } = fixture(); await journal.commit(base);
    const withdrawal: Publication = { ...base, eventId: 'remove', expectedRevision: 1,
      operation: 'withdraw', story: null };
    const receipt = await journal.commit(withdrawal);
    expect(receipt.status).toBe('accepted');
    expect(await journal.commit(withdrawal)).toEqual({ ...receipt, status: 'duplicate' });
    expect((await journal.commit(base)).status).toBe('withdrawn');
    expect((await journal.commit({ ...base, eventId: 'backfill', origin: 'backfill', expectedRevision: 2 })).status)
      .toBe('withdrawn');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM publication_events WHERE payload IS NOT NULL').get()?.n).toBe(0);
  });
  it('tombstones unseen entries and rejects corrections without a target', async () => {
    const { journal } = fixture();
    expect((await journal.commit({ ...base, operation: 'correct' })).status).toBe('conflict');
    expect((await journal.commit({ ...base, operation: 'withdraw', story: null })).status).toBe('accepted');
    expect((await journal.commit({ ...base, eventId: 'later', expectedRevision: 1 })).status).toBe('withdrawn');
  });
  it('preserves history metadata for backfill and correction without duplicating an entry', async () => {
    const { journal, sql } = fixture(); await journal.commit(base);
    expect((await journal.commit({ ...base, eventId: 'repeat', expectedRevision: 1 })).status).toBe('conflict');
    expect((await journal.commit({ ...base, eventId: 'fix', operation: 'correct', expectedRevision: 1 })).status).toBe('accepted');
    expect((await journal.commit({ ...base, eventId: 'past', entryId: 'past', origin: 'backfill',
      occurredOn: '2026-09-01', expectedRevision: 2 })).status).toBe('accepted');
    expect(sql.prepare('SELECT revision,origin FROM publication_events ORDER BY revision').all())
      .toEqual([{ revision: 1, origin: 'work' }, { revision: 2, origin: 'work' }, { revision: 3, origin: 'backfill' }]);
  });
  it('rolls back acceptance if a later transaction statement fails', async () => {
    const { journal, sql, interrupt } = fixture(); interrupt();
    await expect(journal.commit(base)).rejects.toThrow('interrupted');
    expect(sql.prepare('SELECT COUNT(*) AS n FROM publication_events').get()?.n).toBe(0);
  });
});
