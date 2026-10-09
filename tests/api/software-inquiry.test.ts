import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/software-inquiry';
import { softwareBrief, softwareRequest, validateSoftwareInquiry } from '~/lib/software-inquiry';
import { RequestDetailsTooLargeError } from '~/lib/owner-requests';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const id = '00000000-0000-4000-8000-000000000001';
const base = { path: 'workflow', today: 'First line\nSecond line', audience: 'Our team', firstResult: 'One place to see next steps.', name: 'Alex', email: 'Alex@Example.com', company: 'Example Studio', timing: 'flexible', timingReason: '', budgetStatus: 'exploring', budgetNote: '', approver: 'self', approverRole: 'ignored', turnstileToken: 'test', submissionId: id };
let sql: InstanceType<typeof DatabaseSync>;
let db: D1Database;
let kv: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
let stored: Map<string, string>;
function context(input: unknown = base, options: { origin?: string; type?: string; db?: D1Database | null; token?: string | null; rate?: typeof kv | null } = {}) {
  return { request: new Request('https://thesuperhuman.us/api/software-inquiry', { method: 'POST', headers: { origin: options.origin ?? 'https://thesuperhuman.us', 'content-type': options.type ?? 'application/json' }, body: typeof input === 'string' ? input : JSON.stringify(input) }), locals: { runtime: { env: { MUSIC_DB: options.db === undefined ? db : options.db, TURNSTILE_SECRET_KEY: options.token === undefined ? 'test' : options.token, RATE_LIMIT: options.rate === undefined ? kv : options.rate, RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'from@example.com', CONTACT_TO_EMAIL: 'inbox@example.com' } } } } as any;
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

it('stores and returns only the selected idea questions, including the optional signal', async () => {
  const idea = { ...base, path: 'idea', idea: 'Volunteers need a simpler way to find shifts.\nThey use group texts now.', audienceToday: 'Food bank volunteers', firstVersion: 'See and claim one open shift.', signal: 'Repeat use after a month', today: 'inactive' };
  const response = await POST(context(idea));
  expect(response.status).toBe(200);
  const brief = (await response.json() as { brief: Record<string, string> }).brief;
  expect(Object.keys(brief).slice(0, 5)).toEqual(['path', 'idea', 'audienceToday', 'firstVersion', 'signal']);
  expect(brief.idea).toBe(idea.idea);
  expect(brief).not.toHaveProperty('today');
  const saved = sql.prepare('SELECT service_id,summary,details_json FROM owner_requests').get() as { service_id: string; summary: string; details_json: string };
  expect(saved.service_id).toBe('idea');
  expect(saved.summary).toBe('Volunteers need a simpler way to find shifts.');
  expect(JSON.parse(saved.details_json)).not.toHaveProperty('today');
  const notice = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('api.resend.com'))!;
  const body = JSON.parse(notice[1]?.body as string);
  expect(body.text).toContain('What’s the idea?\nVolunteers need a simpler way to find shifts.');
});

it('validates each idea answer with the same plain messages and drops unknown keys', () => {
  const idea = { ...base, path: 'idea', idea: 'An idea', audienceToday: 'Volunteers', firstVersion: 'Claim a shift' };
  for (const [key, value, message] of [
    ['idea', '', 'This answer is required.'], ['audienceToday', '', 'This answer is required.'],
    ['firstVersion', '', 'This answer is required.'], ['idea', 'x'.repeat(1001), 'Keep this under 1000 characters.'],
    ['audienceToday', 'x'.repeat(1001), 'Keep this under 1000 characters.'], ['firstVersion', 'x'.repeat(1001), 'Keep this under 1000 characters.'],
    ['signal', 'x'.repeat(501), 'Keep this under 500 characters.'], ...(['idea', 'audienceToday', 'firstVersion', 'signal'] as const).map(key => [key, '\u0001', 'Remove control characters.'] as const),
  ] as const) {
    const result = validateSoftwareInquiry({ ...idea, [key]: value });
    expect(result.ok, key).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBe(message);
  }
  const result = validateSoftwareInquiry({ ...idea, today: 'inactive', unknown: 'dropped' });
  expect(result.ok).toBe(true);
  if (result.ok) { expect(result.value).not.toHaveProperty('today'); expect(result.value).not.toHaveProperty('unknown'); expect(result.value).toMatchObject({ signal: '' }); }
});

it('keeps an emoji intact at the summary cutoff', () => {
  const parsed = validateSoftwareInquiry({ ...base, firstResult: `${'a'.repeat(116)}😀${'b'.repeat(10)}` });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(softwareRequest(parsed.value).summary).toBe(`${'a'.repeat(116)}😀…`);
});

it('keeps a joined emoji intact at the summary cutoff', () => {
  const parsed = validateSoftwareInquiry({ ...base, firstResult: `${'a'.repeat(116)}👩‍💻${'b'.repeat(10)}` });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(softwareRequest(parsed.value).summary).toBe(`${'a'.repeat(116)}👩‍💻…`);
});

