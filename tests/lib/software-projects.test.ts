import * as invoiceLib from '~/lib/software-invoices';
import { POST as invoicePost } from '~/pages/api/owner/requests/[id]/invoices';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changeOwnerRequest } from '~/lib/owner-requests';
import { POST as requestPost } from '~/pages/api/owner/requests/[id]';
import { POST as offerPost } from '~/pages/api/owner/requests/[id]/software';
import { POST as messagesPost } from '~/pages/api/studio/software/[id]/messages';
import { POST as projectPost } from '~/pages/api/owner/requests/[id]/project';
import { POST as updatePost } from '~/pages/api/owner/requests/[id]/updates';
import { GET as ownerVisual, PUT as uploadVisual } from '~/pages/api/owner/requests/[id]/updates/[updateId]/visual';
import { GET as clientVisual } from '~/pages/api/studio/software/[id]/updates/[updateId]/visual';
import { clientSoftwareProjectForSession, clientSoftwareProjectsForSession, clientProjectForSession, clientProjectsForSession, issueClientCode, completeClientCode, discardUndeliveredCode } from '~/lib/audio-client-access';
import { clearUnmetRevisionEvidence, sharedSoftwareUpdates, listSoftwareUpdates, queueSoftwareNotice, deliverSoftwareNotice, softwareRevisionTargets, softwareRevisionHistoryBody } from '~/lib/software-projects';
import { softwareInvitationEmail, softwareUpdateEmail } from '~/lib/client-emails';
import { loadStudioLedger, listStudioProjectAttention } from '~/lib/owner-reporting';
import { postClientSoftwareProjectMessage } from '~/lib/software-project-messages';
import { POST as reviewPost } from '~/pages/api/studio/software/[id]/reviews/[updateId]';
import { correctionPeriodEnd } from '~/lib/software-projects';
import { softwareReviewEmail, softwareHandoffEmail } from '~/lib/client-emails';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database, env: Env;
const terms = { outcome: 'Onboarding tool', summary: 'One shared view.', milestones: [{ name: 'Tracker', deliverables: ['Status view','Sample import'], acceptance: ['Add a client.'], feeCents: 240000 }], clientInputs: 'Sample', exclusions: 'Live rollout', timing: '', paymentMode: 'standard' };
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
  if(route===projectPost && (body as {action?:string}).action==='start') body={signature_source:'external',external_signed_on:'2026-09-30',external_parties:'Example Client / Example Contractor',external_kept_copy:true,external_copy_reference:'Owner retained signed copy',inputs_ready:true,...body as object};
  if (route === updatePost) body = { expectedProjectUpdatedAt: sql.prepare('SELECT updated_at FROM software_projects WHERE request_id=?').get(id)?.updated_at ?? 'missing', ...body as object };
  return route({ params: { id }, request: new Request(`https://example.com/api/owner/requests/${id}/project`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify(body) }), locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env } } } as never);
}
const start = () => call(projectPost, { action: 'start', expectedRequestUpdatedAt: 'now', offer_id: 'software-offer', offer_version: 1, signatures: true, payment: true, next_update_on: '2026-10-01' });
const update = { kind: 'progress', milestone_index: 0, title: 'Shared view', artifact_version: 'v1', evidence_type: 'concept', visual_alt: 'A fictional tracker.', preview_url: 'https://preview.example.com/tool', what_changed: 'Client status is visible.', checks_limitations: 'Sample only.', next_step: 'Build the shared view.', client_request: 'Send the sample.', next_update_on: '2026-10-02', email_client: false, delivered_deliverables:['Status view','Sample import'] };
it('parses revision selections from stable indices, never from labels or client notes',()=>{
  const checks=['Add a client.','Label says check #1: but remains a different check.'],planned=['Status view','Label says missing #1: but remains a different item.'];
  const body='Requested changes to Delivery v1. Checks reported unmet: [2]. Deliverables unavailable: [1].\n\nNote says check #1: and missing #2: as ordinary text.';
  expect(softwareRevisionTargets(body,checks,planned)).toEqual({checks:[1],deliverables:[0]});
  expect(softwareRevisionTargets('Requested changes to Delivery v1 for milestone 1: check 1 (Add a client.), check 2 (Label says check #1: but remains a different check.)\n\nNote',checks,planned).checks).toEqual([0,1]);
  expect(softwareRevisionHistoryBody(body,checks,planned)).toBe('Requested changes to Delivery v1. Checks reported unmet: [2]. Deliverables unavailable: [1].\n\nUnmet checks:\n2. Label says check #1: but remains a different check.\n\nUnavailable deliverables:\n1. Status view\n\nClient note:\nNote says check #1: and missing #2: as ordinary text.');
  expect(clearUnmetRevisionEvidence(['stale evidence','keep this'],[0])).toEqual(['','keep this']);
});
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
it('snapshots selected deliverables but blocks acceptance until the full milestone is included',async()=>{
  await start();
  const selected=['Status view'];
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v1',criteria:['Try adding a client in the preview.'],delivered_deliverables:selected}});
  expect(response.status).toBe(200);const {id}=await response.json() as {id:string};
  const row=sql.prepare('SELECT delivered_deliverables_json FROM software_project_updates WHERE id=?').get(id);
  expect(row).toEqual({delivered_deliverables_json:JSON.stringify(selected)});
  expect((await sharedSoftwareUpdates(db,'software'))[0]).toMatchObject({delivered_deliverables_json:JSON.stringify(selected)});
  const token=await session();
  const partial=await decide(id,{decision:'milestone_accepted',confirm:true},token);
  expect(partial.status).toBe(400); expect(((await partial.json()) as {error:string}).error).toMatch(/only part of the milestone/i);
  const full=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v2',criteria:['Try adding a client in the preview.'],delivered_deliverables:['Status view','Sample import']}});
  expect(full.status).toBe(200);const revised=await full.json() as {id:string};
  expect((await decide(revised.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
  expect(sql.prepare("SELECT decision FROM software_project_messages WHERE update_id=?").get(revised.id)).toEqual({decision:'milestone_accepted'});
});
it('lets clients report a missing planned deliverable even when every included check passes',async()=>{
  await start();const token=await session();
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v1',criteria:['Try adding a client in the preview.'],delivered_deliverables:['Status view']}});
  expect(response.status).toBe(200);const {id}=await response.json() as {id:string};
  expect((await decide(id,{decision:'changes_requested',missing_deliverables:[1],note:'The sample import is not included yet.'},token)).status).toBe(200);
  expect(sql.prepare('SELECT body FROM software_project_messages WHERE update_id=?').get(id).body).toBe('Requested changes to Delivery v1 for milestone 1. Checks reported unmet: []. Deliverables unavailable: [2].\n\nThe sample import is not included yet.');
});
it('treats legacy reviews without a scope snapshot as the full agreed milestone',async()=>{
  await start();const token=await session(),review=await shareReview();
  sql.prepare("UPDATE software_project_updates SET delivered_deliverables_json='[]' WHERE id=?").run(review.id);
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
});
it('rejects delivery selections outside the agreed scope, duplicates and empty shared selections',async()=>{
  await start();
  for(const delivered_deliverables of [['Not in the contract'],['Status view','Status view'],[]]){
    const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',criteria:['Evidence'],delivered_deliverables}});
    expect(response.status).toBe(400);
  }
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_updates').get()).toEqual({n:0});
});
it('stores a longer executed-agreement review window in the additive field',async()=>{
  await start();
  sql.exec("INSERT INTO software_agreement_clients VALUES ('test-client','alex@example.com','Example Client','example','LLC','WY','Example address','alex@example.com','now'); INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES ('test-template','sow',1,'Synthetic template',lower(hex(zeroblob(32))),'now','test')");
  sql.prepare("INSERT INTO software_agreements(id,kind,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES ('test-agreement','sow','software','test-client','test-template','executed','Synthetic terms',? ,?,'now','2026-09-30','test-session')").run('a'.repeat(64),JSON.stringify({owner:{review_business_days:45}}));
  sql.exec("UPDATE software_projects SET agreement_id='test-agreement' WHERE request_id='software'");
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v1',criteria:['Try the preview.'],review_window_days:5}});
  expect(response.status).toBe(200);
  expect(sql.prepare('SELECT review_window_days,review_window_days_extended FROM software_project_updates').get()).toEqual({review_window_days:null,review_window_days_extended:45});
  expect((await sharedSoftwareUpdates(db,'software'))[0].review_window_days).toBe(45);
});
it('lets the owner save an unfinished reference in a private draft and requires it to be safe before sharing',async()=>{
  await start();
  const reference={label:'Release notes',url:''};
  const saved=await call(updatePost,{action:'draft',expectedUpdatedAt:null,update:{...update,kind:'delivery_review',links:[reference]}});
  expect(saved.status).toBe(200);const draftInfo=await saved.json() as {id:string;updatedAt:string};
  expect(sql.prepare('SELECT links_json,status FROM software_project_updates WHERE id=?').get(draftInfo.id)).toEqual({links_json:JSON.stringify([reference]),status:'draft'});
  const shared=await call(updatePost,{action:'share',updateId:draftInfo.id,expectedUpdatedAt:draftInfo.updatedAt,confirmed:true,update:{...update,kind:'delivery_review',artifact_version:'Delivery v1',criteria:['Try the preview.'],links:[reference]}});
  expect(shared.status).toBe(400);expect(((await shared.json()) as {error:string}).error).toContain('Finish each reference');
});
it('records one version-specific decision and audit together, without confusing direction and acceptance',async()=>{
  await start(); const token=await session(), direction=await shareReview('direction_review','Direction v1');
  const mismatch=await decide(direction.id,{decision:'milestone_accepted',confirm:true},token); expect(mismatch.status).toBe(400); expect(((await mismatch.json()) as {error:string}).error).toBe('This decision doesn’t apply to this review.');
  expect((await decide(direction.id,{decision:'direction_confirmed'},token)).status).toBe(200);
  expect((await decide(direction.id,{decision:'direction_confirmed'},token)).status).toBe(409);
  const delivery=await shareReview();
  expect((await decide(delivery.id,{decision:'direction_confirmed'},token)).status).toBe(400);
  expect((await decide(delivery.id,{decision:'milestone_accepted'},token)).status).toBe(400);
  expect((await decide(delivery.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
  expect(sql.prepare("SELECT note FROM software_project_audit WHERE action='decision-recorded' ORDER BY id").all()).toEqual([
    {note:'Direction confirmed on Direction v1 · milestone 1'},{note:'Accepted on Delivery v1 · milestone 1'}]);
  expect(sql.prepare('SELECT body FROM software_project_messages ORDER BY id').all()).toEqual([{body:'Confirmed Direction v1 for milestone 1.'},{body:'Accepted Delivery v1 for milestone 1.'}]);
  expect(sql.prepare('SELECT decision,read_at FROM software_project_messages ORDER BY id').all()).toEqual([{decision:'direction_confirmed',read_at:null},{decision:'milestone_accepted',read_at:null}]);
});
it('requires specific delivery criteria and bounded reproduction notes',async()=>{
  await start(); const token=await session(), review=await shareReview();
  for(const changed of [{criteria:[]},{criteria:[1]},{criteria:[-1]},{note:''},{note:'x'.repeat(2001)}])
    expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'Adding a client fails with the sample.',...changed},token)).status).toBe(400);
  expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'Adding a client fails with the sample.'},token)).status).toBe(200);
  expect(sql.prepare('SELECT body FROM software_project_messages').get().body).toBe('Requested changes to Delivery v1 for milestone 1. Checks reported unmet: [1]. Deliverables unavailable: [].\n\nAdding a client fails with the sample.');
  expect(sql.prepare("SELECT note FROM software_project_audit WHERE action='decision-recorded'").get().note).toContain('checks 1');
});
it('keeps client note text out of the machine-readable change header',async()=>{
  await start();const token=await session(),review=await shareReview();
  expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'The note mentions (Add a different planned check.) but does not mark it unmet.'},token)).status).toBe(200);
  const body=sql.prepare('SELECT body FROM software_project_messages WHERE update_id=?').get(review.id).body as string;
  expect(body.split('\n',1)[0]).toBe('Requested changes to Delivery v1 for milestone 1. Checks reported unmet: [1]. Deliverables unavailable: [].');
  expect(body).toContain('The note mentions (Add a different planned check.)');
});
it('saves revised check evidence so the revision draft can be reopened without loss',async()=>{
  await start();const token=await session(),review=await shareReview();
  expect((await decide(review.id,{decision:'changes_requested',criteria:[0],note:'The client form needs a correction.'},token)).status).toBe(200);
  const firstEvidence=['Fixed the sample client form.','Confirmed export remains available.'];
  const first=await call(updatePost,{action:'draft',expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v2',title:'Revised tracker',criteria:firstEvidence,delivered_deliverables:['Status view']}});
  expect(first.status).toBe(200);const saved=await first.json() as {id:string;updatedAt:string};
  expect(sql.prepare('SELECT criteria_json FROM software_project_updates WHERE id=?').get(saved.id)).toEqual({criteria_json:JSON.stringify(firstEvidence)});
  const reopenedEvidence=['Fixed the sample client form with clearer validation.','Confirmed export remains available.'];
  const reopened=await call(updatePost,{action:'draft',updateId:saved.id,expectedUpdatedAt:saved.updatedAt,update:{...update,kind:'delivery_review',artifact_version:'Delivery v2',title:'Revised tracker',criteria:reopenedEvidence,delivered_deliverables:['Status view']}});
  expect(reopened.status).toBe(200);
  expect(sql.prepare('SELECT criteria_json FROM software_project_updates WHERE id=?').get(saved.id)).toEqual({criteria_json:JSON.stringify(reopenedEvidence)});
});
it('snapshots delivery references with the versioned review while rejecting unsafe links',async()=>{
  await start();
  const links=[{label:'Repository · example only',url:'https://example.com/repository'},{label:'Shared artifact · access not verified',url:'https://example.com/artifact'}];
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v3',criteria:['Try adding a client in the preview.'],links}});
  expect(response.status).toBe(200);
  const shared=await sharedSoftwareUpdates(db,'software');
  expect(shared[0]).toMatchObject({artifact_version:'Delivery v3',links_json:JSON.stringify(links),criteria_json:JSON.stringify(['Try adding a client in the preview.'])});
  expect((await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'delivery_review',artifact_version:'Delivery v4',criteria:['Try it.'],links:[{label:'Unsafe',url:'javascript:alert(1)'}]}})).status).toBe(400);
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
  request('foreign','other@example.com');offer('foreign');await call(projectPost,{action:'start',expectedRequestUpdatedAt:'now',offer_id:'foreign-offer',offer_version:1,signatures:true,payment:true,next_update_on:''},true,'foreign');
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
  expect(sql.prepare('SELECT state,step FROM software_projects').get()).toEqual({state:'ready_for_review',step:'review'});
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
  sql.exec("UPDATE software_projects SET next_update_on='2026-10-02',waiting_for='Sample'");
  expect((await call(projectPost,{action:'complete',confirmed:true})).status).toBe(200);
  expect(sql.prepare('SELECT state,completed_at,next_update_on,waiting_for FROM software_projects').get()).toMatchObject({state:'complete',completed_at:expect.any(String),next_update_on:null,waiting_for:''});
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
  sql.prepare("UPDATE software_project_updates SET review_window_days=NULL,review_window_days_extended=45 WHERE request_id='software'").run();
  expect((await listSoftwareUpdates(db,'software'))[0].review_window_days).toBe(45);
  for(const value of [30,366]) expect(()=>sql.prepare("UPDATE software_project_updates SET review_window_days_extended=? WHERE request_id='software'").run(value)).toThrow();
});
it('does not complete a redelivered milestone using an earlier version’s handoff',async()=>{
  await start();const token=await session(),review=await shareReview();
  await decide(review.id,{decision:'milestone_accepted',confirm:true},token);
  const handoff=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'handoff',paid_confirmed:true,links:[{label:'Notes',url:'https://example.com/notes'}]}});expect(handoff.status).toBe(200);
  sql.exec("UPDATE software_project_updates SET shared_at='2020-01-01' WHERE kind='handoff'");
  const redelivery=await shareReview('delivery_review','Delivery v2');
  expect((await call(projectPost,{action:'complete',confirmed:true})).status).toBe(409);
  await decide(redelivery.id,{decision:'milestone_accepted',confirm:true},token);
  expect((await call(projectPost,{action:'complete',confirmed:true})).status).toBe(409);
  expect(sql.prepare('SELECT completed_at FROM software_projects').get()).toEqual({completed_at:null});
});
it('starts only with an owner, sent offer and both explicit confirmations, preserving the exact snapshot', async () => {
  expect((await call(projectPost, { action:'start' }, false)).status).toBe(403);
  expect((await call(projectPost, { action:'start',expectedRequestUpdatedAt:'now',offer_id:'foreign-offer',offer_version:1,signatures:true,payment:false,next_update_on:'' })).status).toBe(400);
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
  request('foreign-software','other@example.com'); offer('foreign-software'); await call(projectPost,{action:'start',expectedRequestUpdatedAt:'now',offer_id:'foreign-software-offer',offer_version:1,signatures:true,payment:true,next_update_on:''},true,'foreign-software');
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
  expect(fetch).not.toHaveBeenCalled(); expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'reviewed'});
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
  request('foreign','other@example.com'); offer('foreign'); await call(projectPost,{action:'start',expectedRequestUpdatedAt:'now',offer_id:'foreign-offer',offer_version:1,signatures:true,payment:true,next_update_on:''},true,'foreign');
  expect((await send('foreign')).status).toBe(404);
  expect((await send('software')).status).toBe(200);
  sql.exec("UPDATE software_projects SET revoked_at='now' WHERE request_id='software'");
  expect((await send('software')).status).toBe(404);
  expect(sql.prepare('SELECT count(*) AS count FROM software_project_messages').get()).toEqual({count:1});
});

