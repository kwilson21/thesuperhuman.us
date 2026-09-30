import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changeOwnerRequest } from '~/lib/owner-requests';
import { POST as offerPost } from '~/pages/api/owner/requests/[id]/software';
import { POST as messagesPost } from '~/pages/api/studio/software/[id]/messages';
import { POST as projectPost } from '~/pages/api/owner/requests/[id]/project';
import { POST as updatePost } from '~/pages/api/owner/requests/[id]/updates';
import { GET as ownerVisual, PUT as uploadVisual } from '~/pages/api/owner/requests/[id]/updates/[updateId]/visual';
import { GET as clientVisual } from '~/pages/api/studio/software/[id]/updates/[updateId]/visual';
import { clientSoftwareProjectForSession, clientSoftwareProjectsForSession, clientProjectForSession, clientProjectsForSession, issueClientCode, completeClientCode, discardUndeliveredCode } from '~/lib/audio-client-access';
import { sharedSoftwareUpdates, queueSoftwareNotice, deliverSoftwareNotice } from '~/lib/software-projects';
import { softwareInvitationEmail, softwareUpdateEmail } from '~/lib/client-emails';
import { listStudioProjectAttention } from '~/lib/owner-reporting';
import { postClientSoftwareProjectMessage } from '~/lib/software-project-messages';
import { POST as reviewPost } from '~/pages/api/studio/software/[id]/reviews/[updateId]';
import { correctionPeriodEnd } from '~/lib/software-projects';
import { softwareReviewEmail, softwareHandoffEmail } from '~/lib/client-emails';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database, env: Env;
const terms = { outcome: 'Onboarding tool', summary: 'One shared view.', milestones: [{ name: 'Tracker', deliverables: ['Status view'], acceptance: ['Add a client.'], feeCents: 240000 }], clientInputs: 'Sample', exclusions: 'Live rollout', timing: '', paymentMode: 'standard' };
const termsJson = JSON.stringify(terms, null, 2), secret = 'studio-code-key-for-tests-32-characters';
const visualBytes = new Uint8Array([137,80,78,71,13,10,26,10,0]);
const bucket = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
function adapter(database: InstanceType<typeof DatabaseSync>) {
  const statement = (query: string, args: unknown[] = []) => ({ query, args, bind: (...values: unknown[]) => statement(query, values), first: async () => database.prepare(query).get(...args) ?? null,
    all: async () => ({ results: database.prepare(query).all(...args) }), run: async () => ({ results: [], meta: database.prepare(query).run(...args) }) });
  return { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    database.exec('BEGIN'); try { const result = items.map(item => ({ results: /RETURNING|^SELECT/i.test(item.query) ? database.prepare(item.query).all(...item.args) : (database.prepare(item.query).run(...item.args), []) })); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
}
function request(id = 'software', email = 'alex@example.com', kind = 'software') {
  sql.prepare("INSERT INTO owner_requests(id,kind,name,email,summary,status,private_note,created_at,updated_at) VALUES (?,?,'Alex Example',?,'Tool','new','PRIVATE NOTE','now','now')").run(id, kind, email);
}
function offer(id = 'software', mode = 'standard') {
  sql.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES (?,?,1,'sent',?,'now','now')").run(`${id}-offer`, id, mode === 'standard' ? termsJson : JSON.stringify({ ...terms, paymentMode: mode }));
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON'); sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8')); db = adapter(sql);
  request(); offer(); bucket.put.mockReset(); bucket.get.mockReset(); bucket.delete.mockReset();
  env = { MUSIC_DB: db, AUDIO: bucket, AUDIO_CLIENT_PORTAL_ENABLED: 'true', RESEND_API_KEY: 'test', CONTACT_FROM_EMAIL: 'studio@example.com', SITE_ORIGIN: 'https://preview.example.com' } as unknown as Env;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => { sql.close(); vi.unstubAllGlobals(); });
