import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/software-inquiry';
import { softwareBrief, validateSoftwareInquiry } from '~/lib/software-inquiry';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const id = '00000000-0000-4000-8000-000000000001';
const base = { path: 'workflow', today: 'First line\nSecond line', audience: 'Our team', firstResult: 'One place to see next steps.', name: 'Alex', email: 'Alex@Example.com', company: 'Example Studio', timing: 'flexible', timingReason: '', budgetStatus: 'exploring', budgetNote: '', approver: 'self', approverRole: 'ignored', turnstileToken: 'test', submissionId: id };
let sql: InstanceType<typeof DatabaseSync>;
let db: D1Database;
let kv: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
let stored: Map<string, string>;
function context(input: unknown = base, options: { origin?: string; type?: string; db?: D1Database | null; token?: string | null; rate?: typeof kv | null } = {}) {
  return { request: new Request('https://thesuperhuman.us/api/software-inquiry', { method: 'POST', headers: { origin: options.origin ?? 'https://thesuperhuman.us', 'content-type': options.type ?? 'application/json' }, body: typeof input === 'string' ? input : JSON.stringify(input) }), locals: { runtime: { env: { MUSIC_DB: options.db === undefined ? db : options.db, TURNSTILE_SECRET_KEY: options.token === undefined ? 'test' : options.token, RATE_LIMIT: options.rate === undefined ? kv : options.rate, RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'from@example.com', CONTACT_TO_EMAIL: 'owner@example.com' } } } } as any;
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values), first: async () => sql.prepare(query).get(...args) ?? null, all: async () => ({ results: sql.prepare(query).all(...args) }) });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN'); try { const result = items.map(item => ({ results: /RETURNING/i.test(item.query) ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) })); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  stored = new Map();
  kv = { get: vi.fn(async (key: string) => stored.get(key) ?? null), put: vi.fn(async (key: string, value: string) => { stored.set(key, value); }), delete: vi.fn(async (key: string) => { stored.delete(key); }) };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('siteverify') ? { ok: true, json: async () => ({ success: true }) } : { ok: true }));
});

it('stores one verbatim software brief, audit, and no audio project, then returns a saved receipt', async () => {
  const response = await POST(context());
  expect(response.status).toBe(200);
  expect((await response.json() as { brief: unknown }).brief).toMatchObject({ today: 'First line\nSecond line', email: 'alex@example.com' });
  expect(sql.prepare('SELECT kind,service_id,email,summary,details_json,submission_id FROM owner_requests').get()).toMatchObject({ kind: 'software', service_id: 'workflow', email: 'alex@example.com', summary: 'One place to see next steps.', submission_id: id });
  const details = JSON.parse((sql.prepare('SELECT details_json FROM owner_requests').get() as { details_json: string }).details_json);
  expect(details).toMatchObject({ today: 'First line\nSecond line', approverRole: '' });
  expect(sql.prepare('SELECT COUNT(*) AS n FROM audio_projects').get()).toEqual({ n: 0 });
  expect(sql.prepare('SELECT action FROM owner_request_audit').all()).toEqual([{ action: 'created' }]);
});

it('deduplicates after rate limit, rejects another email without leaking the brief, and limits new IDs', async () => {
  const first = await POST(context({ ...base, email: 'alex@example.com' }));
  expect(first.status).toBe(200);
  const firstBrief = (await first.json() as { brief: Record<string, string> }).brief;
  const duplicate = await POST(context());
  expect(duplicate.status).toBe(200);
  expect((await duplicate.json() as { brief: Record<string, string> }).brief).toEqual(firstBrief);
  const conflict = await POST(context({ ...base, email: 'other@example.com' }));
  expect(conflict.status).toBe(409);
  expect(JSON.stringify(await conflict.json())).not.toContain('First line');
  expect((await POST(context({ ...base, submissionId: '00000000-0000-4000-8000-000000000002' }))).status).toBe(429);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_requests').get()).toEqual({ n: 1 });
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(1);
});

