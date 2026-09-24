import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendStudioSignInNotice } from '~/lib/audio-resend';
import { deliverProjectInvitation, queueProjectInvitation } from '~/lib/audio-project-invitations';

vi.mock('~/lib/audio-resend', () => ({ sendStudioSignInNotice: vi.fn(async () => ({ ok: true })) }));
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(baseline);
  const statement = (query: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(query, values),
    run: async () => ({ meta: { changes: sql.prepare(query).run(...args).changes } }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  const db = { prepare: (query: string) => statement(query) } as unknown as D1Database;
  sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','new','2026-09-22','2026-09-22')`).run();
  return { sql, db };
}

beforeEach(() => vi.clearAllMocks());

describe('project invitations', () => {
  it('sends one sign-in notice and records success', async () => {
    const { sql, db } = fixture();
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com' } as Env;
    await Promise.all([deliverProjectInvitation(db, 'song-1', env), deliverProjectInvitation(db, 'song-1', env)]);
    expect(sendStudioSignInNotice).toHaveBeenCalledTimes(1);
    expect(sendStudioSignInNotice).toHaveBeenCalledWith('test', 'studio@example.com', 'artist@example.com', 'Your private studio project', 'invitation');
    expect(sql.prepare("SELECT invitation_status,invitation_sent_at IS NOT NULL AS delivered FROM audio_projects WHERE request_id='song-1'").get())
      .toEqual({ invitation_status: 'sent', delivered: 1 });
    expect(await queueProjectInvitation(db, 'song-1')).toBe(false);
    sql.close();
  });

  it('retains a failed invitation for an explicit retry', async () => {
    const { sql, db } = fixture();
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com' } as Env;
    vi.mocked(sendStudioSignInNotice).mockResolvedValueOnce({ ok: false });
    await deliverProjectInvitation(db, 'song-1', env);
    expect(sql.prepare("SELECT invitation_status FROM audio_projects WHERE request_id='song-1'").get())
      .toEqual({ invitation_status: 'failed' });
    expect(await queueProjectInvitation(db, 'song-1')).toBe(true);
    await deliverProjectInvitation(db, 'song-1', env);
    expect(sendStudioSignInNotice).toHaveBeenCalledTimes(2);
    sql.close();
  });

  it('requires checking Resend before retrying an uncertain invitation', async () => {
    const { sql, db } = fixture();
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com' } as Env;
    vi.mocked(sendStudioSignInNotice).mockResolvedValueOnce({ ok: false, uncertain: true });
    await deliverProjectInvitation(db, 'song-1', env);
    expect(sql.prepare("SELECT invitation_status FROM audio_projects WHERE request_id='song-1'").get())
      .toEqual({ invitation_status: 'sending' });
    expect(await queueProjectInvitation(db, 'song-1', false, new Date(Date.now() + 61_000))).toBe(false);
    expect(await queueProjectInvitation(db, 'song-1', true, new Date(Date.now() + 61_000))).toBe(true);
    await deliverProjectInvitation(db, 'song-1', env);
    expect(sendStudioSignInNotice).toHaveBeenCalledTimes(2);
    sql.close();
  });

  it('does not invite a withdrawn or revoked project', async () => {
    const { sql, db } = fixture();
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com' } as Env;
    sql.prepare("UPDATE owner_requests SET status='withdrawn' WHERE id='song-1'").run();
    await deliverProjectInvitation(db, 'song-1', env);
    expect(await queueProjectInvitation(db, 'song-1')).toBe(false);
    expect(sendStudioSignInNotice).not.toHaveBeenCalled();
    sql.close();
  });

  it('does not send an invitation when access closes after the delivery claim', async () => {
    const { sql, db } = fixture();
    const env = { RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com' } as Env;
    const interleavedDb = {
      prepare(query: string) {
        const statement = db.prepare(query);
        if (!query.includes('SELECT r.email FROM owner_requests')) return statement;
        return {
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              first: async () => {
                sql.prepare("UPDATE audio_projects SET revoked_at='2026-09-22' WHERE request_id='song-1'").run();
                return bound.first();
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    await deliverProjectInvitation(interleavedDb, 'song-1', env);
    expect(sendStudioSignInNotice).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT invitation_status FROM audio_projects WHERE request_id='song-1'").get())
      .toEqual({ invitation_status: 'sending' });
    sql.close();
  });
});