it('moves review sharing and decisions with state audits in the same batch',async()=>{
  await start(); const token=await session();
  const state=()=>sql.prepare('SELECT state,step,waiting_for FROM software_projects').get();
  sql.exec("UPDATE software_projects SET state='waiting_for_input',waiting_for='Sample'");
  const direction=await shareReview('direction_review','Direction v1');
  expect(state()).toEqual({state:'ready_for_review',step:'direction',waiting_for:''});
  await decide(direction.id,{decision:'direction_confirmed'},token);
  expect(state()).toEqual({state:'building',step:'build',waiting_for:''});
  const delivery=await shareReview(); expect(state()).toEqual({state:'ready_for_review',step:'review',waiting_for:''});
  await decide(delivery.id,{decision:'changes_requested',criteria:[0],note:'Try the sample.'},token);
  expect(state()).toEqual({state:'building',step:'build',waiting_for:''});
  const corrected=await shareReview('delivery_review','Delivery v2');
  await decide(corrected.id,{decision:'milestone_accepted',confirm:true},token);
  expect(state()).toEqual({state:'building',step:'handoff',waiting_for:''});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='state-changed'").get()).toEqual({n:6});
});
it('rolls back review sharing and decisions if their state audit fails',async()=>{
  await start(); const token=await session(), review=await shareReview();
  sql.exec("CREATE TRIGGER fail_state_audit BEFORE INSERT ON software_project_audit WHEN NEW.action='state-changed' BEGIN SELECT RAISE(ABORT,'test'); END");
  expect((await decide(review.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_messages').get()).toEqual({n:0});
  expect((await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'direction_review'}})).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_updates').get()).toEqual({n:1});
  expect(sql.prepare('SELECT state,step FROM software_projects').get()).toEqual({state:'ready_for_review',step:'review'});
});

it('keeps newer undecided review state and never moves the milestone backwards',async()=>{
  await start(); const token=await session(), older=await shareReview();
  const multiTerms={...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Follow-up'}]};
  sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify(multiTerms));
  sql.exec("INSERT INTO software_milestone_deposits VALUES ('software',1,'now','owner')");
  sql.exec("UPDATE software_project_updates SET shared_at='2020-01-01' WHERE id='"+older.id+"'");
  const response=await call(updatePost,{action:'share',confirmed:true,expectedUpdatedAt:null,update:{...update,kind:'direction_review',milestone_index:1,artifact_version:'Direction v2'}});
  expect(response.status).toBe(200);
  const newer=await response.json() as {id:string};
  const before=sql.prepare('SELECT state,step,milestone_index,waiting_for FROM software_projects').get();
  expect((await decide(older.id,{decision:'milestone_accepted',confirm:true},token)).status).toBe(200);
  expect(sql.prepare('SELECT state,step,milestone_index,waiting_for FROM software_projects').get()).toEqual(before);
  expect((await decide(newer.id,{decision:'changes_requested',note:'Change the direction.'},token)).status).toBe(200);
  expect(sql.prepare('SELECT state,step,milestone_index FROM software_projects').get()).toEqual({state:'building',step:'direction',milestone_index:1});
  sql.exec("UPDATE software_project_messages SET decision=NULL,update_id=NULL WHERE update_id='"+older.id+"'");
  expect((await decide(older.id,{decision:'changes_requested',criteria:[0],note:'Change the delivery.'},token)).status).toBe(200);
  expect(sql.prepare('SELECT state,step,milestone_index,waiting_for FROM software_projects').get()).toEqual({state:'building',step:'direction',milestone_index:1,waiting_for:''});
  expect(sql.prepare('SELECT decision FROM software_project_messages WHERE update_id=?').get(older.id)).toEqual({decision:'changes_requested'});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='decision-recorded'").get()).toEqual({n:3});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='state-changed'").get()).toEqual({n:3});
});

