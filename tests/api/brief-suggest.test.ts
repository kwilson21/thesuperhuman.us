import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSuggestionPass } from '~/lib/brief-suggestion-pass';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { POST } from '~/pages/api/software/brief/suggest';
let db: any, database: any, run: ReturnType<typeof vi.fn>;
let cookie: string;
const secret = 'existing-turnstile-secret-for-tests';
let siteLimiter: { limit: ReturnType<typeof vi.fn> };
let limiter: { limit: ReturnType<typeof vi.fn> };
const input = { question: 'What happens today?', text: 'We track new clients', earlier: { path: 'workflow' } };
function context(body: unknown = input, env: Record<string, unknown> = {}) {
  return { request: new Request('https://example.com/api/software/brief/suggest', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': 'test', cookie }, body: JSON.stringify(body) }), locals: { runtime: { env: { AI: { run }, MUSIC_DB: database, BRIEF_SUGGEST_RATE_LIMIT: limiter, BRIEF_SUGGEST_SITE_LIMIT: siteLimiter, TURNSTILE_SECRET_KEY: secret, SOFTWARE_SUGGESTIONS_ENABLED: 'true', ...env } } } } as any;
}
beforeEach(async () => {
  cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, 'test')}`;
  siteLimiter = { limit: vi.fn(async () => ({ success: true })) };
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/music/0025_brief_suggestion_budget.sql', 'utf8'));
  database = { prepare: vi.fn((sql: string) => ({ bind: (...args: unknown[]) => ({
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  }) })) };
  const counts = new Map<string, { start: number; count: number }>();
  limiter = { limit: vi.fn(async ({ key }: { key: string }) => {
    let window = counts.get(key);
    if (!window || Date.now() - window.start >= 60000) {
      window = { start: Date.now(), count: 0 };
      counts.set(key, window);
    }
    return { success: ++window.count <= 30 };
  }) };
  run = vi.fn(async () => ({ response: ' in a shared spreadsheet' }));
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
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
it.each([{ AI: undefined }, { MUSIC_DB: undefined }, { BRIEF_SUGGEST_RATE_LIMIT: undefined }, { SOFTWARE_SUGGESTIONS_ENABLED: 'false' }])('silently disables unavailable suggestions', async env => {
  expect(await (await POST(context(input, env))).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it('enforces the minute limit', async () => {
  for (let i = 0; i < 31; i++) await POST(context());
  expect(run).toHaveBeenCalledTimes(30);
});
it.each([['visitor', 300], ['site', 10000]])('enforces %s cap', async (scope, cap) => {
  await POST(context());
  db.prepare(scope === 'site' ? "UPDATE brief_suggestion_budget SET count=? WHERE scope='site'" : "UPDATE brief_suggestion_budget SET count=? WHERE scope!='site'").run(cap);
  run.mockClear();
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it.each(['visitor', 'site'])('concurrent requests cannot exceed the %s daily cap', async scope => {
  await POST(context());
  db.prepare(scope === 'site' ? "UPDATE brief_suggestion_budget SET count=9998 WHERE scope='site'" : "UPDATE brief_suggestion_budget SET count=298 WHERE scope!='site'").run();
  run.mockClear();
  await Promise.all(Array.from({ length: 10 }, () => POST(context())));
  expect(run).toHaveBeenCalledTimes(2);
  expect(db.prepare(scope === 'site' ? "SELECT count FROM brief_suggestion_budget WHERE scope='site'" : "SELECT count FROM brief_suggestion_budget WHERE scope!='site'").get().count).toBe(scope === 'site' ? 10000 : 300);
});
it('cleans expired rows in bounded batches and retains the previous UTC day', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const insert = db.prepare('INSERT INTO brief_suggestion_budget VALUES (?, ?, 1)');
  insert.run(previous, 'previous'); insert.run(day, 'today');
  for (let i = 0; i < 1001; i++) insert.run('2000-01-01', String(i));
  await POST(context());
  expect(db.prepare("SELECT count(*) n FROM brief_suggestion_budget WHERE day='2000-01-01'").get().n).toBe(1);
  expect(db.prepare('SELECT count FROM brief_suggestion_budget WHERE scope=?').get('previous').count).toBe(1);
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

it('recovers after sixty seconds', async () => {
  for (let i = 0; i < 40; i++) await POST(context());
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

it('caps a concurrent burst before invoking AI or daily counters', async () => {
  const responses = await Promise.all(Array.from({ length: 31 }, () => POST(context())));
  const bodies = await Promise.all(responses.map(response => response.json()));
  expect(bodies.filter(body => (body as { suggestion: string }).suggestion)).toHaveLength(30);
  expect(run).toHaveBeenCalledTimes(30);
  expect(limiter.limit).toHaveBeenCalledTimes(31);
  expect(new Set(limiter.limit.mock.calls.map(([options]) => options.key)).size).toBe(1);

});
it.each([1, 2, 3])('fails closed when D1 budget statement %s fails', async failedStatement => {
  const prepare = database.prepare.getMockImplementation();
  let count = 0;
  database.prepare.mockImplementation((sql: string) => {
    if (++count === failedStatement) throw new Error('unavailable');
    return prepare(sql);
  });
  expect(await (await POST(context())).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it('cleans once per UTC day after the first site reservation, never on capped requests', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, 'test')}`;
  const cleanupCalls = () => database.prepare.mock.calls.filter(([sql]: [string]) => sql.startsWith('DELETE'));
  await Promise.all([POST(context()), POST(context())]);
  expect(cleanupCalls()).toHaveLength(1);
  expect(database.prepare.mock.calls[0][0]).toMatch(/^SELECT/);
  db.prepare("UPDATE brief_suggestion_budget SET count=10000 WHERE scope='site'").run();
  await POST(context());
  db.prepare("UPDATE brief_suggestion_budget SET count=300 WHERE scope!='site'").run();
  await POST(context());
  expect(cleanupCalls()).toHaveLength(1);
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, 'test')}`;
  await POST(context()); await POST(context());
  expect(cleanupCalls()).toHaveLength(2);
});
it.each(['pending', 'rejected', 'unsuccessful', 'throws'])('does not delay or suppress suggestions when cleanup is %s', async failure => {
  const prepare = database.prepare.getMockImplementation();
  let finish!: () => void;
  const pending = new Promise(resolve => { finish = () => resolve({ success: true }); });
  database.prepare.mockImplementation((sql: string) => {
    if (!sql.startsWith('DELETE')) return prepare(sql);
    if (failure === 'throws') throw new Error('unavailable');
    return { bind: () => ({ run: () => failure === 'pending' ? pending : failure === 'rejected' ? Promise.reject(new Error('unavailable')) : Promise.resolve({ success: false }) }) };
  });
  const ctx = context();
  const waitUntil = vi.fn(); ctx.locals.runtime.ctx = { waitUntil };
  expect(await (await POST(ctx)).json()).toEqual({ suggestion: ' in a shared spreadsheet' });
  expect(waitUntil).toHaveBeenCalledOnce();
  finish();
  await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
});
it('fails closed when the minute binding throws', async () => {
  limiter.limit.mockRejectedValueOnce(new Error('unavailable'));
  await POST(context()); expect(run).not.toHaveBeenCalled();
  expect(database.prepare).not.toHaveBeenCalled();
});

it.each(['missing', 'expired', 'tampered', 'other-ip'])('rejects a %s pass before AI and counters', async kind => {
  cookie = kind === 'missing' ? '' : `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, kind === 'other-ip' ? 'other' : 'test', kind === 'expired' ? Date.now() - 1800001 : Date.now())}${kind === 'tampered' ? 'a' : ''}`;
  expect(await (await POST(context())).json()).toEqual({ suggestion: '', passRequired: true });
  expect(run).not.toHaveBeenCalled(); expect(database.prepare).not.toHaveBeenCalled();
});
it('rejects a missing or exhausted site ceiling', async () => {
  await POST(context(input, { BRIEF_SUGGEST_SITE_LIMIT: undefined }));
  siteLimiter.limit.mockResolvedValue({ success: false });
  await POST(context());
  expect(run).not.toHaveBeenCalled(); expect(database.prepare).not.toHaveBeenCalled();
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
  await POST(context()); expect(run).not.toHaveBeenCalled(); expect(database.prepare).not.toHaveBeenCalled();
});

it.each([10000, 10001])('makes no writes once the site count is %s, including for new visitors', async count => {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO brief_suggestion_budget VALUES (?, ?, ?)').run(day, 'site', count);
  for (const ip of ['test', 'new-visitor']) {
    cookie = `__Secure-brief-suggestion-pass=${await createSuggestionPass(secret, ip)}`;
    const ctx = context();
    ctx.request = new Request(ctx.request, { headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': ip, cookie } });
    expect(await (await POST(ctx)).json()).toEqual({ suggestion: '' });
  }
  expect(database.prepare.mock.calls.every(([sql]: [string]) => sql.startsWith('SELECT'))).toBe(true);
  expect(db.prepare('SELECT * FROM brief_suggestion_budget').all()).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});
it('never writes the site row for a capped visitor', async () => {
  await POST(context());
  db.prepare("UPDATE brief_suggestion_budget SET count=300 WHERE scope!='site'").run();
  database.prepare.mockClear();
  await POST(context());
  expect(database.prepare.mock.calls.filter(([sql]: [string]) => sql.startsWith('INSERT'))).toHaveLength(1);
  expect(db.prepare("SELECT count FROM brief_suggestion_budget WHERE scope='site'").get().count).toBe(1);
});
