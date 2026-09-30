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
async function call(body: unknown, owner = true, origin?: string) {
  return POST({ params: { id: 'software' }, request: new Request('https://thesuperhuman.us/api/owner/requests/software/software', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env: { MUSIC_DB: db, SITE_ORIGIN: origin, RESEND_API_KEY: 'fake', CONTACT_FROM_EMAIL: 'sender@example.com', OWNER_EMAIL: 'owner@example.com' } } } } as any);
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
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
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
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
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
it.each(['question','decline'])('%s leaves the request open on client email failure', async action => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
  const response = await call({ action, text:'Thanks.' }); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ uncertain:true, message:action === 'decline' ? 'The email service didn’t confirm. The offer is withdrawn and its link is closed. Check Resend before retrying.' : 'The email service didn’t confirm. Check Resend before retrying. Nothing was recorded.' });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'new' });
  expect(sql.prepare('SELECT * FROM owner_request_audit').all()).toEqual([]);
});
it('keeps a sent offer and accessible link after email failure', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }));
  const result = await send(await draft()); expect(result.emailSent).toBe(false); expect(result.uncertain).toBe(true);
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

it.each(['question','decline'])('%s changes nothing on confirmed rejection', async action => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 422 }));
  const response = await call({ action, text:'Thanks.' });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ uncertain:false, message:action === 'decline' ? 'The email didn’t send. The offer is withdrawn and its link is closed; nothing else changed. Try again.' : 'The email didn’t send. Nothing changed. Try again.' });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'new' });
  expect(sql.prepare('SELECT * FROM owner_request_audit').all()).toEqual([]);
});
it.each(['question','decline'])('%s changes nothing on timeout', async action => {
  vi.mocked(fetch).mockRejectedValue(new Error('timeout'));
  const response = await call({ action, text:'Thanks.' });
  expect(await response.json()).toMatchObject({ ok:false, uncertain:true });
  expect(sql.prepare('SELECT * FROM owner_request_audit').all()).toEqual([]);
});
it('uses the isolated site origin for the client link and email', async () => {
  const saved = await draft();
  const response = await call({ action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt }, true, 'https://preview.example.workers.dev');
  const result = await response.json() as { link:string };
  expect(result.link).toMatch(/^https:\/\/preview.example.workers.dev\/offer\//);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).text).toContain(result.link);
});
it('decline withdraws live and draft offers and revokes access, but ordinary resolution keeps access', async () => {
  const sent = await send(await draft()), token = sent.link.split('/').pop();
  await draft();
  sql.exec("UPDATE owner_requests SET status='resolved'");
  expect(await getLinkedOffer(db,token)).toMatchObject({ status:'sent' });
  sql.exec("UPDATE owner_requests SET status='reviewed'; UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
  expect((await call({ action:'decline', text:'Thanks.' })).status).toBe(200);
  expect(await getLinkedOffer(db,token)).toBeNull();
  expect(sql.prepare('SELECT status FROM software_offers').all()).toEqual([{ status:'withdrawn' }, { status:'withdrawn' }]);
  expect(sql.prepare('SELECT revoked_at FROM software_offer_links').get().revoked_at).toBeTruthy();
});
it('rejects software commands on other request kinds', async () => {
  sql.exec("UPDATE owner_requests SET kind='purchase'");
  expect((await call({ action:'question', text:'Thanks.' })).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it('loses a concurrent send inside the batch without replacing its link or emailing', async () => {
  const saved = await draft(), original = db.batch.bind(db);
  const winnerHash = await hashOfferToken('w'.repeat(43));
  db.batch = async items => {
    sql.prepare("UPDATE software_offers SET status='sent',sent_at='winner',updated_at='winner' WHERE status='draft'").run();
    sql.prepare("INSERT INTO software_offer_links VALUES ('software',?,'winner',NULL)").run(winnerHash);
    return original(items);
  };
  expect((await call({ action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt })).status).toBe(409);
  expect(sql.prepare('SELECT token_hash FROM software_offer_links').get()).toEqual({ token_hash:winnerHash });
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action='offer-sent'").all()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('builds the client URL before saving sent state', async () => {
  const saved = await draft();
  const response = await call({ action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt }, true, 'invalid origin');
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ message:'The offer link couldn’t be built. Check SITE_ORIGIN. Nothing was sent.' });
  expect(sql.prepare('SELECT status FROM software_offers').get()).toEqual({ status:'draft' });
  expect(sql.prepare('SELECT * FROM software_offer_links').all()).toEqual([]);
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action='offer-sent'").all()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it('returns confirmed rejection for an offer email rejected by the provider', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status:422 }));
  const result = await send(await draft());
  expect(result).toMatchObject({ emailSent:false, uncertain:false, copySent:false });
  expect(fetch).toHaveBeenCalledOnce();
});
it.each(['resolve','decline'])('rejects offer editing and sending after %s, then permits both after reopening', async action => {
  const saved = await draft();
  const { POST: changeRequest } = await import('~/pages/api/owner/requests/[id]');
  const change = (action:string) => changeRequest({ params:{ id:'software' }, request:new Request('https://example.com/api/owner/requests/software', { method:'POST', body:JSON.stringify({ action }) }), locals:{ owner:{ email:'owner@example.com' },runtime:{ env:{ MUSIC_DB:db } } } } as any);
  expect((await (action === 'decline' ? call({ action:'decline', text:'Thanks.' }) : change('resolve'))).status).toBe(200);
  vi.mocked(fetch).mockClear();
  for (const command of [{ action:'draft', terms, expectedUpdatedAt:saved.updatedAt }, { action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt }]) {
    const response = await call(command); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message:'This request is resolved. Reopen it to make a new offer.' });
  }
  expect(fetch).not.toHaveBeenCalled();
  expect((await change('reopen')).status).toBe(200);
  expect((await send(await draft(action === 'decline' ? null : saved.updatedAt))).emailSent).toBe(true);
});

it('advances fit timestamps, rejects a stale tab and changes the retention snapshot', async () => {
  const { previewOwnerRetention } = await import('../../scripts/owner-retention.mjs');
  sql.exec("UPDATE owner_requests SET contact_delete_after='2020-01-01T00:00:00Z'");
  const database = { query: async (query: string) => sql.prepare(query).all() };
  const before = await previewOwnerRetention(database, 'local');
  const response = await call({ action:'fit', label:'potential-fit', note:'First', expectedRequestUpdatedAt:'now' });
  const result = await response.json() as any;
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT updated_at FROM owner_requests').get().updated_at).toBe(result.updatedAt);
  expect((await previewOwnerRetention(database, 'local')).requestSourceHash).not.toBe(before.requestSourceHash);
  expect((await call({ action:'fit', label:'stated-mismatch', note:'Stale', expectedRequestUpdatedAt:'now' })).status).toBe(409);
  expect(sql.prepare('SELECT note FROM software_fit_reviews').get().note).toBe('First');
});
it('returns the current draft timestamp for a recoverable save conflict', async () => {
  const saved = await draft();
  const conflict = await call({ action:'draft', terms, expectedUpdatedAt:'stale' });
  expect(conflict.status).toBe(409);
  const result = await conflict.json() as any;
  expect(result.updatedAt).toBe(saved.updatedAt);
  expect((await call({ action:'draft', terms:{ ...terms, outcome:'Newer edits' }, expectedUpdatedAt:result.updatedAt })).status).toBe(200);
  expect(JSON.parse(sql.prepare('SELECT terms_json FROM software_offers').get().terms_json).outcome).toBe('Newer edits');
});
it('returns a newer draft timestamp when the guarded save batch races', async () => {
  const saved = await draft();
  const batch = db.batch.bind(db);
  db.batch = (async (items: D1PreparedStatement[]) => {
    sql.exec("UPDATE software_offers SET updated_at='concurrent'");
    return batch(items);
  }) as D1Database['batch'];
  const response = await call({ action:'draft', terms, expectedUpdatedAt:saved.updatedAt });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ updatedAt:'concurrent', message:expect.stringContaining('Save again') });
});
it.each(['resolved','withdrawn'])('rejects hidden fit/question actions for %s but permits link revocation', async status => {
  await send(await draft());
  sql.prepare('UPDATE owner_requests SET status=?').run(status);
  vi.mocked(fetch).mockClear();
  for (const command of [{ action:'fit',label:'potential-fit',note:'' }, { action:'question',text:'Hello' }]) expect((await call(command)).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
  expect((await call({ action:'revoke' })).status).toBe(200);
});
it('rejects generic actions from a tab predating the fit save', async () => {
  const { POST: requestPost } = await import('~/pages/api/owner/requests/[id]');
  const fit = await call({ action:'fit',label:'potential-fit',note:'Current',expectedRequestUpdatedAt:'now' });
  const { updatedAt } = await fit.json() as any;
  const action = (expectedUpdatedAt:string) => requestPost({ params:{ id:'software' }, request:new Request('https://thesuperhuman.us/api/owner/requests/software',{ method:'POST',body:JSON.stringify({ action:'note',note:'New note',expectedUpdatedAt }) }), locals:{ owner:{ email:'owner@example.com' },runtime:{ env:{ MUSIC_DB:db } } } } as any);
  expect((await action('now')).status).toBe(409);
  expect((await action(updatedAt)).status).toBe(200);
});

it('decline batch rolls back when a project starts after its pre-check', async () => {
  await send(await draft());
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
  vi.mocked(fetch).mockClear();
  const batch = db.batch.bind(db);
  db.batch = (async (items: D1PreparedStatement[]) => {
    sql.exec("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) SELECT 'software',id,terms_json,'standard','now','now','now','owner','now','now' FROM software_offers WHERE status='sent'");
    return batch(items);
  }) as D1Database['batch'];
  const before = sql.prepare('SELECT * FROM owner_requests').all();
  const response = await call({action:'decline',text:'Thanks.'});
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ok:false,message:'This project has started. Use the project messages.'});
  expect(fetch).not.toHaveBeenCalled();
  expect(sql.prepare('SELECT * FROM owner_requests').all()).toEqual(before);
  expect(sql.prepare('SELECT status FROM software_offers').get()).toEqual({status:'sent'});
  expect(sql.prepare('SELECT revoked_at FROM software_offer_links').get()).toEqual({revoked_at:null});
  expect(sql.prepare("SELECT action FROM owner_request_audit WHERE action='declined'").all()).toEqual([]);
  expect(sql.prepare('SELECT request_id FROM software_projects').get()).toEqual({request_id:'software'});
});

