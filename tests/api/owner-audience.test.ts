import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { POST } from '~/pages/api/owner/audience';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

it('withdraws permission and preserves a timestamped actor audit', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_audience_permissions(email,status,consent_version,granted_at,updated_at)
    VALUES ('fan@example.com','subscribed','release-updates-v1','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`);
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values) });
  const db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try { const results = items.map(item => ({ results: [], meta: sql.prepare(item.query).run(...item.args) })); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const response = await POST({
    request: new Request('https://thesuperhuman.us/api/owner/audience', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'withdraw', email: 'fan@example.com' }) }),
    locals: { owner: { email: 'owner@example.com' }, runtime: { env: { MUSIC_DB: db } } },
  } as any);
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT status,withdrawn_at FROM owner_audience_permissions').get()).toMatchObject({ status: 'unsubscribed' });
  expect(sql.prepare('SELECT action,actor FROM owner_audience_audit').get()).toEqual({ action: 'withdrawn', actor: 'owner@example.com' });
});