it.each(['failed','pending','sending'])('includes stale %s invitations in Today',async status=>{
  await start();
  sql.prepare("UPDATE software_projects SET invitation_status=?,created_at='2026-09-01',invitation_attempted_at='2026-09-01',next_update_on=NULL").run(status);
  const rows=await listStudioProjectAttention(db,new Date('2026-09-29T12:00:00Z'));
  expect(rows).toContainEqual(expect.objectContaining({requestId:'software',failedNotices:status==='failed' ? 1 : 0,uncheckedNotices:status==='failed' ? 0 : 1}));
  sql.exec("UPDATE software_projects SET invitation_status='pending',created_at='2026-09-29T11:59:59Z'");
  expect(await listStudioProjectAttention(db,new Date('2026-09-29T12:00:00Z'))).toEqual([]);
});
it('reviews a new request atomically when starting and removes it from Today',async()=>{
  expect((await loadStudioLedger(db,new Date())).attention.newRequests).toBe(1);
  await start();
  expect((await loadStudioLedger(db,new Date())).attention.newRequests).toBe(0);
  expect(sql.prepare('SELECT status,updated_at FROM owner_requests').get()).toMatchObject({status:'reviewed',updated_at:expect.any(String)});
  expect(sql.prepare('SELECT action,actor FROM owner_request_audit').all()).toEqual([{action:'reviewed',actor:'owner@example.com'}]);
});
it('retries a first share with one row and one email, rejecting changed content',async()=>{
  await start();vi.mocked(fetch).mockClear();
  const body={action:'share',confirmed:true,updateId:crypto.randomUUID(),expectedUpdatedAt:null,expectedProjectUpdatedAt:sql.prepare('SELECT updated_at FROM software_projects').get()!.updated_at,update:{...update,email_client:true}};
  const first=await call(updatePost,body);expect(first.status).toBe(200);
  const result=await first.json();
  const stale = await call(updatePost,{...body,updateId:crypto.randomUUID()});
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ok:false,error:'Another update was saved since this page loaded. Reload to continue.'});
  expect(await (await call(updatePost,body)).json()).toEqual(result);
  expect((await call(updatePost,{...body,update:{...body.update,title:'Changed'}})).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_updates').get()).toEqual({n:1});
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['id', 'version'])('rejects a stale Start tab when the offer %s changes', async field => {
  sql.exec("UPDATE software_offers SET status='superseded'");
  sql.prepare("INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) VALUES ('replacement','software',2,'sent',?,'now','now')").run(termsJson);
  const response = await call(projectPost, { action: 'start', expectedRequestUpdatedAt: 'now', offer_id: field === 'id' ? 'software-offer' : 'replacement', offer_version: 1, signatures: true, payment: true, next_update_on: '' });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ok:false,error:'The offer changed since this page loaded. Reload to see the current offer.'});
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_audit').get()).toEqual({n:0});
  expect(sql.prepare('SELECT count(*) AS n FROM owner_request_audit').get()).toEqual({n:0});
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'new'});
  expect(fetch).not.toHaveBeenCalled();
  expect((await call(projectPost, { action: 'start', expectedRequestUpdatedAt: 'now', offer_id: 'replacement', offer_version: 2, signatures: true, payment: true, next_update_on: '' })).status).toBe(200);
  expect(sql.prepare('SELECT offer_id,terms_json FROM software_projects').get()).toEqual({offer_id:'replacement',terms_json:termsJson});
});

