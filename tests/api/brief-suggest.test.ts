import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSuggestionPass } from '~/lib/brief-suggestion-pass';
import { POST } from '~/pages/api/software/brief/suggest';
let values: Map<string, string>, kv: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> }, run: ReturnType<typeof vi.fn>;
let cookie: string;
const secret = 'existing-turnstile-secret-for-tests';
let siteLimiter: { limit: ReturnType<typeof vi.fn> };
let limiter: { limit: ReturnType<typeof vi.fn> };
const input = { question: 'What happens today?', text: 'We track new clients', earlier: { path: 'workflow' } };
function context(body: unknown = input, env: Record<string, unknown> = {}) {
  return { request: new Request('https://example.com/api/software/brief/suggest', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': 'test', cookie }, body: JSON.stringify(body) }), locals: { runtime: { env: { AI: { run }, RATE_LIMIT: kv, BRIEF_SUGGEST_RATE_LIMIT: limiter, BRIEF_SUGGEST_SITE_LIMIT: siteLimiter, TURNSTILE_SECRET_KEY: secret, SOFTWARE_SUGGESTIONS_ENABLED: 'true', ...env } } } } as any;
}
beforeEach(async () => {
  cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, 'test')}`;
  siteLimiter = { limit: vi.fn(async () => ({ success: true })) };
  values = new Map();
  const counts = new Map<string, { start: number; count: number }>();
  limiter = { limit: vi.fn(async ({ key }: { key: string }) => {
    let window = counts.get(key);
    if (!window || Date.now() - window.start >= 60000) {
      window = { start: Date.now(), count: 0 };
      counts.set(key, window);
    }
    return { success: ++window.count <= 30 };
  }) };
  kv = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _options: { expirationTtl: number }) => { values.set(key, value); }),
  };
  run = vi.fn(async () => ({ response: ' in a shared spreadsheet' }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('sends only allowed answer context with a twelve-token cap', async () => {
  expect(await (await POST(context())).json()).toEqual({ suggestion: ' in a shared spreadsheet' });
  expect(run.mock.calls[0][1]).toMatchObject({ max_tokens: 12, temperature: 0.1 });
  expect(JSON.stringify(run.mock.calls)).not.toContain('test');
});
it.each([
  { ...input, name: 'Private' }, { ...input, earlier: { email: 'private@example.com' } },
  { ...input, text: '' }, { ...input, text: 'one two' }, { ...input, text: 'x'.repeat(2001) },
  { ...input, question: 'Who should I reply to?' },
])('silently rejects invalid or private payloads', async body => {
  expect(await (await POST(context(body))).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it.each([{ AI: undefined }, { RATE_LIMIT: undefined }, { BRIEF_SUGGEST_RATE_LIMIT: undefined }, { SOFTWARE_SUGGESTIONS_ENABLED: 'false' }])('silently disables unavailable suggestions', async env => {
  expect(await (await POST(context(input, env))).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it('enforces the minute limit', async () => {
  for (let i = 0; i < 31; i++) await POST(context());
  expect(run).toHaveBeenCalledTimes(30);
});
it.each([['visitor-day', 300], ['site-day', 10000]])('enforces %s cap', async (key, count) => {
  await POST(context());
  for (const storedKey of values.keys()) {
    if (storedKey.startsWith(`rl:brief-suggest:${key}:`)) values.set(storedKey, String(count));
  }
  run.mockClear();
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it('returns no suggestion on error, empty model output or timeout', async () => {
  run.mockRejectedValueOnce(new Error('unavailable'));
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  run.mockResolvedValueOnce({ response: '' });
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  run.mockImplementationOnce(() => new Promise(() => {}));
  const response = POST(context());
  expect(await (await response).json()).toEqual({ suggestion: '' });
});

it('recovers after sixty seconds and keeps daily KV TTLs', async () => {
  for (let i = 0; i < 40; i++) await POST(context());
  expect(kv.put.mock.calls.slice(0, 2).map(call => call[2].expirationTtl)).toEqual([86400, 86400]);
  expect(run).toHaveBeenCalledTimes(30);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 60001);
  await POST(context()); expect(run).toHaveBeenCalledTimes(31);
});
it('rejects over-budget combined context and returns at most six words', async () => {
  expect(await (await POST(context({ ...input, earlier: { path: 'workflow', today: 'a'.repeat(1990) } }))).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
  run.mockResolvedValueOnce({ response: 'one two three four five six seven eight' });
  expect(await (await POST(context())).json()).toEqual({ suggestion: ' one two three four five six' });
});
it('never invokes AI on local previews or cross-origin requests', async () => {
  const local = context(); local.request = new Request('http://localhost/api/software/brief/suggest', { method: 'POST' });
  expect(await (await POST(local)).json()).toEqual({ suggestion: '' });
  const crossOrigin = context(); crossOrigin.request = new Request(crossOrigin.request, { headers: { origin: 'https://other.example', 'content-type': 'application/json' } });
  expect(await (await POST(crossOrigin)).json()).toEqual({ suggestion: '' }); expect(run).not.toHaveBeenCalled();
});

it('caps a concurrent burst before invoking AI or daily KV counters', async () => {
  const responses = await Promise.all(Array.from({ length: 31 }, () => POST(context())));
  const bodies = await Promise.all(responses.map(response => response.json()));
  expect(bodies.filter(body => (body as { suggestion: string }).suggestion)).toHaveLength(30);
  expect(run).toHaveBeenCalledTimes(30);
  expect(limiter.limit).toHaveBeenCalledTimes(31);
  expect(new Set(limiter.limit.mock.calls.map(([options]) => options.key)).size).toBe(1);
  expect(kv.put).toHaveBeenCalledTimes(60);
});
it('fails closed only when the minute binding throws', async () => {
  limiter.limit.mockRejectedValueOnce(new Error('unavailable'));
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  expect(kv.get).not.toHaveBeenCalled();
  kv.put.mockRejectedValueOnce(new Error('write limit'));
  expect(await (await POST(context())).json()).toEqual({ suggestion: ' in a shared spreadsheet' });
  kv.get.mockRejectedValueOnce(new Error('read failure'));
  expect(await (await POST(context())).json()).toEqual({ suggestion: ' in a shared spreadsheet' });
});

it('continues concurrent suggestions when daily writes contend', async () => {
  kv.put.mockRejectedValue(new Error('one write per second'));
  const responses = await Promise.all(Array.from({ length: 5 }, () => POST(context())));
  for (const response of responses) expect(await response.json()).toEqual({ suggestion: ' in a shared spreadsheet' });
});

it.each(['missing', 'expired', 'tampered', 'other-ip'])('rejects a %s pass before AI and counters', async kind => {
  cookie = kind === 'missing' ? '' : `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, kind === 'other-ip' ? 'other' : 'test', kind === 'expired' ? Date.now() - 1800001 : Date.now())}${kind === 'tampered' ? 'a' : ''}`;
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled(); expect(kv.get).not.toHaveBeenCalled();
});
it('rejects a missing or exhausted site ceiling', async () => {
  await POST(context(input, { BRIEF_SUGGEST_SITE_LIMIT: undefined }));
  siteLimiter.limit.mockResolvedValue({ success: false });
  await POST(context());
  expect(run).not.toHaveBeenCalled(); expect(kv.get).not.toHaveBeenCalled();
  expect(siteLimiter.limit).toHaveBeenCalledWith({ key: 'site' });
});

it('enforces the fixed site ceiling across different visitor passes', async () => {
  let count = 0;
  siteLimiter.limit.mockImplementation(async () => ({ success: ++count <= 120 }));
  for (let i = 0; i < 121; i++) {
    const ip = `visitor-${i}`;
    cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, ip)}`;
    const ctx = context(); ctx.request = new Request(ctx.request, { headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': ip, cookie } });
    await POST(ctx);
  }
  expect(run).toHaveBeenCalledTimes(120);
  expect(new Set(siteLimiter.limit.mock.calls.map(([options]) => options.key))).toEqual(new Set(['site']));
});
it('fails closed when the site limiter throws', async () => {
  siteLimiter.limit.mockRejectedValueOnce(new Error('unavailable'));
  await POST(context()); expect(run).not.toHaveBeenCalled(); expect(kv.get).not.toHaveBeenCalled();
});