it('re-reads a unique-index race and returns only a matching stored brief', async () => {
  const racing = { prepare: db.prepare.bind(db), batch: async () => {
    sql.prepare(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,created_at,updated_at,submission_id)
      VALUES ('raced','software','workflow','Alex','Alex@Example.com','Stored summary',?,'new','now','now',?)`)
      .run(JSON.stringify({ path: 'workflow', today: 'Stored answer', audience: 'Our team', firstResult: 'Stored summary', timing: 'flexible', budgetStatus: 'exploring', approver: 'self' }), id);
    throw new Error('UNIQUE constraint failed');
  } } as unknown as D1Database;
  const response = await POST(context(base, { db: racing }));
  expect(response.status).toBe(200);
  expect((await response.json() as { brief: Record<string, string> }).brief.today).toBe('Stored answer');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(0);
});

it('preserves input and clears success limit after a storage failure', async () => {
  const failing = { prepare: db.prepare.bind(db), batch: async () => { throw new Error('D1 unavailable'); } } as unknown as D1Database;
  const response = await POST(context(base, { db: failing }));
  expect(response.status).toBe(503);
  expect((await response.json() as { error: string }).error).toContain('Your details are still here');
  expect(kv.delete).toHaveBeenCalledWith('rl:software:0.0.0.0');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(1);
  const alertCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('api.resend.com'))!;
  const alert = JSON.parse(alertCall[1]?.body as string);
  expect(alert.text).toContain('/api/software-inquiry');
  expect(alert.text).toContain('d1-write-failed');
  expect(JSON.stringify(alert)).not.toMatch(/First line|Second line|Alex@Example|Example Studio|One place to see/);
});

it('does not undo a saved request when the owner notice fails', async () => {
  vi.mocked(fetch).mockImplementation(async url => String(url).includes('siteverify') ? { ok: true, json: async () => ({ success: true }) } as Response : Promise.reject(new Error('Resend failed')));
  expect((await POST(context())).status).toBe(200);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_requests').get()).toEqual({ n: 1 });
});

it('rejects invalid answers, unknown choices, line breaks, and unknown keys', () => {
  for (const [key, value] of [['path', 'other'], ['today', ''], ['name', ''], ['email', ''], ['audience', ''], ['timing', ''], ['budgetStatus', ''], ['approver', ''], ['audience', 'x'.repeat(1001)], ['firstResult', ''], ['name', 'A\nB'], ['email', 'bad'], ['company', 'A\nB'], ['timing', 'soon'], ['budgetStatus', 'nope'], ['approver', 'nope'], ['submissionId', 'bad']] as const) {
    const result = validateSoftwareInquiry({ ...base, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBeTruthy();
  }
  const parsed = validateSoftwareInquiry({ ...base, extra: 'secret' });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value).not.toHaveProperty('extra');
});

it('guards origin, content type, size, and missing bindings', async () => {
  expect((await POST(context(base, { origin: 'https://evil.example' }))).status).toBe(403);
  expect((await POST(context('{}', { type: 'text/plain' }))).status).toBe(415);
  expect((await POST(context({ padding: 'x'.repeat(33000) }))).status).toBe(413);
  expect((await POST(context(base, { db: null }))).status).toBe(503);
  expect((await POST(context(base, { token: null }))).status).toBe(503);
  expect((await POST(context(base, { rate: null }))).status).toBe(503);
});

it('reports simultaneous field errors, including empty choices and controls', () => {
  const result = validateSoftwareInquiry({ ...base, name: '', audience: '', today: '\u0001', timing: '', budgetStatus: '', approver: '' });
  expect(result.ok).toBe(false);
  if (!result.ok) for (const key of ['name', 'audience', 'today', 'timing', 'budgetStatus', 'approver']) expect(result.errors[key]).toBeTruthy();
});

it('alerts and preserves input when the duplicate lookup fails', async () => {
  const failing = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) }) } as unknown as D1Database;
  const response = await POST(context(base, { db: failing }));
  expect(response.status).toBe(503);
  expect((await response.json() as { error: string }).error).toContain('Your details are still here');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(1);
});

it('rejects overlength and line breaks in every text field', () => {
  const lengths = { today: 2000, audience: 1000, firstResult: 2000, name: 100, email: 120, company: 120, timingReason: 500, budgetNote: 200, approverRole: 120 };
  for (const [key, max] of Object.entries(lengths)) {
    const result = validateSoftwareInquiry({ ...base, [key]: 'a'.repeat(max + 1) });
    expect(result.ok, key).toBe(false);
    if (!result.ok) expect(result.errors[key], key).toBe(`Keep this under ${max} characters.`);
  }
  for (const key of ['name', 'email', 'company', 'timingReason', 'budgetNote', 'approverRole']) {
    const result = validateSoftwareInquiry({ ...base, [key]: 'a\nb' });
    expect(result.ok, key).toBe(false);
    if (!result.ok) expect(result.errors[key], key).toBeTruthy();
  }
});

it('does not reveal a raced brief to a different email', async () => {
  const racing = { prepare: db.prepare.bind(db), batch: async () => {
    sql.prepare(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,created_at,updated_at,submission_id)
      VALUES ('raced','software','workflow','Other','other@example.com','Private stored summary',?,'new','now','now',?)`)
      .run(JSON.stringify({ path: 'workflow', today: 'Private stored answer', audience: 'Other team', firstResult: 'Private stored summary', timing: 'flexible', budgetStatus: 'exploring', approver: 'self' }), id);
    throw new Error('UNIQUE constraint failed');
  } } as unknown as D1Database;
  const response = await POST(context(base, { db: racing }));
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).not.toContain('Private stored');
});