async function call(route: typeof projectPost, body: unknown, owner = true, id = 'software') {
  return route({ params: { id }, request: new Request(`https://example.com/api/owner/requests/${id}/project`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify(body) }), locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env } } } as never);
}
const start = () => call(projectPost, { action: 'start', signatures: true, payment: true, next_update_on: '2026-10-01' });
const update = { kind: 'progress', milestone_index: 0, title: 'Shared view', artifact_version: 'v1', evidence_type: 'concept', visual_alt: 'A fictional tracker.', preview_url: 'https://preview.example.com/tool', what_changed: 'Client status is visible.', checks_limitations: 'Sample only.', next_step: 'Build the shared view.', client_request: 'Send the sample.', next_update_on: '2026-10-02', email_client: false };
async function draft() { const response = await call(updatePost, { action: 'draft', update, expectedUpdatedAt: null }); expect(response.status).toBe(200); return response.json() as Promise<{ id: string; updatedAt: string }>; }
async function session(email = 'alex@example.com') { const code = await issueClientCode(db, email, secret); return (await completeClientCode(db, email, code!, secret))!; }
async function shareReview(kind='delivery_review', artifact_version='Delivery v1') {
  const response = await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind,artifact_version,criteria:['Try adding a client in the preview.']}});
  expect(response.status).toBe(200); return response.json() as Promise<{id:string}>;
}
async function decide(updateId:string, body:unknown, token:string, id='software') {
  return reviewPost({params:{id,updateId},request:new Request(`https://example.com/api/studio/software/${id}/reviews/${updateId}`,{method:'POST',headers:{origin:'https://example.com','content-type':'application/json',cookie:token ? `studio_session=${token}` : ''},body:JSON.stringify(body)}),locals:{runtime:{env}}} as never);
}
it('requires a named review version, evidence for every check and a bounded review window',async()=>{
  await start();
  for(const changed of [{artifact_version:''},{criteria:[]},{criteria:['']},{review_window_days:4},{review_window_days:31},{criteria:['x'.repeat(301)]}]) {
    expect((await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',criteria:['Try it'],...changed}})).status).toBe(400);
  }
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_updates').get()).toEqual({n:0});
});
it('records one version-specific decision and audit together, without confusing direction and acceptance',async()=>{
  await start(); const token=await session(), direction=await shareReview('direction_review','Direction v1');
  expect((await decide(direction.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(400);
  expect((await decide(direction.id,{decision:'direction_confirmed'},token)).status).toBe(200);
  expect((await decide(direction.id,{decision:'direction_confirmed'},token)).status).toBe(409);
  const delivery=await shareReview();
  expect((await decide(delivery.id,{decision:'direction_confirmed'},token)).status).toBe(400);
  expect((await decide(delivery.id,{decision:'milestone_accepted'},token)).status).toBe(400);
  expect((await decide(delivery.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
  expect(sql.prepare("SELECT note FROM software_project_audit WHERE action='decision-recorded' ORDER BY id").all()).toEqual([
    {note:'Direction confirmed on Direction v1 · milestone 1'},{note:'Accepted on Delivery v1 · milestone 1'}]);
  expect(sql.prepare('SELECT decision,read_at FROM software_project_messages ORDER BY id').all()).toEqual([{decision:'direction_confirmed',read_at:null},{decision:'milestone_accepted',read_at:null}]);
});
it('requires specific delivery criteria and bounded reproduction notes',async()=>{
  await start(); const token=await session(), review=await shareReview();
  for(const changed of [{criteria:[]},{criteria:[1]},{criteria:[-1]},{note:''},{note:'x'.repeat(2001)}])
    expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'Adding a client fails with the sample.',...changed},token)).status).toBe(400);
  expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'Adding a client fails with the sample.'},token)).status).toBe(200);
  expect(sql.prepare('SELECT body FROM software_project_messages').get().body).toContain('Check 1: Add a client.');
  expect(sql.prepare("SELECT note FROM software_project_audit WHERE action='decision-recorded'").get().note).toContain('checks 1');
});
it('supersedes only the same kind and milestone, keeping old versions and decisions private-safe',async()=>{
  await start();const token=await session(),first=await shareReview();
  await decide(first.id,{decision:'changes_requested',criteria:[0],note:'Try the sample.'},token);
  const second=await shareReview('delivery_review','Delivery v2');
  expect((await decide(first.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(409);
  expect((await decide(second.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
  const projected=await sharedSoftwareUpdates(db,'software');
  expect(projected.find(item=>item.id===first.id)).toMatchObject({status:'superseded',decision:'changes_requested'});
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE NOTE|actor_id|visual_key|shared_by|notification_status/);
});
it('scopes review decisions to own active sessions and rejects unknown or revoked projects',async()=>{
  await start();const token=await session(),review=await shareReview();
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},'')).status).toBe(401);
  request('foreign','other@example.com');offer('foreign');await call(projectPost,{action:'start',signatures:true,payment:true,next_update_on:''},true,'foreign');
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},await session('other@example.com'))).status).toBe(404);
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token,'missing')).status).toBe(404);
  sql.exec("UPDATE software_projects SET revoked_at='now'");
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(404);
});
it('rolls back the decision when the audit cannot be written',async()=>{
  await start();const token=await session(),review=await shareReview();
  sql.exec("CREATE TRIGGER fail_decision_audit BEFORE INSERT ON software_project_audit WHEN NEW.action='decision-recorded' BEGIN SELECT RAISE(ABORT,'test'); END");
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_messages').get()).toEqual({n:0});
});
it('gates handoff on accepted delivery, explicit full payment and safe delivered links; completes only after handoff',async()=>{
  await start();const token=await session();
  const handoff={...update,kind:'handoff',paid_confirmed:true,links:[{label:'Handoff notes',url:'https://files.example.com/notes'}]};
  const share=(changed={})=>call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...handoff,...changed}});
  expect((await share()).status).toBe(409);
  expect((await call(projectPost,{action:'complete',confirmed:true})).status).toBe(409);
  const review=await shareReview();await decide(review.id,{decision:'milestone_accepted',confirm:true},token);
  for(const changed of [{paid_confirmed:false},{links:[]},{links:[{label:'Files',url:'http://files.example.com'}]},{links:[{label:'Files',url:'https://user:password@files.example.com'}]}]) expect((await share(changed)).status).toBe(400);
  expect((await share()).status).toBe(200);
  expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_payments').get()).toEqual({n:1});
  expect((await call(projectPost,{action:'payment',milestone_index:0,confirmed:true})).status).toBe(200);
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='milestone-paid'").get()).toEqual({n:1});
  expect((await call(projectPost,{action:'complete',confirmed:true})).status).toBe(200);
  expect(sql.prepare('SELECT state,completed_at FROM software_projects').get()).toMatchObject({state:'complete',completed_at:expect.any(String)});
  expect((await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update})).status).toBe(409);
});
it('starts corrections at the earlier acceptance or full-payment New York date, across DST',()=>{
  expect(correctionPeriodEnd('2026-10-01T02:00:00Z','2026-09-28T15:00:00Z')).toBe('2026-10-28');
  expect(correctionPeriodEnd('2026-10-31T23:00:00Z')).toBe('2026-11-30');
  expect(correctionPeriodEnd('2026-10-01T02:00:00Z','2026-10-05T12:00:00Z')).toBe('2026-10-30');
});
it('renders review and handoff notices with sign-in links and no project details',()=>{
  for(const [render,heading] of [[softwareReviewEmail,'Ready for your review.'],[softwareHandoffEmail,'Your handoff is ready.']] as const) {
    const email=render('https://preview.example.com');expect(email.text).toContain(heading);expect(email.html).toContain(heading);
    expect(email.text).toContain('https://preview.example.com/studio/sign-in?for=software');expect(email.text).not.toContain(terms.outcome);
  }
});
it('queues the correct review and handoff notice subjects using mocked email transport only',async()=>{
  await start();vi.mocked(fetch).mockClear();const token=await session();
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',criteria:['Try the preview.'],email_client:true}});
  expect(response.status).toBe(200);const review=await response.json() as {id:string};
  expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).subject).toBe('Your project is ready for review');
  await decide(review.id,{decision:'milestone_accepted',confirm:true},token);
  const handoff=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'handoff',paid_confirmed:true,links:[{label:'Notes',url:'https://example.com/notes'}],email_client:true}});
  expect(handoff.status).toBe(200);expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).subject).toBe('Your project handoff is ready');
});
it('rejects a review that becomes superseded between validation and the decision batch',async()=>{
  await start();const token=await session(),review=await shareReview();
  const original=db.batch.bind(db);const batch=vi.spyOn(db,'batch').mockImplementationOnce(async statements=>{
    sql.prepare("UPDATE software_project_updates SET status='superseded' WHERE id=?").run(review.id);return original(statements);
  });
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_messages').get()).toEqual({n:0});batch.mockRestore();
});
it('enforces the new payment, review-window and factual audit-note schema limits',async()=>{
  await start();await draft();
  for(const value of [4,31]) expect(()=>sql.prepare('UPDATE software_project_updates SET review_window_days=?').run(value)).toThrow();
  for(const value of [-1,3]) expect(()=>sql.prepare("INSERT INTO software_milestone_payments VALUES ('software',?,'now','owner')").run(value)).toThrow();
  sql.exec("INSERT INTO software_milestone_payments VALUES ('software',0,'now','owner')");
  expect(()=>sql.exec("INSERT INTO software_milestone_payments VALUES ('software',0,'later','owner')")).toThrow();
  expect(()=>sql.prepare("INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note) VALUES ('software','milestone-paid','owner','now',?)").run('x'.repeat(201))).toThrow();
});
it('starts only with an owner, sent offer and both explicit confirmations, preserving the exact snapshot', async () => {
  expect((await call(projectPost, { action:'start' }, false)).status).toBe(403);
  expect((await call(projectPost, { action:'start',signatures:true,payment:false,next_update_on:'' })).status).toBe(400);
  sql.exec("UPDATE software_offers SET status='draft'"); expect((await start()).status).toBe(409);
  sql.exec("UPDATE software_offers SET status='sent'"); expect((await start()).status).toBe(200);
  expect(sql.prepare('SELECT terms_json,offer_id,payment_mode,invitation_status FROM software_projects').get()).toEqual({ terms_json:termsJson,offer_id:'software-offer',payment_mode:'standard',invitation_status:'sent' });
  expect(sql.prepare('SELECT action,actor FROM software_project_audit').all()).toEqual([{action:'started',actor:'owner@example.com'}]);
  expect((await start()).status).toBe(409); expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({subject:'Your project has started',to:['alex@example.com'],text:expect.stringContaining('/studio/sign-in?for=software'),html:expect.stringContaining('/studio/sign-in?for=software')});
  sql.exec("UPDATE software_offers SET terms_json='{}'"); expect(sql.prepare('SELECT terms_json FROM software_projects').get()).toEqual({terms_json:termsJson});
});
it('supports invoice start, failed invitations and checked uncertain retries', async () => {
  sql.prepare('UPDATE software_offers SET terms_json=?').run(JSON.stringify({...terms,paymentMode:'invoice'}));
  vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:400})); expect((await start()).status).toBe(200);
  expect(sql.prepare('SELECT payment_mode,invitation_status FROM software_projects').get()).toEqual({payment_mode:'invoice',invitation_status:'failed'});
  expect(await queueSoftwareNotice(db,'software',false)).toBe(true); vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:503})); await deliverSoftwareNotice(db,'software',env);
  expect(sql.prepare('SELECT invitation_status FROM software_projects').get()).toEqual({invitation_status:'sending'});
  expect(await queueSoftwareNotice(db,'software',false)).toBe(false); expect(await queueSoftwareNotice(db,'software',true)).toBe(false);
  sql.exec("UPDATE software_projects SET invitation_attempted_at='2020-01-01'"); expect(await queueSoftwareNotice(db,'software',true)).toBe(true);
});
it('software-only codes and sessions are scoped across both project kinds and revocation/withdrawal', async () => {
  await start(); const token = await session(); expect(token).toBeTruthy();
  expect(await clientSoftwareProjectForSession(db,token,'software')).toMatchObject({request_id:'software'}); expect(await clientProjectsForSession(db,token)).toEqual([]);
  request('foreign-audio','other@example.com','service'); expect(await clientProjectForSession(db,token,'foreign-audio')).toBeNull();
  request('audio','alex@example.com','service'); expect((await clientProjectsForSession(db,token))?.map(p=>p.request_id)).toEqual(['audio']);
  request('foreign-software','other@example.com'); offer('foreign-software'); await call(projectPost,{action:'start',signatures:true,payment:true,next_update_on:''},true,'foreign-software');
  const other = await session('other@example.com'); expect(await clientSoftwareProjectForSession(db,other,'software')).toBeNull(); expect(await clientProjectForSession(db,other,'audio')).toBeNull();
  sql.exec("UPDATE owner_requests SET status='withdrawn' WHERE id='software'"); expect(await clientSoftwareProjectForSession(db,token,'software')).toBeNull();
  sql.exec("UPDATE owner_requests SET status='new' WHERE id='software'"); expect((await call(projectPost,{action:'revoke',confirmed:true})).status).toBe(200);
  expect(await clientSoftwareProjectsForSession(db,token)).toBeNull(); expect(await clientSoftwareProjectForSession(db,other,'foreign-software')).toBeTruthy();
});
it('refuses sign-in when the only project closes after code issuance, and audits undelivered software codes', async () => {
  await start(); const code = (await issueClientCode(db,'alex@example.com',secret))!; await discardUndeliveredCode(db,'alex@example.com',code,secret);
  expect(sql.prepare("SELECT action FROM audio_client_access_audit WHERE action='code-delivery-failed'").all()).toEqual([{action:'code-delivery-failed'}]);
  const second = (await issueClientCode(db,'alex@example.com',secret))!; sql.exec("UPDATE software_projects SET revoked_at='now'");
  expect(await completeClientCode(db,'alex@example.com',second,secret)).toBeNull();
});
it('saves one draft, rejects stale forms, shares only with required content and emails separately', async () => {
  await start(); vi.mocked(fetch).mockClear(); const saved = await draft();
  expect((await call(updatePost,{action:'draft',update,expectedUpdatedAt:null})).status).toBe(409);
  expect((await call(updatePost,{action:'share',confirmed:true,update:{...update,title:''},expectedUpdatedAt:saved.updatedAt})).status).toBe(400);
  expect((await call(updatePost,{action:'share',confirmed:true,update:{...update,what_changed:''},expectedUpdatedAt:saved.updatedAt})).status).toBe(400);
  const changed = await (await call(updatePost,{action:'draft',update:{...update,title:'Changed'},expectedUpdatedAt:saved.updatedAt})).json() as { id: string; updatedAt: string };
  expect((await call(updatePost,{action:'share',confirmed:true,update,expectedUpdatedAt:saved.updatedAt})).status).toBe(409);
  expect((await call(updatePost,{action:'share',confirmed:true,update,expectedUpdatedAt:changed.updatedAt})).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled(); expect(sql.prepare('SELECT next_update_on FROM software_projects').get()).toEqual({next_update_on:'2026-10-02'});
  const next = await draft(); vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:400}));
  await call(updatePost,{action:'share',confirmed:true,update:{...update,email_client:true},expectedUpdatedAt:next.updatedAt});
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({subject:'Your project has an update',text:expect.stringContaining('/studio/sign-in?for=software'),html:expect.stringContaining('/studio/sign-in?for=software')});
  expect(sql.prepare('SELECT notification_status FROM software_project_updates WHERE id=?').get(next.id)).toEqual({notification_status:'failed'});
  expect(await sharedSoftwareUpdates(db,'software')).toHaveLength(2);
});
it.each(['http://example.com','https://user:pass@example.com'])('rejects unsafe preview links %s', async preview_url => {
  await start(); expect((await call(updatePost,{action:'draft',update:{...update,preview_url},expectedUpdatedAt:null})).status).toBe(400);
});
async function visualCall(route: typeof uploadVisual, id: string, options: { owner?: boolean; token?: string; type?: string; bytes?: Uint8Array; version?: string } = {}) {
  return route({params:{id:'software',updateId:id},request:new Request('https://example.com/visual',{method:route===uploadVisual?'PUT':'GET',headers:{origin:'https://example.com','content-type':options.type??'image/png','if-unmodified-since':options.version??'',cookie:options.token?`studio_session=${options.token}`:''},...(route===uploadVisual?{body:new Uint8Array(options.bytes??visualBytes).buffer}:{})}),locals:{owner:options.owner===false?undefined:{email:'owner@example.com'},runtime:{env}}} as never);
}
it('limits visual uploads, guards replacement, deletes old objects and restricts client reads to shared own updates', async () => {
  await start(); const saved = await draft(), token=await session();
  expect((await visualCall(uploadVisual,saved.id,{owner:false})).status).toBe(403);
  expect((await visualCall(uploadVisual,saved.id,{type:'image/svg+xml'})).status).toBe(415);
  expect((await visualCall(uploadVisual,saved.id,{bytes:new Uint8Array(5*1024*1024+1)})).status).toBe(413);
  expect((await visualCall(uploadVisual,saved.id,{bytes:new Uint8Array([1])})).status).toBe(400);
  expect((await visualCall(uploadVisual,saved.id,{version:'stale'})).status).toBe(409);
  const first=await (await visualCall(uploadVisual,saved.id,{version:saved.updatedAt})).json() as { id: string; updatedAt: string };
  const oldKey=sql.prepare('SELECT visual_key FROM software_project_updates WHERE id=?').get(saved.id).visual_key;
  const second=await (await visualCall(uploadVisual,saved.id,{version:first.updatedAt})).json() as { id: string; updatedAt: string }; expect(bucket.delete).toHaveBeenCalledWith(oldKey);
  expect((await visualCall(clientVisual,saved.id,{token})).status).toBe(404);
  expect((await call(updatePost,{action:'share',confirmed:true,update:{...update,visual_alt:''},expectedUpdatedAt:second.updatedAt})).status).toBe(400);
  expect((await call(updatePost,{action:'share',confirmed:true,update,expectedUpdatedAt:second.updatedAt})).status).toBe(200);
  bucket.get.mockResolvedValue({body:new ReadableStream({start(controller){controller.enqueue(visualBytes);controller.close();}})});
  const response=await visualCall(clientVisual,saved.id,{token}); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('content-type')).toBe('image/png');
  expect((await visualCall(clientVisual,saved.id,{token:'a'.repeat(72)})).status).toBe(404);
  expect((await visualCall(ownerVisual,saved.id,{owner:false})).status).toBe(403);
  sql.exec("UPDATE software_projects SET revoked_at='now'"); expect((await visualCall(clientVisual,saved.id,{token})).status).toBe(404);
});
it('client projection excludes private notes, drafts, audit and all owner fields', async () => {
  await start(); await draft(); const token=await session();
  const client=await clientSoftwareProjectForSession(db,token,'software'); expect(JSON.stringify(client)).not.toMatch(/PRIVATE NOTE|started_by|invitation|audit|fit/);
  expect(await sharedSoftwareUpdates(db,'software')).toEqual([]);
});
it('state validation, messages and Today reminders use the project snapshot and promise date', async () => {
  await start(); const project=sql.prepare('SELECT updated_at FROM software_projects').get();
  const command={action:'state',state:'waiting_for_input',waiting_for:'',milestone_index:0,step:'build',next_update_on:'2026-10-01',expectedUpdatedAt:project.updated_at};
  expect((await call(projectPost,command)).status).toBe(400); expect((await call(projectPost,{...command,waiting_for:'Sample',milestone_index:1})).status).toBe(400);
  expect((await call(projectPost,{...command,waiting_for:'Sample'})).status).toBe(200);
  expect((await call(projectPost,{...command,waiting_for:'Stale edit'})).status).toBe(409);
  const token=await session(); await postClientSoftwareProjectMessage(db,'software',token,'A question.');
  const attention=await listStudioProjectAttention(db,new Date('2026-09-29T12:00:00Z'));
  expect(attention).toContainEqual(expect.objectContaining({kind:'software',requestId:'software',unreadMessages:1,promisedUpdate:'2026-10-01'}));
  const draftUpdate=await draft(); await call(updatePost,{action:'share',confirmed:true,update:{...update,email_client:true},expectedUpdatedAt:draftUpdate.updatedAt});
  sql.exec("UPDATE software_project_updates SET notification_status='sending',notification_attempted_at='2020-01-01'");
  expect(await listStudioProjectAttention(db,new Date())).toContainEqual(expect.objectContaining({requestId:'software',uncheckedNotices:1}));
});
it.each([[softwareInvitationEmail,'Your project has started.'],[softwareUpdateEmail,'You have a new project update.']] as const)('renders private software email parts with configured origin', (render, heading) => {
  const mail=render('https://preview.example.com'); expect(mail.text).toContain(heading); expect(mail.html).toContain(heading);
  expect(mail.text).toContain('https://preview.example.com/studio/sign-in?for=software'); expect(mail.html).toContain('https://preview.example.com/studio/sign-in?for=software');
  expect(mail.text+mail.html).not.toMatch(/Onboarding tool|Alex|Tracker|PRIVATE NOTE/);
});
it('migration preserves every earlier row and enforces checks, draft uniqueness, review uniqueness and foreign keys', () => {
  const database=new DatabaseSync(':memory:'); database.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('../../migrations/music/',import.meta.url)).filter(name=>name.endsWith('.sql')&&name<'0021').sort()) database.exec(readFileSync(new URL(`../../migrations/music/${name}`,import.meta.url),'utf8'));
  database.exec("INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at) VALUES ('a','service','a@example.com','Keep','new','now','now'),('s','software','s@example.com','Keep','new','now','now'); INSERT INTO software_offers VALUES ('o','s',1,'sent','{}','now','now','now','owner'); INSERT INTO owner_request_audit(request_id,action,actor,occurred_at) VALUES ('s','created','owner','now')");
  const tables=['owner_requests','owner_request_audit','audio_projects','audio_project_audit','software_offers']; const before=tables.map(table=>database.prepare(`SELECT * FROM ${table}`).all());
  database.exec('BEGIN');database.exec(readFileSync(new URL('../../migrations/music/0021_software_projects.sql',import.meta.url),'utf8'));database.exec('COMMIT');
  expect(tables.map(table=>database.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  database.exec("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('s','o','{}','standard','now','now','now','owner','now','now')");
  for(const [column,value] of [['state','unknown'],['step','unknown'],['payment_mode','unknown'],['invitation_status','unknown'],['milestone_index',3],['waiting_for','x'.repeat(201)]]) expect(()=>database.prepare(`UPDATE software_projects SET ${column}=?`).run(value)).toThrow();
  const insert=database.prepare("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at) VALUES (?,'s',?,?,0,'Title',?,'owner','now','now')"); insert.run('d','progress','draft','concept'); expect(()=>insert.run('d2','progress','draft','concept')).toThrow();
  for(const [column,value] of [['kind','unknown'],['status','unknown'],['evidence_type','unknown'],['visual_media_type','image/svg+xml'],['email_client',2],['notification_status','unknown']]) expect(()=>database.prepare(`UPDATE software_project_updates SET ${column}=?`).run(value)).toThrow();
  const message=database.prepare("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('s',?,'client',?,'d',?,'now')");message.run('client','Yes','direction_confirmed');expect(()=>message.run('client','Again','changes_requested')).toThrow();expect(()=>message.run('unknown','x',null)).toThrow();expect(()=>message.run('client','',null)).toThrow();expect(()=>message.run('client','x','unknown')).toThrow();
  expect(()=>database.exec("INSERT INTO software_project_audit(request_id,action,actor,occurred_at) VALUES ('s','unknown','owner','now')")).toThrow();
  expect(()=>database.exec("UPDATE software_projects SET offer_id='missing'")).toThrow(); expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);database.close();
});