it('records an older direction decision without moving the accepted newer delivery from handoff',async()=>{
  await start(); const token=await session(), direction=await shareReview('direction_review','Direction v1');
  const delivery=await shareReview();
  sql.prepare("UPDATE software_project_updates SET shared_at='2020-01-01' WHERE id=?").run(direction.id);
  await decide(delivery.id,{decision:'milestone_accepted',confirm:true},token);
  const before=sql.prepare('SELECT * FROM software_projects').get();
  expect(before).toMatchObject({state:'building',step:'handoff',milestone_index:0});
  expect((await decide(direction.id,{decision:'direction_confirmed'},token)).status).toBe(200);
  expect(sql.prepare('SELECT * FROM software_projects').get()).toEqual(before);
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_messages WHERE decision IS NOT NULL").get()).toEqual({n:2});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='decision-recorded'").get()).toEqual({n:2});
});
it('a reserved question rejects a start from the displayed request before emailing',async()=>{
  env.OWNER_EMAIL='owner@example.com';
  let lateStart!: Promise<Response>;
  vi.mocked(fetch).mockImplementationOnce(async()=>{
    expect(sql.prepare('SELECT updated_at FROM owner_requests').get().updated_at).not.toBe('now');
    lateStart=start();
    const response=await lateStart;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:'The request changed since this page loaded. Reload and try again.'});
    return new Response('{}');
  });
  expect((await call(offerPost,{action:'question',text:'Which sample should we use?'})).status).toBe(200);
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  expect(sql.prepare("SELECT count(*) AS n FROM owner_request_audit WHERE action='question-sent'").get()).toEqual({n:1});
});
it('a start committing before question reservation rejects the question without delivery',async()=>{
  env.OWNER_EMAIL='owner@example.com';
  const batch=db.batch.bind(db);
  vi.spyOn(db,'batch').mockImplementationOnce(async items=>{
    expect((await start()).status).toBe(200);
    vi.mocked(fetch).mockClear();
    return batch(items);
  });
  const response=await call(offerPost,{action:'question',text:'Which sample should we use?'});
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({message:'This project has started. Use the project messages.'});
  expect(fetch).not.toHaveBeenCalled();
  expect(sql.prepare("SELECT count(*) AS n FROM owner_request_audit WHERE action='question-sent'").get()).toEqual({n:0});
});

it.each(['draft','share'])('rejects stale project versions with an existing draft on %s, including transaction races',async action=>{
  await start(); const saved=await draft();
  const projectAt=sql.prepare('SELECT updated_at FROM software_projects').get()!.updated_at;
  const body={action,confirmed:true,updateId:saved.id,update,expectedUpdatedAt:saved.updatedAt,expectedProjectUpdatedAt:projectAt};
  sql.prepare("UPDATE software_projects SET updated_at='2099-01-01T00:00:00.000Z'").run();
  const before=sql.prepare('SELECT * FROM software_project_updates').get();
  const audit=sql.prepare('SELECT count(*) AS n FROM software_project_audit').get();
  const stale=await call(updatePost,body);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({error:'Another update was saved since this page loaded. Reload to continue.'});
  sql.prepare('UPDATE software_projects SET updated_at=?').run(projectAt);
  const batch=db.batch.bind(db);
  const race=vi.spyOn(db,'batch').mockImplementationOnce(async items=>{
    sql.prepare("UPDATE software_projects SET updated_at='2099-01-01T00:00:00.000Z'").run();
    return batch(items);
  });
  const raced=await call(updatePost,body);expect(raced.status).toBe(409);
  expect(await raced.json()).toMatchObject({error:'Another update was saved since this page loaded. Reload to continue.'});
  expect(sql.prepare('SELECT * FROM software_project_updates').get()).toEqual(before);
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_audit').get()).toEqual(audit);
  race.mockRestore();
  const success=await call(updatePost,{...body,expectedProjectUpdatedAt:'2099-01-01T00:00:00.000Z'});
  expect(success.status).toBe(200);
  const result=await success.json();
  expect(result).toMatchObject({projectUpdatedAt:sql.prepare('SELECT updated_at FROM software_projects').get()!.updated_at});
  if(action==='share') expect(await (await call(updatePost,{...body,expectedProjectUpdatedAt:'2099-01-01T00:00:00.000Z'})).json()).toEqual(result);
});

