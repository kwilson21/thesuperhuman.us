import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { POST } from '~/pages/api/owner/requests/[id]';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('request-1','purchase','fan@example.com','Wants Old News','new','2026-09-19T12:00:00Z','2026-09-19T12:00:00Z')`);
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values), first: async () => sql.prepare(query).get(...args) ?? null, all: async () => ({ results: sql.prepare(query).all(...args) }) });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN'); try { const result = items.map(item => ({ results: /RETURNING/i.test(item.query) ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) })); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
});
function context(owner: boolean, body: unknown) {
  return { params: { id: 'request-1' }, request: new Request('https://thesuperhuman.us/api/owner/requests/request-1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env: { MUSIC_DB: db } } } } as any;
}

it('updates a request only for an authenticated owner and records the actor', async () => {
  expect((await POST(context(false, { action: 'review' }))).status).toBe(403);
  expect((await POST(context(true, { action: 'review' }))).status).toBe(200);
  expect(sql.prepare('SELECT action,actor FROM owner_request_audit ORDER BY id DESC LIMIT 1').get()).toEqual({ action: 'reviewed', actor: 'owner@example.com' });
});

it('validates actions and bounded private notes', async () => {
  expect((await POST(context(true, { action: 'delete' }))).status).toBe(400);
  expect((await POST(context(true, { action: 'note', note: 'Listen again before replying.' }))).status).toBe(200);
  expect(sql.prepare('SELECT private_note FROM owner_requests').get()).toEqual({ private_note: 'Listen again before replying.' });
});

it('refuses reopening a started software request and resolving an active software request atomically', async () => {
  sql.exec("UPDATE owner_requests SET kind='software',status='reviewed'; INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('offer','request-1',1,'sent','{}','now','now'); INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('request-1','offer','{}','invoice','now','now','now','owner','now','now')");
  const response = await POST(context(true, { action: 'reopen' }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ ok:false,message:'This project has started. Use the project controls.' });
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'reviewed'});
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_request_audit').get()).toEqual({n:0});
  const resolveResponse=await POST(context(true, { action:'resolve' }));
  expect(resolveResponse.status).toBe(409);
  expect(await resolveResponse.json()).toEqual({ok:false,message:'Mark the project complete first.'});
  expect(sql.prepare('SELECT COUNT(*) AS n FROM owner_request_audit').get()).toEqual({n:0});
});

it('still reopens software requests before a project starts',async()=>{
  sql.exec("UPDATE owner_requests SET kind='software',status='resolved'");
  expect((await POST(context(true,{action:'reopen'}))).status).toBe(200);
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'new'});
});
