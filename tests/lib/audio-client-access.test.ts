import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clientProjectForSession, clientProjectsForSession, completeClientCode,
  discardUndeliveredCode, issueClientCode, listStudioSignInFailures, normalizeClientEmail, revokeClientSession, takeStudioAllowance,
} from '~/lib/audio-client-access';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const secret = 'studio-code-key-for-tests-32-characters';
const now = new Date('2026-09-22T12:00:00.000Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(baseline);
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
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  const addRequest = (id: string, email = 'artist@example.com') => sql.prepare(`INSERT INTO owner_requests
    (id,kind,email,summary,status,created_at,updated_at)
    VALUES (?,'service',?,'A song','new',?,?)`).run(id, email, now.toISOString(), now.toISOString());
  return { sql, db, addRequest };
}

describe('audio client access', () => {
  it('normalizes email without stripping plus addressing', () => {
    expect(normalizeClientEmail('  Artist+mix@Example.com ')).toBe('artist+mix@example.com');
    expect(normalizeClientEmail('not an email')).toBeNull();
  });

  it('issues only to project members and stores a hash rather than the code', async () => {
    const { sql, db, addRequest } = fixture();
    expect(await issueClientCode(db, 'unknown@example.com', secret, now)).toBeNull();
    addRequest('song-1');
    const code = await issueClientCode(db, 'artist@example.com', secret, now);
    expect(code).toMatch(/^\d{8}$/);
    const stored = sql.prepare("SELECT code_hash FROM audio_client_codes WHERE email='artist@example.com'").get() as { code_hash: string };
    expect(stored.code_hash).not.toBe(code);
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sql.prepare('SELECT action FROM audio_client_access_audit').all()).toEqual([{ action: 'code-issued' }]);
    sql.close();
  });

  it('requires the current unused code and confines a session to its email projects', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    addRequest('song-2');
    addRequest('other-song', 'other@example.com');
    const oldCode = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    expect(await issueClientCode(db, 'artist@example.com', secret, now)).toBeNull();
    const afterCooldown = new Date(now.getTime() + 31_000);
    const code = (await issueClientCode(db, 'artist@example.com', secret, afterCooldown))!;
    if (oldCode !== code) expect(await completeClientCode(db, 'artist@example.com', oldCode, secret, now)).toBeNull();
    const token = await completeClientCode(db, 'artist@example.com', code, secret, afterCooldown);
    expect(token).toBeTruthy();
    expect(await completeClientCode(db, 'artist@example.com', code, secret, now)).toBeNull();
    expect((await clientProjectsForSession(db, token!, now))?.map(project => project.request_id)).toEqual(['song-1', 'song-2']);
    expect(await clientProjectForSession(db, token!, 'song-1', now)).toMatchObject({ request_id: 'song-1' });
    expect(await clientProjectForSession(db, token!, 'other-song', now)).toBeNull();
    expect(await clientProjectForSession(db, token!, 'song-1', new Date('2026-10-10T12:00:00Z'))).toBeNull();
    sql.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='song-1'").run();
    expect(await clientProjectForSession(db, token!, 'song-1', now)).toBeNull();
    expect(await clientProjectForSession(db, token!, 'song-2', now)).not.toBeNull();
    await revokeClientSession(db, token!, now);
    expect(await clientProjectForSession(db, token!, 'song-2', now)).toBeNull();
    sql.close();
  });

  it('locks a code after five wrong guesses, even when they arrive together', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const wrong = code === '00000000' ? '11111111' : '00000000';
    const guesses = await Promise.all(Array.from({ length: 10 }, () => completeClientCode(db, 'artist@example.com', wrong, secret, now)));
    expect(guesses.every(token => token === null)).toBe(true);
    expect(sql.prepare("SELECT attempts FROM audio_client_codes WHERE email='artist@example.com'").get()).toEqual({ attempts: 5 });
    expect(await completeClientCode(db, 'artist@example.com', code, secret, now)).toBeNull();
    sql.close();
  });

  it('admits exactly the allowance when requests arrive together, then opens a new window', async () => {
    const { sql, db } = fixture();
    const results = await Promise.all(Array.from({ length: 20 }, () => takeStudioAllowance(db, 'code-email', 'artist@example.com', 3, secret, now)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await takeStudioAllowance(db, 'code-email', 'other@example.com', 3, secret, now)).toBe(true);
    expect(await takeStudioAllowance(db, 'code-email', 'artist@example.com', 3, secret, new Date(now.getTime() + 5 * 60_000 + 1))).toBe(true);
    const stored = sql.prepare('SELECT key FROM audio_client_allowances').all() as { key: string }[];
    expect(stored.every(row => !row.key.includes('artist'))).toBe(true);
    sql.close();
  });

  it('keeps a correct code usable after wrong attempts and rejects expired or undelivered codes', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await completeClientCode(db, 'artist@example.com', wrong, secret, now)).toBeNull();
    }
    expect(await completeClientCode(db, 'artist@example.com', code, secret, now)).toBeTruthy();
    const newer = (await issueClientCode(db, 'artist@example.com', secret, new Date(now.getTime() + 31_000)))!;
    expect(await completeClientCode(db, 'artist@example.com', newer, secret, new Date('2026-09-22T12:11:00Z'))).toBeNull();
    const undelivered = (await issueClientCode(db, 'artist@example.com', secret, new Date('2026-09-22T12:12:00Z')))!;
    await discardUndeliveredCode(db, 'artist@example.com', undelivered, secret, now);
    expect(await completeClientCode(db, 'artist@example.com', undelivered, secret, now)).toBeNull();
    expect(sql.prepare('SELECT action FROM audio_client_access_audit ORDER BY id DESC LIMIT 1').get())
      .toEqual({ action: 'code-delivery-failed' });
    sql.close();
  });

  it('surfaces failed delivery until the client signs in', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const undelivered = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    await discardUndeliveredCode(db, 'artist@example.com', undelivered, secret, now);
    expect(await listStudioSignInFailures(db)).toEqual([{ requestId: 'song-1', clientName: '' }]);
    sql.prepare(`INSERT INTO audio_client_access_audit(request_id,action,occurred_at)
      VALUES ('song-1','signed-in',?)`).run(now.toISOString());
    expect(await listStudioSignInFailures(db)).toEqual([]);
    sql.close();
  });
});