it('orders workflow questions in the saved brief', () => {
  const parsed = validateSoftwareInquiry(base);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    const request = softwareRequest(parsed.value);
    expect(Object.keys(softwareBrief(request as any)).slice(0, 4)).toEqual(['path', 'today', 'audience', 'firstResult']);
  }
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
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(2);
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
  expect(JSON.stringify(alert)).not.toMatch(/alex|first line|second line|our team|example studio|one place to see/i);
});

it('does not undo a saved request when the owner notice fails', async () => {
  vi.mocked(fetch).mockImplementation(async url => String(url).includes('siteverify') ? { ok: true, json: async () => ({ success: true }) } as Response : Promise.reject(new Error('Resend failed')));
  expect((await POST(context())).status).toBe(200);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_requests').get()).toEqual({ n: 1 });
});

it('rejects invalid answers, unknown choices, line breaks, and unknown keys', () => {
  const expectedErrors: Record<string, string> = { path: 'Choose a starting point.', name: 'Add your name.', email: 'Add a valid email address.', timing: 'Choose one.', budgetStatus: 'Choose one.', approver: 'Choose one.', submissionId: 'Invalid submission ID.' };
  for (const [key, value] of [['path', 'other'], ['today', ''], ['name', ''], ['email', ''], ['audience', ''], ['timing', ''], ['budgetStatus', ''], ['approver', ''], ['audience', 'x'.repeat(1001)], ['firstResult', ''], ['name', 'A\nB'], ['email', 'bad'], ['company', 'A\nB'], ['timing', 'soon'], ['budgetStatus', 'nope'], ['approver', 'nope'], ['submissionId', 'bad']] as const) {
    const result = validateSoftwareInquiry({ ...base, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBe(value.includes('\n') ? 'Use one line.' : value.length === 1001 ? 'Keep this under 1000 characters.' : expectedErrors[key] ?? 'This answer is required.');
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
  if (!result.ok) expect(result.errors).toMatchObject({ name: 'Add your name.', audience: 'This answer is required.', today: 'Remove control characters.', timing: 'Choose one.', budgetStatus: 'Choose one.', approver: 'Choose one.' });
});

it('uses plain messages for missing fields, wrong types, and non-object bodies', () => {
  for (const [input, field, message] of [
    [{ ...base, today: undefined }, 'today', 'This answer is required.'],
    [{ ...base, audience: 42 }, 'audience', 'This answer is required.'],
    [{ ...base, timing: undefined }, 'timing', 'Choose one.'],
    [{ ...base, path: 5 }, 'path', 'Choose a starting point.'],
    [[], '_form', 'Please send the form again.'],
  ] as const) {
    const result = validateSoftwareInquiry(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBe(message);
  }
});

it('alerts and preserves input when the duplicate lookup fails', async () => {
  const failing = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1 unavailable'); } }) }) } as unknown as D1Database;
  const response = await POST(context(base, { db: failing }));
  expect(response.status).toBe(503);
  expect((await response.json() as { error: string }).error).toContain('Your details are still here');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(1);
  const alertCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('api.resend.com'))!;
  expect(JSON.stringify(JSON.parse(alertCall[1]?.body as string))).not.toMatch(/alex|first line|second line|our team|example studio|one place to see/i);
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
    if (!result.ok) expect(result.errors[key], key).toBe('Use one line.');
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
  const oversized = { prepare: db.prepare.bind(db), batch: async () => { throw new RequestDetailsTooLargeError(); } } as unknown as D1Database;
  const response = await POST(context(base, { db: oversized }));
  expect(response.status).toBe(400);
  expect((await response.json() as { errors: Record<string, string> }).errors).toEqual({ _form: 'Keep the brief shorter and try again.' });
  expect(kv.delete).toHaveBeenCalledWith('rl:software:0.0.0.0');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(0);
});


it('emails only answered fields to the client with the saved title and configured contact Reply-To', async () => {
  const response = await POST(context({ ...base, name: 'Alex Example', today: '<script>first</script>\nSecond line' }));
  expect(await response.json()).toMatchObject({ ok: true, clientCopyStatus: 'sent' });
  const emails = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com')).map(([, init]) => JSON.parse(init!.body as string));
  const copy = emails.find(email => email.to[0] === 'alex@example.com');
  expect(copy).toMatchObject({ from: 'from@example.com', subject: 'Your brief: One place to see next steps.', reply_to: 'inbox@example.com' });
  expect(copy.text).toContain('Hi Alex,');
  expect(copy.text).toContain("I'll read it myself and reply within two business days with a fixed-price first milestone, or a question or two.");
  expect(copy.text).toContain('What happens today?\n<script>first</script>\nSecond line');
  expect(copy.text).not.toMatch(/Not provided|Why this timing|Budget amount|Their role/);
  expect(copy.html).toContain('&lt;script&gt;first&lt;/script&gt;');
  expect(copy.html).not.toContain('<script>first');
  expect(JSON.parse(sql.prepare('SELECT details_json FROM owner_requests').get().details_json).clientCopyStatus).toBe('sent');
});

it.each([['rejected', 'failed'], ['timeout', 'uncertain']] as const)('keeps the saved brief after a client copy %s', async (outcome, status) => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes('siteverify')) return { ok: true, json: async () => ({ success: true }) } as Response;
    if (JSON.parse(init!.body as string).to[0] === 'alex@example.com') {
      if (outcome === 'timeout') throw new Error('timeout');
      return new Response('', { status: 422 });
    }
    return new Response('', { status: 200 });
  });
  expect(await (await POST(context())).json()).toMatchObject({ ok: true, clientCopyStatus: status });
  expect(JSON.parse(sql.prepare('SELECT details_json FROM owner_requests').get().details_json).clientCopyStatus).toBe(status);
  expect(await (await POST(context())).json()).toMatchObject({ ok: true, clientCopyStatus: status });
});