async function withdraw() {
  const { POST: requestPost } = await import('~/pages/api/owner/requests/[id]');
  return requestPost({ params:{ id:'software' }, request:new Request('https://example.com/api/owner/requests/software', { method:'POST', body:JSON.stringify({ action:'withdraw' }) }), locals:{ owner:{ email:'owner@example.com' },runtime:{ env:{ MUSIC_DB:db } } } } as any);
}
it.each(['revoke','decline','withdraw'])('refuses %s during the send window and allows it after 20 seconds', async action => {
  const sent = await send(await draft());
  const close = () => action === 'withdraw' ? withdraw() : call({ action, text:'Thanks.' });
  vi.mocked(fetch).mockClear();
  const response = await close();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ ok:false, message:'An offer is still being sent. Try again in a moment.' });
  expect(await getLinkedOffer(db, sent.link.split('/').pop())).toMatchObject({ status:'sent' });
  expect(fetch).not.toHaveBeenCalled();
  sql.prepare('UPDATE software_offer_links SET created_at=?').run(new Date(Date.now() - 20_001).toISOString());
  expect((await close()).status).toBe(200);
  expect(await getLinkedOffer(db, sent.link.split('/').pop())).toBeNull();
});
it.each(['revoke','decline','withdraw'])('guards %s inside its batch when a send starts after the read', async action => {
  await send(await draft());
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
  const batch = db.batch.bind(db);
  db.batch = async items => {
    sql.prepare('UPDATE software_offer_links SET created_at=?').run(new Date().toISOString());
    return batch(items);
  };
  const response = await (action === 'withdraw' ? withdraw() : call({ action, text:'Thanks.' }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ message:'An offer is still being sent. Try again in a moment.' });
  expect(sql.prepare('SELECT revoked_at FROM software_offer_links').get()).toEqual({ revoked_at:null });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({ status:'new' });
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action IN ('declined','withdrawn','offer-link-revoked')").all()).toEqual([]);
});
it.each(['replaced','revoked','withdrawn','superseded'])('reports a link %s while its email is pending', async change => {
  const saved = await draft();
  vi.mocked(fetch).mockImplementation(async () => {
    if (change === 'replaced') sql.exec("UPDATE software_offer_links SET token_hash='replacement'");
    if (change === 'revoked') sql.exec("UPDATE software_offer_links SET revoked_at='closed'");
    if (change === 'withdrawn') sql.exec("UPDATE owner_requests SET status='withdrawn'");
    if (change === 'superseded') sql.exec("UPDATE software_offers SET status='superseded'");
    return new Response('{}');
  });
  const response = await call({ action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ ok:false, message:'The email went out, but the link was closed while it was sending. Send the offer again for a working link.' });
});

