import { beforeEach, expect, it, vi } from 'vitest';
import { POST as interest } from '~/pages/api/music-interest';
import { POST as event } from '~/pages/api/music-event';
vi.mock('~/lib/music-content', () => ({ loadMusicCatalog: async () => ({ releases: [{ id: 'release', tracks: ['recording'] }], recordings: [{ id: 'recording', versions: { video: {} } }] }) }));
const body = { releaseId: 'release', email: 'fan@example.com', interest: 'song', consent: true, merchandise: [], suggestion: '', turnstileToken: 'test' };
function context(data: unknown, options: { origin?: string; fail?: boolean; db?: boolean } = {}) {
  return { request: new Request('https://thesuperhuman.us/api/music-interest', { method: 'POST', headers: { origin: options.origin ?? 'https://thesuperhuman.us', 'content-type': 'application/json' }, body: JSON.stringify(data) }), locals: { runtime: { env: {
    MUSIC_DB: options.db === false ? undefined : { prepare: () => ({ bind: () => ({ run: async () => { if (options.fail) throw new Error('unavailable'); } }) }) },
    RATE_LIMIT: { get: async () => null, put: async () => {} }, TURNSTILE_SECRET_KEY: 'test',
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
  expect((await interest(context(body, { db: false }))).status).toBe(503);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
  expect((await interest(context(body))).status).toBe(403);
});
it('rejects oversized requests and events for unrelated recordings', async () => {
  expect((await interest(context({ ...body, padding: 'x'.repeat(9000) }))).status).toBe(413);
  const data = { releaseId: 'release', recordingId: 'other', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', medium: 'audio', event: 'start' };
  expect((await event(context(data))).status).toBe(404);
});
it('allows the same event to retry after a temporary database failure', async () => {
  const data = { releaseId: 'release', recordingId: 'recording', sessionId: 'a8246321-955d-4a28-b81e-2b74b52cd450', medium: 'audio', event: 'start' };
  const stored = new Map<string, string>();
  const ctx = context(data, { fail: true });
  ctx.locals.runtime.env.RATE_LIMIT = { get: async (k: string) => stored.get(k), put: async (k: string, v: string) => { stored.set(k, v); }, delete: async (k: string) => { stored.delete(k); } };
  expect((await event(ctx)).status).toBe(503);
  const retry = context(data);
  retry.locals.runtime.env.RATE_LIMIT = ctx.locals.runtime.env.RATE_LIMIT;
  expect((await event(retry)).status).toBe(200);
});
