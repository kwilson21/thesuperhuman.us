import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/owner/projects/[id]/updates';
import { deliverProjectUpdateNotice, queueProjectNoticeForDelivery, saveProjectUpdate } from '~/lib/audio-project-updates';

vi.mock('~/lib/audio-project-updates', async importOriginal => ({
  ...(await importOriginal<typeof import('~/lib/audio-project-updates')>()),
  deliverProjectUpdateNotice: vi.fn(async () => {}),
  queueProjectNoticeForDelivery: vi.fn(async () => false),
  saveProjectUpdate: vi.fn(async () => null),
}));

function context(body: unknown, options: { owner?: boolean; enabled?: boolean; origin?: string } = {}) {
  return {
    params: { id: 'song-1' },
    request: new Request('https://thesuperhuman.us/api/owner/projects/song-1/updates', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: options.origin ?? 'https://thesuperhuman.us' },
      body: JSON.stringify(body),
    }),
    locals: { owner: options.owner === false ? undefined : { email: 'owner@example.com' }, runtime: {
      env: { AUDIO_CLIENT_PORTAL_ENABLED: options.enabled === false ? 'false' : 'true', MUSIC_DB: {} },
      ctx: { waitUntil: vi.fn((work: Promise<unknown>) => { void work; }) },
    } },
  } as any;
}

beforeEach(() => vi.clearAllMocks());

it('allows only the owner through the disabled-by-default project gate', async () => {
  expect((await POST(context({ action: 'progress', body: 'Listening now.' }, { owner: false }))).status).toBe(403);
  expect((await POST(context({ action: 'progress', body: 'Listening now.' }, { enabled: false }))).status).toBe(404);
  expect(saveProjectUpdate).not.toHaveBeenCalled();
});

it('saves first and schedules a separate minimal email delivery', async () => {
  vi.mocked(saveProjectUpdate).mockResolvedValueOnce({ id: 7, kind: 'progress', notification_status: 'pending' } as any);
  const ctx = context({ action: 'progress', body: 'I have started listening.' });
  const response = await POST(ctx);
  expect(response.status).toBe(200);
  expect(saveProjectUpdate).toHaveBeenCalledWith({}, 'song-1', 'owner@example.com', { action: 'progress', body: 'I have started listening.' });
  expect(deliverProjectUpdateNotice).toHaveBeenCalledWith({}, 7, ctx.locals.runtime.env);
  expect(ctx.locals.runtime.ctx.waitUntil).toHaveBeenCalledOnce();
});

it('rejects invalid and cross-site updates without saving anything', async () => {
  expect((await POST(context({ action: 'revise_date', dueDate: '2026-02-30', reason: 'protect_song', body: 'More time.' }))).status).toBe(400);
  expect((await POST(context({ action: 'progress', body: 'Cross-site' }, { origin: 'https://other.example' }))).status).toBe(403);
  expect(saveProjectUpdate).not.toHaveBeenCalled();
});

it('passes owner confirmation through when retrying an unconfirmed notification', async () => {
  expect((await POST(context({ action: 'retry_email', updateId: 7 }))).status).toBe(409);
  vi.mocked(queueProjectNoticeForDelivery).mockResolvedValueOnce(true);
  const ctx = context({ action: 'retry_email', updateId: 7, confirmedNotSent: true });
  expect((await POST(ctx)).status).toBe(200);
  expect(queueProjectNoticeForDelivery).toHaveBeenLastCalledWith({}, 'song-1', 7, true);
  expect(deliverProjectUpdateNotice).toHaveBeenCalledWith({}, 7, ctx.locals.runtime.env);
});
