import { beforeEach, expect, it, vi } from 'vitest';
import { POST as interest } from '~/pages/api/music-interest';
import { POST as event } from '~/pages/api/music-event';
import { sendUrgentOwnerAlert } from '~/lib/owner-alerts';
vi.mock('~/lib/music-content', () => ({ loadMusicCatalog: async () => ({ releases: [{ id: 'release', tracks: ['recording'] }], recordings: [{ id: 'recording', versions: { video: {} } }] }) }));
vi.mock('~/lib/owner-alerts', () => ({ sendUrgentOwnerAlert: vi.fn(async () => true) }));
const body = { releaseId: 'release', email: 'fan@example.com', interest: 'song', consent: true, merchandise: [], suggestion: '', turnstileToken: 'test' };
function context(data: unknown, options: { origin?: string; fail?: boolean; db?: boolean } = {}) {
  const database = { prepare: () => ({ bind: () => ({ run: async () => { if (options.fail) throw new Error('unavailable'); }, first: async () => null }) }),
    batch: async (statements: { run: () => Promise<unknown> }[]) => { for (const statement of statements) await statement.run(); return []; } };
  return { request: new Request('https://thesuperhuman.us/api/music-interest', { method: 'POST', headers: { origin: options.origin ?? 'https://thesuperhuman.us', 'content-type': 'application/json' }, body: JSON.stringify(data) }), locals: { runtime: { env: {
    MUSIC_DB: options.db === false ? undefined : database,
    RATE_LIMIT: { get: async () => null, put: async () => {}, delete: async () => {} }, TURNSTILE_SECRET_KEY: 'test',
  } } } } as any;
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true }))));
it('rejects cross-origin requests and unknown releases', async () => {
  expect((await interest(context(body, { origin: 'https://evil.example' }))).status).toBe(403);
  expect((await interest(context({ ...body, releaseId: 'missing' }))).status).toBe(404);
});
it('only confirms interest after persistence and captcha succeed', async () => {
  expect((await interest(context(body))).status).toBe(200);
  expect((await interest(context(body, { fail: true }))).status).toBe(503);
  expect(sendUrgentOwnerAlert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ category: 'request-storage', route: '/api/music-interest' }));
  expect((await interest(context(body, { db: false }))).status).toBe(503);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
  expect((await interest(context(body))).status).toBe(403);
});
it('rejects oversized requests and events for unrelated recordings', async () => {
  expect((await interest(context({ ...body, padding: 'x'.repeat(9000) }))).status).toBe(413);
  const data = { releaseId: 'release', recordingId: 'other', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0, mediaDurationSeconds: 200 };
  expect((await event(context(data))).status).toBe(404);
});
it('allows the same event to retry after a temporary database failure', async () => {
  const data = { releaseId: 'release', recordingId: 'recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 1, medium: 'audio', event: 'start', accumulatedSeconds: 0, mediaDurationSeconds: 200 };
  const stored = new Map<string, string>();
  const ctx = context(data, { fail: true });
  ctx.locals.runtime.env.RATE_LIMIT = { get: async (k: string) => stored.get(k), put: async (k: string, v: string) => { stored.set(k, v); }, delete: async (k: string) => { stored.delete(k); } };
  expect((await event(ctx)).status).toBe(503);
  const retry = context(data);
  retry.locals.runtime.env.RATE_LIMIT = ctx.locals.runtime.env.RATE_LIMIT;
  expect((await event(retry)).status).toBe(200);
});
it('reports an invalid playback sequence as a conflict', async () => {
  const data = { releaseId: 'release', recordingId: 'recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', playthroughId: '0bc1f442-f455-49d6-b3a7-99f4fbd92ab4', eventId: '538b2261-f59b-4489-96bd-1945e307d312', sequence: 2, medium: 'audio', event: 'listen30', accumulatedSeconds: 10, mediaDurationSeconds: 200 };
  expect((await event(context(data))).status).toBe(409);
});
