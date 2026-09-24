import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completeClientCode, issueClientCode, revokeClientSession } from '~/lib/audio-client-access';
import {
  clientMessageRateLimited, latestReviewDecision, revisionRoundsLeft, listProjectMessages, markProjectMessagesRead, postClientProjectMessage,
  postClientReviewDecision, postOwnerProjectMessage, validateProjectMessage,
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
    await markProjectMessagesRead(db, 'song-1', 'owner', first!.id, null, now);
    expect((await listProjectMessages(db, 'song-1'))[0].read_at).toBe(now.toISOString());
    await markProjectMessagesRead(db, 'song-1', 'client', reply!.id, token, now);
    expect((await listProjectMessages(db, 'song-1'))[1].read_at).toBe(now.toISOString());
    await revokeClientSession(db, token, now);
    expect(await postClientProjectMessage(db, 'song-1', token, 'After revocation.', now)).toBeNull();
    sql.close();
  });

  it('takes one answer per published review and starts over when a new review is shared', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const token = (await completeClientCode(db, 'artist@example.com', code, secret, now))!;
    const publish = (id: string, at: string) => sql.prepare(`INSERT INTO audio_project_files
      (id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at)
      VALUES (?,'song-1','review',?,'Mix.wav','audio/wav',10,'published',?,?)`).run(id, `key-${id}`, at, at);
    // No answer before a review is shared, even at the right stage.
    sql.prepare("UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-1'").run();
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-1', 'approved', 'I approve this mix.', now)).toBeNull();
    publish('review-1', '2026-09-22T11:00:00.000Z');
    expect(await latestReviewDecision(db, 'song-1')).toBeNull();
    const changes = await postClientReviewDecision(db, 'song-1', token, 'review-1', 'changes', 'Vocal up in verse two.', now);
    expect(changes).toMatchObject({ actor: 'client', body: 'Vocal up in verse two.', review_decision: 'changes' });
    expect(await latestReviewDecision(db, 'song-1')).toBe('changes');
    // One answer per review.
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-1', 'approved', 'I approve this mix.', now)).toBeNull();
    // Not while the revision is under way.
    sql.prepare("UPDATE audio_projects SET stage='revision_in_progress' WHERE request_id='song-1'").run();
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-1', 'approved', 'I approve this mix.', now)).toBeNull();
    // A new review clears the old answer and takes a fresh one.
    sql.prepare("UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-1'").run();
    publish('review-2', '2026-09-22T13:00:00.000Z');
    expect(await latestReviewDecision(db, 'song-1')).toBeNull();
    const later = new Date('2026-09-22T14:00:00.000Z');
    // A page still showing the old review cannot answer the new one.
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-1', 'approved', 'I approve this mix.', later)).toBeNull();
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-2', 'approved', 'I approve this mix.', later)).toMatchObject({ review_decision: 'approved' });
    expect(await latestReviewDecision(db, 'song-1')).toBe('approved');
    expect((await listProjectMessages(db, 'song-1')).map(message => message.review_decision)).toEqual(['changes', 'approved']);
    sql.close();
  });

  it('allows changes only while revision rounds remain, and stopping only once they are used', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const token = (await completeClientCode(db, 'artist@example.com', code, secret, now))!;
    sql.prepare("UPDATE audio_projects SET stage='review_ready' WHERE request_id='song-1'").run();
    sql.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,status,uploaded_at,published_at)
      VALUES ('review-3','song-1','review','key-3','Mix.wav','audio/wav',10,'published',?,?)`).run('2026-09-22T11:00:00.000Z', '2026-09-22T11:00:00.000Z');
    expect(await revisionRoundsLeft(db, 'song-1')).toBe(2);
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-3', 'stopped', 'Stop.', now)).toBeNull();
    for (const at of ['2026-09-20T12:00:00.000Z', '2026-09-21T12:00:00.000Z']) {
      sql.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,milestone)
        VALUES ('song-1','progress','Revising.','owner@example.com',?,'revision_started')`).run(at);
    }
    expect(await revisionRoundsLeft(db, 'song-1')).toBe(0);
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-3', 'changes', 'One more pass.', now)).toBeNull();
    expect(await postClientReviewDecision(db, 'song-1', token, 'review-3', 'stopped', 'I’m stopping the project here.', now)).toMatchObject({ review_decision: 'stopped' });
    // Stopping closes this project in the same write, but leaves the client signed in for others.
    expect(sql.prepare("SELECT revoked_at FROM audio_projects WHERE request_id='song-1'").get()).toEqual({ revoked_at: now.toISOString() });
    expect(sql.prepare("SELECT actor FROM audio_project_audit WHERE request_id='song-1' AND action='revoked'").get()).toEqual({ actor: 'client-stopped' });
    expect(sql.prepare('SELECT COUNT(*) AS open FROM audio_client_sessions WHERE revoked_at IS NULL').get()).toEqual({ open: 1 });
    expect(await latestReviewDecision(db, 'song-1')).toBe('stopped');
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

  it('marks only the message the reader actually reached', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const token = (await completeClientCode(db, 'artist@example.com', code, secret, now))!;
    const first = (await postClientProjectMessage(db, 'song-1', token, 'First note.', now))!;
    const second = (await postClientProjectMessage(db, 'song-1', token, 'Second note.', now))!;
    await markProjectMessagesRead(db, 'song-1', 'owner', first.id, null, now);
    expect((await listProjectMessages(db, 'song-1')).map(message => message.read_at))
      .toEqual([now.toISOString(), null]);
    await markProjectMessagesRead(db, 'song-1', 'owner', second.id, null, now);
    expect((await listProjectMessages(db, 'song-1')).map(message => message.read_at))
      .toEqual([now.toISOString(), now.toISOString()]);
    sql.close();
  });

  it('counts saved client messages within the rolling five-minute window', async () => {
    const { sql, db, addRequest } = fixture();
    addRequest('song-1');
    const code = (await issueClientCode(db, 'artist@example.com', secret, now))!;
    const token = (await completeClientCode(db, 'artist@example.com', code, secret, now))!;
    const sends = await Promise.all(Array.from({ length: 13 }, (_, index) =>
      postClientProjectMessage(db, 'song-1', token, `Note ${index}`, now)));
    expect(sends.filter(Boolean)).toHaveLength(12);
    expect(sql.prepare("SELECT count(*) AS n FROM audio_project_messages WHERE request_id='song-1'").get()).toEqual({ n: 12 });
    const secondCode = (await issueClientCode(db, 'artist@example.com', secret, new Date(now.getTime() + 31_000)))!;
    const secondToken = (await completeClientCode(db, 'artist@example.com', secondCode, secret, new Date(now.getTime() + 31_000)))!;
    expect(await clientMessageRateLimited(db, 'song-1', new Date(now.getTime() + 31_000))).toBe(true);
    expect(await postClientProjectMessage(db, 'song-1', secondToken, 'New session', new Date(now.getTime() + 31_000))).toBeNull();
    expect(await postClientProjectMessage(db, 'song-1', token, 'Later note', new Date(now.getTime() + 300_001))).not.toBeNull();
    sql.close();
  });
});
