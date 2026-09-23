import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/owner/projects/[id]/invitation';
import { deliverProjectInvitation, queueProjectInvitation } from '~/lib/audio-project-invitations';

vi.mock('~/lib/audio-project-invitations', () => ({
  deliverProjectInvitation: vi.fn(async () => {}),
  queueProjectInvitation: vi.fn(async () => true),
}));

function context(options: { owner?: boolean; enabled?: boolean; action?: string } = {}) {
  const waitUntil = vi.fn();
  const env = { AUDIO_CLIENT_PORTAL_ENABLED: options.enabled === false ? 'false' : 'true', MUSIC_DB: {} };
  return { params: { id: 'song-1' }, request: new Request('https://thesuperhuman.us/api/owner/projects/song-1/invitation', {
    method: 'POST', headers: { origin: 'https://thesuperhuman.us', 'content-type': 'application/json' },
    body: JSON.stringify({ action: options.action ?? 'send' }),
  }), locals: { owner: options.owner === false ? null : { email: 'owner@example.com' }, runtime: { env, ctx: { waitUntil } } }, waitUntil } as any;
}

beforeEach(() => vi.clearAllMocks());

it('keeps invitation sending behind the owner and portal gates', async () => {
  expect((await POST(context({ owner: false }))).status).toBe(403);
  expect((await POST(context({ enabled: false }))).status).toBe(404);
  expect((await POST(context({ action: 'wrong' }))).status).toBe(400);
  expect(queueProjectInvitation).not.toHaveBeenCalled();
});

it('queues one owner-triggered invitation and schedules delivery', async () => {
  const ctx = context();
  expect((await POST(ctx)).status).toBe(200);
  expect(queueProjectInvitation).toHaveBeenCalledWith(ctx.locals.runtime.env.MUSIC_DB, 'song-1');
  expect(deliverProjectInvitation).toHaveBeenCalledWith(ctx.locals.runtime.env.MUSIC_DB, 'song-1', ctx.locals.runtime.env);
  expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  vi.mocked(queueProjectInvitation).mockResolvedValueOnce(false);
  expect((await POST(context())).status).toBe(409);
});
