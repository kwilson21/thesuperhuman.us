import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/software/brief/pass';
import { validSuggestionPass } from '~/lib/brief-suggestion-pass';
const secret = 'existing-turnstile-secret-for-tests';
const context = (token: unknown = 'token', overrides = {}) => ({
  request: new Request('https://example.com/api/software/brief/pass', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': 'test' }, body: JSON.stringify({ token }) }),
  locals: { runtime: { env: { TURNSTILE_SECRET_KEY: secret, SOFTWARE_SUGGESTIONS_ENABLED: 'true', ...overrides } } },
}) as any;
afterEach(() => vi.unstubAllGlobals());
it('verifies once and issues a thirty-minute secure, IP-bound pass', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
  const response = await POST(context());
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict; Max-Age=1800');
  expect(await validSuggestionPass(cookie.split(';')[0].split('=')[1], secret, 'test')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([false, true])('never issues a pass on verification failure or absent secret (%s)', async missing => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
  expect((await POST(context('token', missing ? { TURNSTILE_SECRET_KEY: undefined } : {}))).headers.get('set-cookie')).toBeNull();
});
it('rejects invalid payloads and cross-origin issuance', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await POST(context(''));
  const ctx = context(); ctx.request = new Request(ctx.request, { headers: { origin: 'https://other.example' } }); await POST(ctx);
  expect(fetch).not.toHaveBeenCalled();
});
