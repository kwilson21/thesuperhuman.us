import { createRequire } from 'node:module';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/software/brief/suggest';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: any, db: D1Database, run: ReturnType<typeof vi.fn>;
const input = { question: 'What happens today?', text: 'We track new clients', earlier: { path: 'workflow' } };
function context(body: unknown = input, env: Record<string, unknown> = {}) {
  return { request: new Request('https://example.com/api/software/brief/suggest', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'cf-connecting-ip': 'test' }, body: JSON.stringify(body) }), locals: { runtime: { env: { AI: { run }, MUSIC_DB: db, SOFTWARE_SUGGESTIONS_ENABLED: 'true', ...env } } } } as any;
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE brief_suggestion_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values) });
  db = { prepare: statement, batch: async (items: any[]) => items.map(item => ({ results: sql.prepare(item.query).all(...item.args) })) } as any;
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
it.each([{ AI: undefined }, { MUSIC_DB: undefined }, { SOFTWARE_SUGGESTIONS_ENABLED: 'false' }])('silently disables unavailable suggestions', async env => {
  expect(await (await POST(context(input, env))).json()).toEqual({ suggestion: '' });
  expect(run).not.toHaveBeenCalled();
});
it('enforces the minute limit', async () => {
  for (let i = 0; i < 31; i++) await POST(context());
  expect(run).toHaveBeenCalledTimes(30);
});
it.each([['visitor-day', 300], ['site-day', 10000]])('enforces %s cap', async (key, count) => {
  await POST(context());
  sql.prepare('UPDATE brief_suggestion_limits SET count=? WHERE key LIKE ?').run(count, `${key}:%`);
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

it('reserves quota atomically under concurrent requests and recovers at the next minute', async () => {
  await Promise.all(Array.from({ length: 40 }, () => POST(context())));
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