it.each(['confirmed','rejected','uncertain'])('reserves decline before delivery (%s)', async outcome => {
  await send(await draft());
  sql.exec("UPDATE software_offer_links SET created_at='2020-01-01T00:00:00Z'");
  const saved = await draft();
  let lateSend!: Promise<Response>;
  vi.mocked(fetch).mockImplementation(async () => {
    expect(sql.prepare("SELECT status FROM software_offers ORDER BY version").all()).toEqual([{ status:'withdrawn' },{ status:'withdrawn' }]);
    expect(sql.prepare('SELECT revoked_at FROM software_offer_links').get().revoked_at).not.toBeNull();
    expect(sql.prepare('SELECT status FROM owner_requests').get().status).toBe('new');
    lateSend = call({ action:'send', version:saved.version, expectedUpdatedAt:saved.updatedAt });
    return new Response('{}', { status:outcome === 'confirmed' ? 200 : outcome === 'rejected' ? 422 : 503 });
  });
  const response = await call({ action:'decline', text:'Thanks.' });
  expect((await lateSend).status).toBe(409);
  expect(response.status).toBe(outcome === 'confirmed' ? 200 : 502);
  if (outcome !== 'confirmed') expect(await response.json()).toMatchObject({ message:outcome === 'rejected' ? 'The email didn’t send. The offer is withdrawn and its link is closed; nothing else changed. Try again.' : 'The email service didn’t confirm. The offer is withdrawn and its link is closed. Check Resend before retrying.' });
  expect(sql.prepare('SELECT status FROM owner_requests').get().status).toBe(outcome === 'confirmed' ? 'resolved' : 'new');
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action='declined'").all()).toHaveLength(outcome === 'confirmed' ? 1 : 0);
});

