import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changeOwnerRequest, getOwnerRequest, listOwnerRequests, saveOwnerRequest } from '~/lib/owner-requests';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function fixture(beforeSoftware = false) {
  const sql = new DatabaseSync(':memory:');
  if (beforeSoftware) {
    for (const name of readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(name => name.endsWith('.sql') && name < '0019').sort())
      sql.exec(readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8'));
  } else sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({
    query, args,
    bind: (...values: unknown[]) => statement(query, values),
    run: async () => {
      const result = sql.prepare(query).run(...args);
      return { success: true, meta: { changes: result.changes }, results: [] };
    },
    all: async () => ({ success: true, results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = {
    prepare: (query: string) => statement(query),
    batch: async (statements: ReturnType<typeof statement>[]) => {
      sql.exec('BEGIN');
      try {
        const results = statements.map(item => {
          const prepared = sql.prepare(item.query);
          if (/\bRETURNING\b/i.test(item.query)) return { success: true, results: prepared.all(...item.args) };
          const result = prepared.run(...item.args);
          return { success: true, meta: { changes: result.changes }, results: [] };
        });
        sql.exec('COMMIT');
        return results;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sql };
}

const purchase = {
  kind: 'purchase' as const,
  releaseId: 'old-news-single',
  email: 'fan@example.com',
  cityRegion: 'Nashville, Tennessee',
  summary: 'Interested in buying Old News',
  details: { format: 'digital' },
};

describe('owner requests', () => {
  it('stores a request and its creation audit atomically', async () => {
    const { db, sql } = fixture();
    const request = await saveOwnerRequest(db, purchase);
    expect(request).toMatchObject({ kind: 'purchase', status: 'new', email: 'fan@example.com' });
    expect(await getOwnerRequest(db, request.id)).toEqual(request);
    expect(sql.prepare('SELECT action,actor FROM owner_request_audit WHERE request_id=?').get(request.id))
      .toEqual({ action: 'created', actor: 'system' });
  });

  it('applies only defined status transitions and records the owner actor', async () => {
    const { db, sql } = fixture();
    const request = await saveOwnerRequest(db, purchase);
    expect((await changeOwnerRequest(db, { id: request.id, action: 'review', actor: 'owner@example.com' })).status).toBe('reviewed');
    expect((await changeOwnerRequest(db, { id: request.id, action: 'resolve', actor: 'owner@example.com' })).status).toBe('resolved');
    await expect(changeOwnerRequest(db, { id: request.id, action: 'review', actor: 'owner@example.com' }))
      .rejects.toThrow('Invalid request transition');
    expect((await changeOwnerRequest(db, { id: request.id, action: 'reopen', actor: 'owner@example.com' })).status).toBe('new');
    expect(sql.prepare('SELECT action FROM owner_request_audit WHERE request_id=? ORDER BY id').all(request.id))
      .toEqual([{ action: 'created' }, { action: 'reviewed' }, { action: 'resolved' }, { action: 'reopened' }]);
  });

  it('updates bounded private notes without changing status and filters the inbox', async () => {
    const { db } = fixture();
    const purchaseRequest = await saveOwnerRequest(db, purchase);
    await saveOwnerRequest(db, { ...purchase, kind: 'service', serviceId: 'mastering', email: 'artist@example.com', summary: 'Mastering review' });
    const updated = await changeOwnerRequest(db, { id: purchaseRequest.id, action: 'note', actor: 'owner@example.com', note: 'Reply after listening.' });
    expect(updated).toMatchObject({ status: 'new', privateNote: 'Reply after listening.' });
    expect(await listOwnerRequests(db, { kind: 'purchase', status: 'new' })).toHaveLength(1);
    await expect(changeOwnerRequest(db, { id: purchaseRequest.id, action: 'note', actor: 'owner@example.com', note: 'x'.repeat(1001) }))
      .rejects.toThrow('Private note');
  });
});

it('saves a service request before software migration 0019', async () => {
  const { db, sql } = fixture(true);
  const request = await saveOwnerRequest(db, { kind: 'service', serviceId: 'mixing', email: 'CLIENT@EXAMPLE.COM', summary: 'Audio inquiry' });
  expect(request.email).toBe('client@example.com');
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_requests').get()).toEqual({ n: 1 });
});
