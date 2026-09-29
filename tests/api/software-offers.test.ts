import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/owner/requests/[id]/software';
import { getLinkedOffer, hashOfferToken } from '~/lib/software-offers';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;
const terms = { outcome: 'Onboarding', summary: 'A shared view.', milestones: [{ name: 'Tracker', deliverables: ['Status view'], acceptance: ['Add a client and identify their next action.'], feeCents: 240000 }], clientInputs: '', exclusions: '', timing: '', paymentMode: 'standard' };
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,name,email,summary,status,created_at,updated_at) VALUES ('software','software','Alex Example','alex@example.com','Tool','new','now','now')`);
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values), first: async () => sql.prepare(query).get(...args) ?? null, all: async () => ({ results: sql.prepare(query).all(...args) }) });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN'); try { const result = items.map(item => ({ results: /RETURNING|^SELECT/i.test(item.query) ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) })); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => { sql.close(); vi.unstubAllGlobals(); });
async function call(body: unknown, owner = true) {
  return POST({ params: { id: 'software' }, request: new Request('https://thesuperhuman.us/api/owner/requests/software/software', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env: { MUSIC_DB: db, RESEND_API_KEY: 'fake', CONTACT_FROM_EMAIL: 'sender@example.com', OWNER_EMAIL: 'owner@example.com' } } } } as any);
}
async function draft(expectedUpdatedAt: string | null = null) { const response = await call({ action: 'draft', terms, expectedUpdatedAt }); expect(response.status).toBe(200); return response.json() as Promise<any>; }
async function send(value: any) { const response = await call({ action: 'send', version: value.version, expectedUpdatedAt: value.updatedAt }); expect(response.status).toBe(200); return response.json() as Promise<any>; }
it.each(['fit','draft','send','revoke','question','decline'])('rejects unauthenticated %s', async action => {
  const response = await call({ action }, false); expect(response.status).toBe(403); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(fetch).not.toHaveBeenCalled();
});
it('saves manual fit and writes the owner actor in the same batch', async () => {
  expect((await call({ action: 'fit', label: 'potential-fit', note: 'Clarify users.' })).status).toBe(200);
  expect(sql.prepare('SELECT label,note,updated_by FROM software_fit_reviews').get()).toEqual({ label: 'potential-fit', note: 'Clarify users.', updated_by: 'owner@example.com' });
  expect(sql.prepare('SELECT action,actor FROM owner_request_audit').get()).toEqual({ action: 'fit-reviewed', actor: 'owner@example.com' });
  expect((await call({ action: 'fit', label: 'potential-fit', note: 'x'.repeat(501) })).status).toBe(400);
});
it('updates one draft, never emails on save, and refuses stale writes and sends', async () => {
  const first = await draft(); const next = await draft(first.updatedAt); expect(next.version).toBe(1);
  expect(sql.prepare('SELECT COUNT(*) AS n FROM software_offers').get()).toEqual({ n: 1 }); expect(fetch).not.toHaveBeenCalled();
  expect((await call({ action: 'draft', terms, expectedUpdatedAt: null })).status).toBe(409);
  expect((await call({ action: 'send', version: 1, expectedUpdatedAt: 'stale' })).status).toBe(409);
  expect((await call({ action: 'draft', terms: { ...terms, milestones: [] }, expectedUpdatedAt: next.updatedAt })).status).toBe(400);
});
it('sends a saved version, supersedes it with the next draft and exposes only the latest sent version', async () => {
  const first = await send(await draft()); const token = first.link.split('/').pop();
  expect(await getLinkedOffer(db, token)).toMatchObject({ version: 1, status: 'sent' });
  expect(sql.prepare('SELECT token_hash FROM software_offer_links').get()).toEqual({ token_hash: await hashOfferToken(token) });
  expect(JSON.stringify(sql.prepare('SELECT * FROM software_offer_links').get())).not.toContain(token);
  const secondDraft = await draft(); expect(secondDraft.version).toBe(2);
  expect(await getLinkedOffer(db, token)).toMatchObject({ version: 1 });
  const second = await send(secondDraft);
  expect(sql.prepare('SELECT version,status FROM software_offers ORDER BY version').all()).toEqual([{ version:1,status:'superseded' },{ version:2,status:'sent' }]);
  expect(await getLinkedOffer(db, second.link.split('/').pop())).toMatchObject({ version: 2 });
  expect(await getLinkedOffer(db, token)).toBeNull();
  expect(sql.prepare("SELECT action,actor,note FROM owner_request_audit WHERE action='offer-sent' ORDER BY id DESC LIMIT 1").get()).toEqual({ action:'offer-sent',actor:'owner@example.com',note:'Offer v2 sent' });
  const payloads = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(payloads[0]).toMatchObject({ to:['alex@example.com'], subject:'Your project offer: Onboarding', reply_to:'owner@example.com', text: expect.stringContaining('Hi Alex,\n\nHere’s the offer for Onboarding:') });
  expect(payloads[1]).toMatchObject({ to:['owner@example.com'], subject:'Copy: Your project offer: Onboarding' });
});
it('revokes and reissues access without mutating sent terms', async () => {
  const sent = await send(await draft()); const token = sent.link.split('/').pop();
  expect((await call({ action:'revoke' })).status).toBe(200); expect(await getLinkedOffer(db, token)).toBeNull();
  const row = sql.prepare("SELECT * FROM software_offers WHERE status='sent'").get();
  const reissued = await send({ version: row.version, updatedAt: row.updated_at });
  expect(sql.prepare("SELECT * FROM software_offers WHERE status='sent'").get()).toEqual(row);
  expect(await getLinkedOffer(db, reissued.link.split('/').pop())).toMatchObject({ version: 1 });
  expect((await call({ action: 'send', version: row.version, expectedUpdatedAt: row.updated_at })).status).toBe(409);
});
it.each(['question','decline'])('%s sends exact text and owner copy before auditing', async action => {
  expect((await call({ action, text:'Thanks for the brief.' })).status).toBe(200);
  const calls = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  const subject = action === 'question' ? 'A question about your project brief' : 'About your project brief';
  expect(calls[0]).toMatchObject({ subject, text:'Thanks for the brief.\n\nKazon', to:['alex@example.com'] });
  expect(calls[1]).toMatchObject({ subject:`Copy: ${subject}`, to:['owner@example.com'] });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status: action === 'decline' ? 'resolved' : 'new' });
  expect(sql.prepare('SELECT action FROM owner_request_audit').get()).toEqual({ action: action === 'question' ? 'question-sent' : 'declined' });
});
it.each(['question','decline'])('%s changes nothing on client email failure', async action => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
  const response = await call({ action, text:'Thanks.' }); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ message:'The email didn’t send. Nothing changed. Try again.' });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'new' });
  expect(sql.prepare('SELECT * FROM owner_request_audit').all()).toEqual([]);
});
it('keeps a sent offer and accessible link after email failure', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
  const result = await send(await draft()); expect(result.emailSent).toBe(false);
  expect(await getLinkedOffer(db, result.link.split('/').pop())).toMatchObject({ status:'sent' });
});
it('reports failed owner copy truthfully without resending or undoing the client email', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{}', { status: 503 }));
  const response = await call({ action:'decline', text:'Thanks.' }); expect(await response.json()).toMatchObject({ ok:true, copySent:false });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'resolved' });
});
it('blocks withdrawn or retention-cleared requests', async () => {
  sql.exec("UPDATE owner_requests SET status='withdrawn' WHERE id='software'");
  expect((await call({ action:'question', text:'Hello.' })).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
});

it('does not overwrite a withdrawal while decline email is pending', async () => {
  vi.mocked(fetch).mockImplementation(async () => { sql.exec("UPDATE owner_requests SET status='withdrawn',updated_at='later' WHERE id='software'"); return new Response('{}'); });
  const response = await call({ action:'decline', text:'Thanks.' }); expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ message: expect.stringContaining('client email was sent') });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'withdrawn' });
  expect(sql.prepare('SELECT * FROM owner_request_audit').all()).toEqual([]);
});
