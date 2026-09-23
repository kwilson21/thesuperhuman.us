import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAudioMessage } from '~/lib/audio-resend';
import {
  deliverProjectUpdateNotice, listProjectUpdates, queueProjectNoticeForDelivery,
  saveProjectUpdate, validProjectDate,
} from '~/lib/audio-project-updates';

vi.mock('~/lib/audio-resend', () => ({ sendAudioMessage: vi.fn(async () => ({ ok: true })) }));
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const now = new Date('2026-09-22T12:00:00Z');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(baseline);
  const statement = (query: string, args: unknown[] = []) => ({
    query, args, bind: (...values: unknown[]) => statement(query, values),
    run: async () => ({ results: [], meta: { changes: sql.prepare(query).run(...args).changes } }),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try {
      const results = items.map(item => ({ results: /\bRETURNING\b/i.test(item.query) ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) }));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','new',?,?)`).run(now.toISOString(), now.toISOString());
  return { sql, db };
}

beforeEach(() => vi.clearAllMocks());

describe('project updates', () => {
  it('accepts a reviewed project, starts paid work, and records a later date with its reason', async () => {
    const { sql, db } = fixture();
    expect(validProjectDate('2026-02-30')).toBe(false);
    expect(await saveProjectUpdate(db, 'song-1', 'owner@example.com', { action: 'accept', dueDate: '2026-10-01', body: 'I have your song.' }, now)).toBeNull();
    sql.prepare("UPDATE owner_requests SET status='reviewed' WHERE id='song-1'").run();
    const accepted = await saveProjectUpdate(db, 'song-1', 'owner@example.com', { action: 'accept', dueDate: '2026-10-01', body: 'I have your song.' }, now);
    expect(accepted).toMatchObject({ kind: 'accepted', new_due_at: '2026-10-01', notification_status: 'pending' });
    expect(await saveProjectUpdate(db, 'song-1', 'owner@example.com', { action: 'start_work', body: 'I am listening.' }, new Date(now.getTime() + 1000))).toBeNull();
    sql.prepare(`INSERT INTO audio_payments(request_id,approved_service,total_amount_cents,booking_amount_cents,balance_amount_cents,
      offer_accepted_at,booking_status,created_at,updated_at)
      VALUES ('song-1','Two-track vocal mix',20000,10000,10000,?,'paid',?,?)`)
      .run(now.toISOString(), now.toISOString(), now.toISOString());
    const started = await saveProjectUpdate(db, 'song-1', 'owner@example.com', { action: 'start_work', body: 'I am listening for the heart of the song.' }, new Date(now.getTime() + 1000));
    expect(started?.kind).toBe('work_started');
    const revised = await saveProjectUpdate(db, 'song-1', 'owner@example.com', {
      action: 'revise_date', dueDate: '2026-10-04', reason: 'client_clarification', body: 'I need the updated vocal file.',
    }, new Date(now.getTime() + 2000));
    expect(revised).toMatchObject({ kind: 'date_changed', reason: 'client_clarification', previous_due_at: '2026-10-01', new_due_at: '2026-10-04' });
    expect((await listProjectUpdates(db, 'song-1')).map(item => item.kind)).toEqual(['accepted', 'work_started', 'date_changed']);
    expect(sql.prepare("SELECT stage,original_due_at,current_due_at FROM audio_projects WHERE request_id='song-1'").get())
      .toEqual({ stage: 'in_progress', original_due_at: '2026-10-01', current_due_at: '2026-10-04' });
    expect(sql.prepare("SELECT action FROM audio_project_audit WHERE request_id='song-1' ORDER BY id").all())
      .toEqual([{ action: 'created' }, { action: 'accepted' }, { action: 'stage-changed' }, { action: 'date-changed' }]);
    sql.close();
  });

  it('keeps the saved update when email fails and allows only a failed delivery to retry', async () => {
    const { sql, db } = fixture();
    sql.prepare("UPDATE owner_requests SET status='reviewed' WHERE id='song-1'").run();
    const update = (await saveProjectUpdate(db, 'song-1', 'owner@example.com', { action: 'accept', dueDate: '2026-10-01', body: 'We are set.' }, now))!;
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'noreply@example.com' } as Env;
    vi.mocked(sendAudioMessage).mockResolvedValueOnce({ ok: false });
    await deliverProjectUpdateNotice(db, update.id, env);
    expect(sql.prepare('SELECT notification_status FROM audio_project_updates WHERE id=?').get(update.id))
      .toEqual({ notification_status: 'failed' });
    expect(await queueProjectNoticeForDelivery(db, 'song-1', update.id)).toBe(true);
    await deliverProjectUpdateNotice(db, update.id, env);
    await deliverProjectUpdateNotice(db, update.id, env);
    expect(sendAudioMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendAudioMessage).mock.calls[1][0].payload.text).not.toContain('We are set.');
    expect(sql.prepare('SELECT notification_status FROM audio_project_updates WHERE id=?').get(update.id))
      .toEqual({ notification_status: 'sent' });
    expect(await queueProjectNoticeForDelivery(db, 'song-1', update.id)).toBe(false);
    sql.close();
  });
});