it('rejects an actual send batch that read the draft before decline reserved it', async () => {
  const saved = await draft();
  const batch = db.batch.bind(db);
  let read!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { read = resolve; });
  const reserved = new Promise<void>(resolve => { release = resolve; });
  db.batch = async items => {
    if (items.some(item => (item as any).query.includes('software_offers WHERE id=? AND status=?'))) {
      read(); await reserved;
    }
    return batch(items);
  };
  const pending = call({ action:'send',version:saved.version,expectedUpdatedAt:saved.updatedAt });
  await reached;
  vi.mocked(fetch).mockImplementation(async () => {
    release();
    expect((await pending).status).toBe(409);
    return new Response('{}');
  });
  expect((await call({ action:'decline',text:'Thanks.' })).status).toBe(200);
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action='offer-sent'").all()).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('allows a draft but blocks a second send while the first email is pending', async () => {
  const first = await draft();
  let started!: () => void, finish!: () => void;
  const reached = new Promise<void>(resolve => { started = resolve; });
  const delivery = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(fetch).mockImplementationOnce(async () => { started(); await delivery; return new Response('{}'); });
  const pending = call({ action:'send',version:first.version,expectedUpdatedAt:first.updatedAt });
  await reached;
  const link = sql.prepare('SELECT * FROM software_offer_links').get();
  const second = await draft();
  const response = await call({ action:'send',version:second.version,expectedUpdatedAt:second.updatedAt });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ ok:false,message:'An offer is still being sent. Try again in a moment.' });
  expect(sql.prepare('SELECT * FROM software_offer_links').get()).toEqual(link);
  expect(sql.prepare('SELECT version,status FROM software_offers ORDER BY version').all()).toEqual([{ version:1,status:'sent' },{ version:2,status:'draft' }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(); expect((await pending).status).toBe(200);
});

it('rolls back a send when another send reserves the link after its pre-check', async () => {
  const saved = await draft();
  const batch = db.batch.bind(db);
  db.batch = async items => {
    sql.prepare('INSERT INTO software_offer_links(request_id,token_hash,created_at) VALUES (?,?,?)').run('software','other-send',new Date().toISOString());
    return batch(items);
  };
  const response = await call({ action:'send',version:saved.version,expectedUpdatedAt:saved.updatedAt });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ message:'An offer is still being sent. Try again in a moment.' });
  expect(sql.prepare('SELECT status FROM software_offers').get()).toEqual({ status:'draft' });
  expect(sql.prepare('SELECT token_hash FROM software_offer_links').get()).toEqual({ token_hash:'other-send' });
  expect(sql.prepare("SELECT * FROM owner_request_audit WHERE action='offer-sent'").all()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