it('keeps the approver role only for someone else', () => {
  const other = validateSoftwareInquiry({ ...base, approver: 'other', approverRole: 'Director' });
  expect(other.ok).toBe(true);
  if (other.ok) expect(other.value.approverRole).toBe('Director');
  const self = validateSoftwareInquiry(base);
  expect(self.ok).toBe(true);
  if (self.ok) expect(self.value.approverRole).toBe('');
});


it('uses plain exact messages for choices, line breaks, controls, and lone surrogates', () => {
  const cases = [
    ['path', '', 'Choose a starting point.'],
    ['timing', '', 'Choose one.'],
    ['budgetStatus', '', 'Choose one.'],
    ['approver', '', 'Choose one.'],
    ['name', 'A\nB', 'Use one line.'],
    ['today', '\u0001', 'Remove control characters.'],
    ['today', '\ud800', 'Remove control characters.'],
  ] as const;
  for (const [key, value, message] of cases) {
    const result = validateSoftwareInquiry({ ...base, [key]: value });
    expect(result.ok, key).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBe(message);
  }
});

it('renders saved script text and multiline answers verbatim for safe Astro text output', () => {
  const request = { name: 'Alex', email: 'alex@example.com', details: { ...base, today: '<script>alert(1)</script>\nSecond line' } } as any;
  expect(softwareBrief(request).today).toBe('<script>alert(1)</script>\nSecond line');
});

it('omits approver role from the API receipt when approver is self', async () => {
  const response = await POST(context());
  expect(response.status).toBe(200);
  expect((await response.json() as { brief: Record<string, string> }).brief).not.toHaveProperty('approverRole');
});

it('treats an oversized saved detail as a field error without an urgent alert', async () => {
  const oversized = { prepare: db.prepare.bind(db), batch: async () => { throw new Error('Request details are too large.'); } } as unknown as D1Database;
  const response = await POST(context(base, { db: oversized }));
  expect(response.status).toBe(400);
  expect((await response.json() as { errors: Record<string, string> }).errors).toEqual({ _form: 'Keep the brief shorter and try again.' });
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(0);
});