// Software invoices use requests and immutable offers before studio access exists.
it('reserves a first deposit without a project, recovers it and starts only from its pinned paid offer',async()=>{
  const {reserveSoftwareInvoice,applySoftwareInvoiceEvent,paidFirstDeposit,listSoftwareInvoices,recordSoftwareInvoice}=await import('~/lib/software-invoices');
  const input={requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit' as const,allowCard:false,actor:'owner'};
  const invoice=await reserveSoftwareInvoice(db,input);
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  await expect(reserveSoftwareInvoice(db,input)).rejects.toThrow();
  await expect(reserveSoftwareInvoice(db,{...input,retryId:invoice.id})).rejects.toThrow();
  sql.prepare('UPDATE software_invoices SET creation_started_at=NULL WHERE id=?').run(invoice.id);
  expect((await reserveSoftwareInvoice(db,{...input,retryId:invoice.id})).id).toBe(invoice.id);
  const event={eventId:'evt_paid',eventType:'invoice.paid',invoiceId:'in_deposit',requestId:'software',localId:invoice.id,offerId:'software-offer',milestone:'0',kind:'deposit',status:'paid' as const,occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:'cus_private',hostedUrl:'https://example.com/invoice',dueAt:'2026-10-07T12:00:00Z'};
  expect(await applySoftwareInvoiceEvent(db,event)).toBe('processed');
  expect(paidFirstDeposit(await listSoftwareInvoices(db,'software'),'software-offer')?.id).toBe(invoice.id);
  expect(paidFirstDeposit(await listSoftwareInvoices(db,'software'),'other-offer')).toBeUndefined();
  expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_payments').get()).toEqual({n:0});
  // A late create response cannot undo a paid webhook.
  await recordSoftwareInvoice(db,invoice,{stripeCustomerId:'cus_private',invoiceId:'in_deposit',hostedInvoiceUrl:'https://example.com/invoice',status:'open',dueAt:event.dueAt});
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('paid');
  const body={action:'start',expectedRequestUpdatedAt:'now',offer_id:'software-offer',offer_version:1,signatures:true,payment:true,next_update_on:'',deposit_invoice_id:'wrong'};
  expect((await call(projectPost,body)).status).toBe(409);
  expect((await call(projectPost,{...body,deposit_invoice_id:invoice.id})).status).toBe(200);
});
it('blocks sending new terms for open, failed, creating or paid deposits and blocks declines while open',async()=>{
  const {reserveSoftwareInvoice}=await import('~/lib/software-invoices');
  await reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit',allowCard:false,actor:'owner'});
  const saved=await call(offerPost,{action:'draft',terms:{...terms,summary:'New terms'},expectedUpdatedAt:null});
  const value=await saved.json() as {version:number;updatedAt:string};
  for(const status of ['creating','open','payment_failed','uncollectible','paid']) {
    sql.prepare('UPDATE software_invoices SET status=?').run(status);
    const sent=await call(offerPost,{action:'send',version:value.version,expectedUpdatedAt:value.updatedAt});
    expect(sent.status).toBe(409);
    expect((await sent.json() as {message:string}).message).toContain(status==='paid' ? 'already paid' : 'Void the open deposit');
    if(status!=='paid')expect((await call(offerPost,{action:'decline',text:'Cannot take this on.'})).status).toBe(409);
  }
  sql.exec("UPDATE software_invoices SET status='void'");
  expect((await call(offerPost,{action:'send',version:value.version,expectedUpdatedAt:value.updatedAt})).status).toBe(200);
});
it('pins later invoices, gates delivery and payment, and records a paid balance exactly once',async()=>{
  const {reserveSoftwareInvoice,applySoftwareInvoiceEvent,clientSoftwareInvoices}=await import('~/lib/software-invoices');
  await start();
  const input={requestId:'software',offerId:'software-offer',milestone:0,kind:'balance' as const,allowCard:true,actor:'owner'};
  await expect(reserveSoftwareInvoice(db,input)).rejects.toThrow('not available');
  await shareReview();
  const invoice=await reserveSoftwareInvoice(db,input);
  const base={eventId:'evt_balance',eventType:'invoice.paid',invoiceId:'in_balance',requestId:'software',localId:invoice.id,offerId:invoice.offer_id,milestone:'0',kind:'balance',status:'paid' as const,occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:'cus_secret',hostedUrl:'https://example.com/pay',dueAt:'2026-10-15T12:00:00Z'};
  expect(await applySoftwareInvoiceEvent(db,{...base,invoiceId:'wrong',total:1})).toBe('unmatched');
  expect(await applySoftwareInvoiceEvent(db,base)).toBe('processed');
  expect(await applySoftwareInvoiceEvent(db,base)).toBe('duplicate');
  await applySoftwareInvoiceEvent(db,{...base,eventId:'evt_late',status:'payment_failed',eventType:'invoice.payment_failed',occurredAt:'2026-10-01T12:00:00Z'});
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('paid');
  expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_payments').get()).toEqual({n:1});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='milestone-paid'").get()).toEqual({n:1});
  const visible=await clientSoftwareInvoices(db,{request_id:'software',offer_id:'software-offer'});
  expect(visible[0]).toMatchObject({status:'paid',amount_cents:120000,due_at:base.dueAt});
  expect(JSON.stringify(visible)).not.toMatch(/cus_secret|created_by|stripe_invoice_id|offer_id/);
  expect(await clientSoftwareInvoices(db,{request_id:'other',offer_id:'software-offer'})).toEqual([]);
  expect(await clientSoftwareInvoices(db,{request_id:'software',offer_id:'other'})).toEqual([]);
  await expect(reserveSoftwareInvoice(db,input)).rejects.toThrow();
});
it('applies ordered software statuses, rejects conflicting identities and replaces only void invoices',async()=>{
  const {reserveSoftwareInvoice,applySoftwareInvoiceEvent}=await import('~/lib/software-invoices');
  const input={requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit' as const,allowCard:false,actor:'owner'};
  const invoice=await reserveSoftwareInvoice(db,input);
  const base={eventId:'evt_open',eventType:'invoice.sent',invoiceId:'in_original',requestId:'software',localId:invoice.id,offerId:invoice.offer_id,milestone:'0',kind:'deposit',status:'open' as const,occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:null,hostedUrl:'https://example.com/pay',dueAt:null};
  for(const changed of [{offerId:'other'},{requestId:'other'},{milestone:'1'},{kind:'balance'},{currency:'eur'}])expect(await applySoftwareInvoiceEvent(db,{...base,eventId:JSON.stringify(changed),...changed})).toBe('unmatched');
  await applySoftwareInvoiceEvent(db,base);
  await applySoftwareInvoiceEvent(db,{...base,eventId:'evt_failed',status:'payment_failed',occurredAt:'2026-09-30T13:00:00Z'});
  await applySoftwareInvoiceEvent(db,{...base,eventId:'evt_old',occurredAt:'2026-09-30T11:00:00Z'});
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('payment_failed');
  await expect(reserveSoftwareInvoice(db,{...input,replaceId:invoice.id})).rejects.toThrow('Void');
  await applySoftwareInvoiceEvent(db,{...base,eventId:'evt_uncollectible',status:'uncollectible',occurredAt:'2026-09-30T14:00:00Z'});
  await expect(reserveSoftwareInvoice(db,{...input,replaceId:invoice.id})).rejects.toThrow('Void');
  await applySoftwareInvoiceEvent(db,{...base,eventId:'evt_void',status:'void',occurredAt:'2026-09-30T15:00:00Z'});
  const replacement=await reserveSoftwareInvoice(db,{...input,replaceId:invoice.id});
  expect(replacement.attempt).toBe(1);expect(replacement.id).not.toBe(invoice.id);
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='invoice-replaced'").get()).toEqual({n:1});
});
it('releases offer blocks only after an explicit full pre-start refund record and lets old absent attempts recover',async()=>{
  const {reserveSoftwareInvoice,depositOfferBlock,paidFirstDeposit,listSoftwareInvoices}=await import('~/lib/software-invoices');
  const {reconciliationStatements}=await import('../../scripts/stripe-reconciliation.mjs');
  const input={requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit' as const,allowCard:false,actor:'owner'};
  const invoice=await reserveSoftwareInvoice(db,input);
  sql.prepare("UPDATE software_invoices SET status='paid',stripe_invoice_id='in_paid' WHERE id=?").run(invoice.id);
  expect(await depositOfferBlock(db,'software')).toContain('already paid');
  for(const statement of reconciliationStatements(['--software-deposit-refunded',invoice.id,'Confirmed']))sql.exec(statement);
  expect(await depositOfferBlock(db,'software')).toBeNull();
  expect(paidFirstDeposit(await listSoftwareInvoices(db,'software'),'software-offer')).toBeUndefined();
  expect(sql.prepare('SELECT status,refunded_at FROM software_invoices').get()).toMatchObject({status:'paid',refunded_at:expect.any(String)});
  expect((await call(projectPost,{action:'start',expectedRequestUpdatedAt:'now',offer_id:'software-offer',offer_version:1,signatures:true,payment:true,next_update_on:'',deposit_invoice_id:invoice.id})).status).toBe(409);
  // A separate offer has its own snapshot and new attempt keys.
  sql.exec("UPDATE software_offers SET status='superseded';INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at) SELECT 'offer-2',request_id,2,'sent',terms_json,created_at,updated_at FROM software_offers WHERE id='software-offer'");
  const old=await reserveSoftwareInvoice(db,{...input,offerId:'offer-2'});
  sql.prepare("UPDATE software_invoices SET created_at='2020-01-01',creation_started_at=NULL WHERE id=?").run(old.id);
  await expect(reserveSoftwareInvoice(db,{...input,offerId:'offer-2',retryId:old.id})).rejects.toThrow('reconcile');
  for(const statement of reconciliationStatements(['--software-no-invoice',old.id,'Confirmed']))sql.exec(statement);
  const replaced=await reserveSoftwareInvoice(db,{...input,offerId:'offer-2',replaceId:old.id});
  expect(replaced.attempt).toBe(1);
});
it('rolls back invoice reservations when full payment arrives between the read and transaction',async()=>{
  const {reserveSoftwareInvoice}=await import('~/lib/software-invoices');
  await start();await shareReview();
  const original=db.batch.bind(db);
  db.batch=async items=>{
    sql.exec("INSERT INTO software_milestone_payments VALUES ('software',0,'now','owner')");
    return original(items);
  };
  await expect(reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:0,kind:'balance',allowCard:false,actor:'owner'})).rejects.toThrow();
  expect(sql.prepare('SELECT count(*) AS n FROM software_invoices').get()).toEqual({n:0});
});
it('cannot restore invoice references when retention runs between webhook lookup and transaction',async()=>{
  const {reserveSoftwareInvoice,applySoftwareInvoiceEvent}=await import('~/lib/software-invoices');
  const invoice=await reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit',allowCard:false,actor:'owner'});
  const original=db.batch.bind(db);
  db.batch=async items=>{
    sql.exec("UPDATE software_invoices SET external_refs_deleted_at='now',stripe_customer_id=NULL,hosted_invoice_url=NULL");
    return original(items);
  };
  await applySoftwareInvoiceEvent(db,{eventId:'evt_retained',eventType:'invoice.sent',invoiceId:'in_retained',requestId:'software',localId:invoice.id,offerId:invoice.offer_id,milestone:'0',kind:'deposit',status:'open',occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:'cus_should_not_restore',hostedUrl:'https://example.com/should-not-restore',dueAt:null});
  expect(sql.prepare('SELECT stripe_customer_id,hosted_invoice_url FROM software_invoices').get()).toEqual({stripe_customer_id:null,hosted_invoice_url:null});
});
it('authorizes invoice creation and preserves a recoverable attempt after provider failure',async()=>{
  env.STRIPE_PAYMENTS_ENABLED='true';env.STRIPE_SECRET_KEY='test';env.STRIPE_WEBHOOK_SECRET='test';
  const body={offer_id:'software-offer',milestone_index:0,kind:'deposit',allow_card:true};
  expect((await call(invoicePost,body,false)).status).toBe(403);
  expect((await call(invoicePost,{...body,allow_card:'true'})).status).toBe(400);
  expect(sql.prepare('SELECT count(*) AS n FROM software_invoices').get()).toEqual({n:0});
  const provider=vi.spyOn(invoiceLib,'createSoftwareInvoice');
  provider.mockRejectedValueOnce(new Error('Provider uncertain'));
  provider.mockResolvedValueOnce({stripeCustomerId:'cus_test',invoiceId:'in_test',hostedInvoiceUrl:'https://example.com/pay',dueAt:'2026-10-07T12:00:00Z',status:'open'});
  try {
    expect((await call(invoicePost,body)).status).toBe(502);
    const row=sql.prepare('SELECT * FROM software_invoices').get();
    expect(row.status).toBe('creating');
    sql.exec('UPDATE software_invoices SET creation_started_at=NULL');
    expect((await call(invoicePost,{...body,allow_card:false,retry_id:row.id})).status).toBe(200);
    expect(provider.mock.calls[0][3]).toMatchObject({id:row.id,allow_card:1,attempt:0});
    expect(provider.mock.calls[1][3]).toMatchObject({id:row.id,allow_card:1,attempt:0});
    expect(sql.prepare('SELECT status,due_at FROM software_invoices').get()).toEqual({status:'open',due_at:'2026-10-07T12:00:00Z'});
    expect(sql.prepare('SELECT count(*) AS n FROM software_invoices').get()).toEqual({n:1});
  } finally {provider.mockRestore();}
});
it('requires prior full payment before advancing an Invoice Terms milestone',async()=>{
  sql.prepare('UPDATE software_offers SET terms_json=?').run(JSON.stringify({...terms,paymentMode:'invoice',milestones:[terms.milestones[0],{...terms.milestones[0],name:'Second'}]}));
  await start();
  const project=sql.prepare('SELECT updated_at FROM software_projects').get();
  const body={action:'state',state:'building',waiting_for:'',milestone_index:1,step:'build',next_update_on:'',expectedUpdatedAt:project.updated_at};
  expect((await call(projectPost,body)).status).toBe(409);
  expect((await call(updatePost,{action:'share',expectedUpdatedAt:null,confirmed:true,update:{...update,kind:'direction_review',milestone_index:1,artifact_version:'Next direction'}})).status).toBe(409);
  sql.exec("INSERT INTO software_milestone_payments VALUES ('software',0,'now','owner')");
  expect((await call(projectPost,body)).status).toBe(200);
});
it('refuses no-invoice cancellation of recent or actively leased reservations',async()=>{
  const {reserveSoftwareInvoice}=await import('~/lib/software-invoices');
  const {reconciliationStatements}=await import('../../scripts/stripe-reconciliation.mjs');
  const invoice=await reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit',allowCard:false,actor:'owner'});
  for(const statement of reconciliationStatements(['--software-no-invoice',invoice.id,'Confirmed']))sql.exec(statement);
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('creating');
  sql.prepare("UPDATE software_invoices SET created_at='2020-01-01' WHERE id=?").run(invoice.id);
  for(const statement of reconciliationStatements(['--software-no-invoice',invoice.id,'Confirmed']))sql.exec(statement);
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('creating');
  sql.exec('UPDATE software_invoices SET creation_started_at=NULL');
  for(const statement of reconciliationStatements(['--software-no-invoice',invoice.id,'Confirmed']))sql.exec(statement);
  expect(sql.prepare('SELECT status FROM software_invoices').get().status).toBe('void');
});

function seedInvoice(status: string, kind='deposit', milestone=0, id='guard-invoice') {
  sql.prepare(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at)
    VALUES (?,'software','software-offer',?,?,120000,7,?,'owner','now','now')`).run(id,milestone,kind,status);
}
it.each(['creating','open','payment_failed','uncollectible'])('atomically rejects manual start with a %s deposit',async status=>{
  const original=db.batch.bind(db);
  db.batch=async items=>{seedInvoice(status);return original(items);};
  const response=await start();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({error:invoiceLib.manualPaymentReminder});
  expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='started'").get()).toEqual({n:0});
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['balance','milestone'])('atomically rejects manual full payment with a payable %s',async kind=>{
  await start();
  for(const status of ['creating','open','payment_failed','uncollectible']) {
    const original=db.batch.bind(db);
    db.batch=async items=>{seedInvoice(status,kind);return original(items);};
    const response=await call(projectPost,{action:'payment',milestone_index:0,confirmed:true});
    expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:invoiceLib.manualPaymentReminder});
    expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_payments').get()).toEqual({n:0});
    expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='milestone-paid'").get()).toEqual({n:0});
    db.batch=original;sql.exec('DELETE FROM software_invoices');
  }
  seedInvoice('void',kind);
  expect((await call(projectPost,{action:'payment',milestone_index:0,confirmed:true})).status).toBe(200);
});
it.each([false,true])('atomically blocks offer changes or declines for an uncollectible deposit (decline=%s)',async decline=>{
  const saved=await call(offerPost,{action:'draft',terms:{...terms,summary:'Updated'},expectedUpdatedAt:null});
  const draft=await saved.json() as {version:number;updatedAt:string};
  const original=db.batch.bind(db);
  db.batch=async items=>{seedInvoice('uncollectible');return original(items);};
  expect((await call(offerPost,decline ? {action:'decline',text:'Cannot take it on.'} : {action:'send',version:draft.version,expectedUpdatedAt:draft.updatedAt})).status).toBe(409);
  expect(sql.prepare("SELECT status FROM software_offers WHERE id='software-offer'").get()).toEqual({status:'sent'});
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'new'});
});
function laterTerms() {
  sql.prepare('UPDATE software_offers SET terms_json=?').run(JSON.stringify({...terms,milestones:[terms.milestones[0],{...terms.milestones[0],name:'Second'}]}));
}
it.each(['manual','stripe'])('requires a destination deposit before Standard moves, paid by %s',async source=>{
  laterTerms();await start();
  const body={action:'state',state:'building',waiting_for:'',milestone_index:1,step:'build',next_update_on:'',expectedUpdatedAt:sql.prepare('SELECT updated_at FROM software_projects').get().updated_at};
  expect((await call(projectPost,body)).status).toBe(409);
  expect((await call(updatePost,{action:'share',expectedUpdatedAt:null,confirmed:true,update:{...update,kind:'direction_review',milestone_index:1}})).status).toBe(409);
  expect(invoiceLib.invoiceAvailable({...terms,milestones:[terms.milestones[0],terms.milestones[0]]} as never,1,'deposit',{milestone_index:0,completed_at:null},false,false)).toBe(true);
  if(source==='stripe') {
    seedInvoice('paid','deposit',1);sql.exec("UPDATE software_invoices SET refunded_at='now'");
    expect((await call(projectPost,body)).status).toBe(409);
    sql.exec('UPDATE software_invoices SET refunded_at=NULL');
  } else {
    for(const status of ['creating','open','payment_failed','uncollectible']) {
      seedInvoice(status,'deposit',1);
      const response=await call(projectPost,{action:'deposit',milestone_index:1,confirmed:true});
      expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:invoiceLib.manualPaymentReminder});
      expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_deposits').get()).toEqual({n:0});
      sql.exec('DELETE FROM software_invoices');
    }
    expect((await call(projectPost,{action:'deposit',milestone_index:1,confirmed:false})).status).toBe(400);
    expect((await call(projectPost,{action:'deposit',milestone_index:1,confirmed:true},false)).status).toBe(403);
    for(let i=0;i<2;i++)expect((await call(projectPost,{action:'deposit',milestone_index:1,confirmed:true})).status).toBe(200);
    expect(sql.prepare("SELECT note FROM software_project_audit WHERE action='deposit-paid'").all()).toEqual([{note:'Deposit received outside Stripe · milestone 2'}]);
    expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_payments').get()).toEqual({n:0});
    await expect(invoiceLib.reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:1,kind:'deposit',allowCard:false,actor:'owner'})).rejects.toThrow('already paid');
  }
  expect((await call(projectPost,body)).status).toBe(200);
  expect(sql.prepare('SELECT milestone_index FROM software_projects').get()).toEqual({milestone_index:1});
});
it('rolls back manual later deposit if an invoice is reserved just before the batch',async()=>{
  laterTerms();await start();const original=db.batch.bind(db);
  db.batch=async items=>{seedInvoice('creating','deposit',1);return original(items);};
  expect((await call(projectPost,{action:'deposit',milestone_index:1,confirmed:true})).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM software_milestone_deposits').get()).toEqual({n:0});
  expect(sql.prepare("SELECT count(*) AS n FROM software_project_audit WHERE action='deposit-paid'").get()).toEqual({n:0});
});
it('does not reserve a later deposit racing a manual confirmation',async()=>{
  laterTerms();await start();const original=db.batch.bind(db);
  db.batch=async items=>{sql.exec("INSERT INTO software_milestone_deposits VALUES ('software',1,'now','owner')");return original(items);};
  await expect(invoiceLib.reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:1,kind:'deposit',allowCard:false,actor:'owner'})).rejects.toThrow();
  expect(sql.prepare('SELECT count(*) AS n FROM software_invoices').get()).toEqual({n:0});
});
it.each([false,true])('routes a retention-fenced webhook to unmatched, including a lookup race (%s)',async race=>{
  seedInvoice('void','balance');
  sql.exec("UPDATE software_invoices SET stripe_invoice_id='in_fenced'");
  const original=db.batch.bind(db);
  if(race) db.batch=async items=>{sql.exec("UPDATE software_invoices SET retention_fenced_at='now'");return original(items);};
  else sql.exec("UPDATE software_invoices SET retention_fenced_at='now'");
  const result=await invoiceLib.applySoftwareInvoiceEvent(db,{eventId:'evt_fenced',eventType:'invoice.paid',invoiceId:'in_fenced',requestId:'software',localId:'guard-invoice',offerId:'software-offer',milestone:'0',kind:'balance',status:'paid',occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:'cus_fenced',hostedUrl:'https://example.com/pay',dueAt:null});
  if(!race)expect(result).toBe('unmatched');
  expect(sql.prepare('SELECT status,stripe_customer_id FROM software_invoices').get()).toEqual({status:'void',stripe_customer_id:null});
  expect(sql.prepare('SELECT event_id FROM software_stripe_unmatched_events').get()).toEqual({event_id:'evt_fenced'});
  expect(sql.prepare('SELECT count(*) AS n FROM software_project_audit').get()).toEqual({n:0});
});

it('records a webhook as unmatched if retention deletes the invoice after lookup',async()=>{
  seedInvoice('void','balance');sql.exec("UPDATE software_invoices SET stripe_invoice_id='in_deleted'");
  const original=db.batch.bind(db);
  db.batch=async items=>{sql.exec('DELETE FROM software_invoices');return original(items);};
  expect(await invoiceLib.applySoftwareInvoiceEvent(db,{eventId:'evt_deleted',eventType:'invoice.paid',invoiceId:'in_deleted',requestId:'software',localId:'guard-invoice',offerId:'software-offer',milestone:'0',kind:'balance',status:'paid',occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:null,hostedUrl:null,dueAt:null})).toBe('unmatched');
  expect(sql.prepare('SELECT event_id FROM software_stripe_unmatched_events').get()).toEqual({event_id:'evt_deleted'});
  expect(sql.prepare('SELECT count(*) AS n FROM stripe_webhook_events').get()).toEqual({n:0});
});

it.each(['standard','invoice'])('blocks rejected newest delivery invoices and racing rejection (%s)',async mode=>{
  if(mode==='invoice') sql.prepare('UPDATE software_offers SET terms_json=?').run(JSON.stringify({...terms,paymentMode:mode}));
  await start();const review=await shareReview();
  const input={requestId:'software',offerId:'software-offer',milestone:0,kind:mode==='standard' ? 'balance' as const : 'milestone' as const,allowCard:false,actor:'owner'};
  const reject=()=>sql.prepare("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('software','client','client','Fix it',?,'changes_requested','now')").run(review.id);
  const original=db.batch.bind(db);
  db.batch=async items=>{reject();return original(items);};
  await expect(invoiceLib.reserveSoftwareInvoice(db,input)).rejects.toThrow();
  db.batch=original;
  await expect(invoiceLib.reserveSoftwareInvoice(db,input)).rejects.toThrow('not available');
  expect(sql.prepare('SELECT count(*) AS n FROM software_invoices').get()).toEqual({n:0});
  sql.exec("UPDATE software_project_updates SET shared_at='2020-01-01'");
  await shareReview('delivery_review','Delivery v2');
  expect((await invoiceLib.reserveSoftwareInvoice(db,input)).kind).toBe(input.kind);
});
it.each([['uncollectible','void'],['void','uncollectible']] as const)('same-second %s then %s ends void',async(first,second)=>{
  const invoice=await invoiceLib.reserveSoftwareInvoice(db,{requestId:'software',offerId:'software-offer',milestone:0,kind:'deposit',allowCard:false,actor:'owner'});
  const base={eventType:'invoice.updated',invoiceId:'in_equal',requestId:'software',localId:invoice.id,offerId:invoice.offer_id,milestone:'0',kind:'deposit',occurredAt:'2026-09-30T12:00:00Z',total:120000,currency:'usd',customerId:null,hostedUrl:null,dueAt:null};
  await invoiceLib.applySoftwareInvoiceEvent(db,{...base,eventId:'evt_first',status:first});
  await invoiceLib.applySoftwareInvoiceEvent(db,{...base,eventId:'evt_second',status:second});
  expect(sql.prepare('SELECT status FROM software_invoices').get()).toEqual({status:'void'});
});
it.each(['creating','open','payment_failed','uncollectible'])('withdrawal blocks payable %s deposits before and during batch',async status=>{
  seedInvoice(status);
  const command={id:'software',action:'withdraw' as const,actor:'owner'};
  await expect(changeOwnerRequest(db,command)).rejects.toThrow('Void');
  sql.exec('DELETE FROM software_invoices');const original=db.batch.bind(db);
  db.batch=async items=>{seedInvoice(status);return original(items);};
  await expect(changeOwnerRequest(db,command)).rejects.toThrow('Void');
  expect(sql.prepare('SELECT status FROM owner_requests').get()).toEqual({status:'new'});
  expect(sql.prepare('SELECT count(*) AS n FROM owner_request_audit').get()).toEqual({n:0});
  db.batch=original;sql.exec("UPDATE software_invoices SET status='void'");
  expect((await changeOwnerRequest(db,command)).status).toBe('withdrawn');
});
it('records bank start payment after a voided deposit',async()=>{
  seedInvoice('void');expect((await start()).status).toBe(200);
  expect(sql.prepare('SELECT first_payment_recorded_at FROM software_projects').get().first_payment_recorded_at).toBeTruthy();
  expect(sql.prepare('SELECT status FROM software_invoices').get()).toEqual({status:'void'});
});
it.each([1,2])('refunds exact later deposit %s only before that milestone starts',async milestone=>{
  const {reconciliationStatements}=await import('../../scripts/stripe-reconciliation.mjs');
  const {milestoneDepositGuard}=await import('~/lib/software-projects');
  await start();seedInvoice('paid','deposit',milestone,'refund-target');seedInvoice('paid','deposit',0,'keep-first');
  await db.batch([milestoneDepositGuard(db,'software',milestone)]);
  const statements=reconciliationStatements(['--software-deposit-refunded','refund-target','Confirmed']);
  sql.prepare('UPDATE software_projects SET milestone_index=?').run(milestone);
  for(const statement of statements)sql.exec(statement);
  expect(sql.prepare("SELECT refunded_at FROM software_invoices WHERE id='refund-target'").get().refunded_at).toBeNull();
  sql.exec('UPDATE software_projects SET milestone_index=0');
  for(const statement of statements)sql.exec(statement);
  expect(sql.prepare("SELECT refunded_at FROM software_invoices WHERE id='refund-target'").get().refunded_at).toBeTruthy();
  expect(sql.prepare("SELECT refunded_at FROM software_invoices WHERE id='keep-first'").get().refunded_at).toBeNull();
  await expect(db.batch([milestoneDepositGuard(db,'software',milestone)])).rejects.toThrow();
});

it.each([false,true])('blocks resolving an active software project atomically (starts during batch=%s)',async races=>{
  if (!races) await start();
  const original=db.batch.bind(db);
  if (races) db.batch=async items=>{
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('software','software-offer',?,'standard','now','now','now','owner','now','now')").run(termsJson);
    return original(items);
  };
  const response=await call(requestPost,{action:'resolve'});
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ok:false,message:'Mark the project complete first.'});
  expect(sql.prepare("SELECT status,resolved_at FROM owner_requests WHERE id='software'").get()).toEqual({status:races ? 'new' : 'reviewed',resolved_at:null});
  expect(sql.prepare("SELECT count(*) AS n FROM owner_request_audit WHERE action='resolved'").get()).toEqual({n:0});
});
it.each(['completed_at','revoked_at'])('allows resolving a software project with %s recorded',async column=>{
  await start();sql.exec(`UPDATE software_projects SET ${column}='now'`);
  expect((await call(requestPost,{action:'resolve'})).status).toBe(200);
});
it('allows resolving a software request without a project',async()=>{
  expect((await call(requestPost,{action:'resolve'})).status).toBe(200);
});
