import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completeClientCode, issueClientCode, revokeClientSession } from '~/lib/audio-client-access';
import {
  listProjectMessages, markProjectMessagesRead, postClientProjectMessage,
  postOwnerProjectMessage, validateProjectMessage,
} from '~/lib/audio-project-messages';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const secret = 'studio-code-key-for-tests-32-characters';
const now = new Date('2026-09-22T12:00:00Z');

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
  function addRequest(id: string, email = 'artist@example.com') {
    sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
      VALUES (?,'service',?,'A song','new',?,?)`).run(id, email, now.toISOString(), now.toISOString());
  }
  return { sql, db, addRequest };
}

describe('audio project messages', () => {
  it('accepts plain language and HTTPS shared links, but rejects unsafe or oversized input', () => {
    expect(validateProjectMessage('  Make the hook feel more open.  ')).toBe('Make the hook feel more open.');
    expect(validateProjectMessage('Updated files: https://drive.google.com/file/example')).toContain('https://');
    expect(validateProjectMessage('http://example.com/file')).toBeNull();
    expect(validateProjectMessage('www.example.com/file')).toBeNull();
    expect(validateProjectMessage('https://user:pass@example.com/file')).toBeNull();
    expect(validateProjectMessage('x'.repeat(4001))).toBeNull();
  });

  it('keeps both sides in one thread and limits writes to the correct active client', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    addRequest('other-song', 'other@example.com');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const token = (await completeClientCode(db, 'artist@example.com', code, secret, now))!;
    const first = await postClientProjectMessage(db, 'song-1', token, 'I updated the Drive link.', now);
    expect(first).toMatchObject({ actor: 'client', body: 'I updated the Drive link.' });
    expect(await postClientProjectMessage(db, 'other-song', token, 'Not my song.', now)).toBeNull();
    const reply = await postOwnerProjectMessage(db, 'song-1', 'owner@example.com', 'Thanks, I have it.', now);
    expect(reply).toMatchObject({ actor: 'owner', body: 'Thanks, I have it.' });
    expect((await listProjectMessages(db, 'song-1')).map(message => message.body)).toEqual(['I updated the Drive link.', 'Thanks, I have it.']);
    await markProjectMessagesRead(db, 'song-1', 'owner', null, now);
    expect((await listProjectMessages(db, 'song-1'))[0].read_at).toBe(now.toISOString());
    await markProjectMessagesRead(db, 'song-1', 'client', token, now);
    expect((await listProjectMessages(db, 'song-1'))[1].read_at).toBe(now.toISOString());
    await revokeClientSession(db, token, now);
    expect(await postClientProjectMessage(db, 'song-1', token, 'After revocation.', now)).toBeNull();
    sql.close();
  });

  it('closes replies when a project completes or a request is withdrawn', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    sql.prepare("UPDATE audio_projects SET stage='complete' WHERE request_id='song-1'").run();
    expect(await postOwnerProjectMessage(db, 'song-1', 'owner@example.com', 'Too late.', now)).toBeNull();
    sql.prepare("UPDATE audio_projects SET stage='files_under_review' WHERE request_id='song-1'").run();
    sql.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='song-1'").run();
    expect(await postOwnerProjectMessage(db, 'song-1', 'owner@example.com', 'Withdrawn.', now)).toBeNull();
    sql.close();
  });
});