it('withdrawal records access closure and its retention clock in the same transaction', async () => {
  await start(); const token=await session();
  await changeOwnerRequest(db,{id:'software',action:'withdraw',actor:'owner@example.com'});
  expect(sql.prepare('SELECT revoked_at FROM software_projects').get().revoked_at).toBeTruthy();
  expect(sql.prepare("SELECT action,actor FROM software_project_audit WHERE action='access-revoked'").all()).toEqual([{action:'access-revoked',actor:'owner@example.com'}]);
  expect(await clientSoftwareProjectForSession(db,token,'software')).toBeNull();
  expect(sql.prepare('SELECT revoked_at FROM audio_client_sessions').get().revoked_at).toBeTruthy();
});

it('rejects offer actions after project start before sending any email', async () => {
  await start(); vi.mocked(fetch).mockClear();
  for (const body of [{action:'draft',terms,expectedUpdatedAt:null},{action:'send',version:1,expectedUpdatedAt:'now'},{action:'question',text:'Question'},{action:'decline',text:'Decline'}]) {
    const response = await call(offerPost,body);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({message:'This project has started. Use the project messages.'});
  }
  expect(fetch).not.toHaveBeenCalled(); expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'new'});
});
it('rolls back a visual object when the database batch fails after storage', async () => {
  await start(); const saved = await draft();
  const batch = vi.spyOn(db,'batch').mockRejectedValueOnce(new Error('conflict'));
  expect((await visualCall(uploadVisual,saved.id,{version:saved.updatedAt})).status).toBe(409);
  expect(bucket.put).toHaveBeenCalledOnce(); expect(bucket.delete).toHaveBeenCalledWith(bucket.put.mock.calls[0][0]);
  expect(sql.prepare('SELECT visual_key FROM software_project_updates').get()).toEqual({visual_key:null}); batch.mockRestore();
});
it('scopes the client message route to an active own session', async () => {
  await start(); const token = await session();
  const send = (id: string, cookie = token) => messagesPost({params:{id},request:new Request('https://example.com/api/studio/software/'+id+'/messages',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json',cookie:cookie ? `studio_session=${cookie}` : ''},body:JSON.stringify({action:'send',body:'Hello'})}),locals:{runtime:{env}}} as never);
  expect((await send('software','')).status).toBe(401);
  request('foreign','other@example.com'); offer('foreign'); await call(projectPost,{action:'start',signatures:true,payment:true,next_update_on:''},true,'foreign');
  expect((await send('foreign')).status).toBe(404);
  expect((await send('software')).status).toBe(200);
  sql.exec("UPDATE software_projects SET revoked_at='now' WHERE request_id='software'");
  expect((await send('software')).status).toBe(404);
  expect(sql.prepare('SELECT count(*) AS count FROM software_project_messages').get()).toEqual({count:1});
});