it('retries a failed brief copy once and blocks sent, closed and unconfirmed retries', async () => {
  const { POST: retry } = await import('~/pages/api/owner/requests/[id]/brief-copy');
  await POST(context());
  const requestId = sql.prepare('SELECT id FROM owner_requests').get().id;
  const retryContext = (confirmedNotSent = false, owner = true) => ({ ...context(), params: { id: requestId }, request: new Request('https://thesuperhuman.us/api/owner/requests/r/brief-copy', { method:'POST', headers:{ origin:'https://thesuperhuman.us','content-type':'application/json' }, body:JSON.stringify({ action:'send', confirmedNotSent }) }), locals:{ ...context().locals, owner:owner ? {email:'owner@example.com'} : null } } as any);
  const set = (status: string, age: number) => sql.prepare("UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus',?,'$.clientCopyAttemptedAt',?)").run(status,new Date(Date.now()-age).toISOString());
  expect((await retry(retryContext(false,false))).status).toBe(403);
  set('failed',0);
  expect((await retry(retryContext())).status).toBe(200);
  expect((await retry(retryContext())).status).toBe(409);
  set('uncertain',120_000);
  expect((await retry(retryContext())).status).toBe(409);
  set('uncertain',0);
  expect((await retry(retryContext(true))).status).toBe(409);
  set('uncertain',120_000);
  expect((await retry(retryContext(true))).status).toBe(200);
  set('failed',120_000);
  sql.exec("UPDATE owner_requests SET status='withdrawn'");
  expect((await retry(retryContext())).status).toBe(409);
});

it('keeps delivery uncertain after sending when the final status write fails', async () => {
  const batch = db.batch.bind(db);
  vi.spyOn(db,'batch').mockImplementation(async (statements: any[]) => {
    if (statements.some(item => item.query.includes("'$.clientCopyStatus',?"))) throw new Error('status write failed');
    return batch(statements);
  });
  expect(await (await POST(context())).json()).toMatchObject({ok:true,clientCopyStatus:'uncertain'});
  const details = JSON.parse(sql.prepare('SELECT details_json FROM owner_requests').get().details_json);
  expect(details.clientCopyStatus).toBe('uncertain');
  expect(details.clientCopyAttemptedAt).toBeTruthy();
  expect(await (await POST(context())).json()).toMatchObject({ok:true,clientCopyStatus:'uncertain'});
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('api.resend.com'))).toHaveLength(2);
});

it.each(['claim', 'construction', 'config'] as const)('records a pre-send %s failure and returns an error on owner retry', async (failure) => {
  const ctx = context();
  if (failure === 'config') delete ctx.locals.runtime.env.CONTACT_TO_EMAIL;
  if (failure === 'claim') {
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((query: string) => {
      if (query.includes("'$.clientCopyStatus','uncertain'")) throw new Error('claim failed');
      return prepare(query);
    });
  }
  if (failure === 'construction') {
    const emails = await import('~/lib/client-emails');
    vi.spyOn(emails, 'softwareBriefEmail').mockImplementation(() => { throw new Error('construction failed'); });
  }
  try {
    expect(await (await POST(ctx)).json()).toMatchObject({ ok: true, clientCopyStatus: 'failed' });
    expect(JSON.parse(sql.prepare('SELECT details_json FROM owner_requests').get().details_json).clientCopyStatus).toBe('failed');
    const { POST: retry } = await import('~/pages/api/owner/requests/[id]/brief-copy');
    const response = await retry({ ...ctx, params: { id: sql.prepare('SELECT id FROM owner_requests').get().id },
      locals: { ...ctx.locals, owner: { email: 'owner@example.com' } },
      request: new Request('https://thesuperhuman.us/api/owner/requests/r/brief-copy', { method: 'POST', headers: { origin: 'https://thesuperhuman.us', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'send' }) }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(JSON.parse(sql.prepare('SELECT details_json FROM owner_requests').get().details_json).clientCopyStatus).toBe('failed');
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).includes('api.resend.com') && JSON.parse(init!.body as string).to?.[0] === 'alex@example.com')).toHaveLength(0);
  } finally { vi.restoreAllMocks(); }
});
