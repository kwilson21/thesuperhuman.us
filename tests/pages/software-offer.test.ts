import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, serialize } from 'parse5';
import { vi } from 'vitest';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { hashOfferToken } from '~/lib/software-offers';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let start: any;
let directory: string, softwarePage: any, composer: any, today: any, page: any, preview: any, editor: any, questions: any, fit: any, panel: any, ownerRequest: any;
const token = 'a'.repeat(43);
const terms = { outcome:'Current offer',summary:'A shared view.',milestones:[{ name:'Tracker',deliverables:['Status view'],acceptance:['Add a client.'],feeCents:240000 }],clientInputs:'',exclusions:'',timing:'',paymentMode:'standard' };
beforeAll(async () => {
  directory = await mkdtemp(resolve('.software-render-'));
  await build({ entryPoints:{ start:'src/pages/software/start.astro', panel:'src/components/owner/SoftwareProjectPanel.astro', ownerRequest:'src/pages/owner/requests/[id].astro', today:'src/pages/owner/index.astro', composer:'src/pages/owner/requests/[id]/update.astro', software:'src/pages/studio/software/[id].astro', client:'src/pages/offer/[token].astro', preview:'src/pages/owner/requests/[id]/offer.astro', editor:'src/components/owner/SoftwareOfferEditor.astro', questions:'src/components/owner/SoftwareQuestions.astro', fit:'src/components/owner/SoftwareFitReview.astro' }, outdir:directory, outExtension:{ '.js':'.mjs' }, bundle:true, format:'esm', platform:'node', packages:'external',
    plugins:[{ name:'astro-test-render', setup(builder) {
      builder.onResolve({ filter:/\.css(?:\?|$)|\?astro/ }, () => ({ path:'empty-style',namespace:'empty' }));
      builder.onLoad({ filter:/.*/,namespace:'empty' }, () => ({ contents:'',loader:'js' }));
      builder.onResolve({ filter:/^~\// }, args => ({ path:resolve('src',args.path.slice(2)) + (args.path.endsWith('.astro') ? '' : '.ts') }));
      builder.onLoad({ filter:/\.astro$/ }, async args => ({ contents:(await transform(await readFile(args.path,'utf8'),{ filename:args.path,internalURL:'astro/compiler-runtime',astroGlobalArgs:'"https://thesuperhuman.us"',resolvePath:specifier => specifier })).code,loader:'ts',resolveDir:dirname(args.path) }));
    } }],
  });
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(directory)) { const compiled = (await import(/* @vite-ignore */ pathToFileURL(resolve(directory,file)).href)).default; if (file.startsWith('start')) start = compiled; else if (file.startsWith('panel')) panel = compiled; else if (file.startsWith('ownerRequest')) ownerRequest = compiled; else if (file.startsWith('today')) today = compiled; else if (file.startsWith('composer')) composer = compiled; else if (file.startsWith('software')) softwarePage = compiled; else if (file.startsWith('client')) page = compiled; else if (file.startsWith('preview')) preview = compiled; else if (file.startsWith('editor')) editor = compiled; else if (file.startsWith('questions')) questions = compiled; else fit = compiled; }
});
afterAll(async () => { if (directory) await rm(directory,{ recursive:true,force:true }); });
async function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(resolve('db/music.sql'),'utf8'));
  sql.prepare(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at)
    VALUES ('r','software','workflow','Alex Example','alex@example.com','Tool','{"company":"Example Studio","fit":"PRIVATE FIT"}','new','PRIVATE NOTE','now','now')`).run();
  sql.prepare("INSERT INTO software_fit_reviews VALUES ('r','needs-clarification','PRIVATE FIT REVIEW','now','PRIVATE REVIEWER')").run();
  const offer = sql.prepare(`INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by) VALUES (?,'r',?,?,?,'now','now','now','PRIVATE ACTOR')`);
  offer.run('old',1,'superseded',JSON.stringify({ ...terms,outcome:'OLD PRIVATE TERMS' }));
  offer.run('current',2,'sent',JSON.stringify(terms));
  offer.run('draft',3,'draft',JSON.stringify({ ...terms,outcome:'DRAFT PRIVATE TERMS' }));
  sql.exec("UPDATE software_offers SET sent_at=NULL,sent_by=NULL WHERE status='draft'");
  sql.prepare("INSERT INTO software_offer_links VALUES ('r',?,'now',NULL)").run(await hashOfferToken(token));
  const statement = (query: string,args: unknown[] = []) => ({ bind:(...values:unknown[]) => statement(query,values),first:async () => sql.prepare(query).get(...args) ?? null, all:async () => ({ results:sql.prepare(query).all(...args) }) });
  return { sql, db:{ prepare:(query:string) => statement(query) } };
}
async function render(db: unknown,value: string) {
  const container = await AstroContainer.create();
  return container.renderToResponse(page,{ partial:false,request:new Request(`https://thesuperhuman.us/offer/${value}`),params:{ token:value },locals:{ runtime:{ env:{ MUSIC_DB:db } } } as any });
}
it('renders the latest sent terms and excludes all private and draft data', async () => {
  const { sql,db } = await fixture();
  try {
    const response = await render(db,token), html = await response.text(); expect(response.status).toBe(200);
    expect(html).toContain('Current offer'); expect(html).toContain('Offer v2'); expect(html).toContain('replaces v1');
    expect(html).not.toMatch(/PRIVATE|alex@example.com|Preview\./);
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(html).toContain('noindex,nofollow');
  } finally { sql.close(); }
});
it('renders unknown, revoked and no-sent links as identical private 404s', async () => {
  const { sql,db } = await fixture();
  try {
    const unknown = await render(db,'b'.repeat(43)), unknownHTML = await unknown.text(); expect(unknown.status).toBe(404);
    sql.exec("UPDATE software_offer_links SET revoked_at='now'");
    const revoked = await render(db,token); expect(revoked.status).toBe(404); expect(await revoked.text()).toBe(unknownHTML);
    sql.exec("UPDATE software_offer_links SET revoked_at=NULL; UPDATE software_offers SET status='withdrawn' WHERE status='sent'");
    const empty = await render(db,token); expect(empty.status).toBe(404); expect(await empty.text()).toBe(unknownHTML);
    expect(unknownHTML).toContain('This offer isn’t available.'); expect(unknownHTML).not.toMatch(/Current offer|Example Studio|PRIVATE/);
  } finally { sql.close(); }
});

it('protects owner previews and selects draft or exact sent version without private fields', async () => {
  const { sql,db } = await fixture();
  const container = await AstroContainer.create();
  const renderPreview = (owner = true, query = '') => container.renderToResponse(preview, { partial:false, request:new Request(`https://thesuperhuman.us/owner/requests/r/offer${query}`), params:{ id:'r' }, locals:{ owner:owner ? { email:'owner@example.com' } : undefined, runtime:{ env:{ MUSIC_DB:db } } } } as any);
  try {
    expect((await renderPreview(false)).status).toBe(403);
    const draftHTML = await (await renderPreview()).text();
    expect(draftHTML).toContain('Preview. This is what the client sees.');
    expect(draftHTML).toContain('DRAFT PRIVATE TERMS');
    expect(draftHTML).not.toMatch(/PRIVATE NOTE|PRIVATE FIT|PRIVATE ACTOR|PRIVATE REVIEWER|alex@example.com/);
    const sentHTML = await (await renderPreview(true,'?version=2')).text();
    expect(sentHTML).toContain('Current offer'); expect(sentHTML).not.toContain('DRAFT PRIVATE TERMS');
    expect((await renderPreview(true,'?version=3')).status).toBe(404);
    expect((await renderPreview(true,'?version=99')).status).toBe(404);
  } finally { sql.close(); }
});

it('renders reload guidance, resolved controls, and the reopened editor', async () => {
  const { sql,db } = await fixture();
  try {
    const offers = (await db.prepare("SELECT * FROM software_offers WHERE request_id='r' ORDER BY version DESC").all()).results;
    const container = await AstroContainer.create();
    const renderEditor = (resolved:boolean, revoked = false) => container.renderToString(editor, { props:{ requestId:'r', email:'alex@example.com', offers, revoked, resolved, linkCreatedAt:'displayed-link' } });
    const open = await renderEditor(false);
    expect(open).toContain('The client link is in your copy of the offer email. To issue a new one, revoke this link and send again.');
    expect(open).toContain('data-offer-form');
    expect(open).toContain('data-link-created-at="displayed-link"');
    expect(open).toContain('aria-describedby="milestone-1-deliverables-hint"');
    const closed = await renderEditor(true);
    expect(closed).toContain('This request is resolved. Reopen it to make a new offer.');
    expect(closed).not.toMatch(/data-offer-form|Save draft|data-preview-offer|data-send-offer/);
    expect(closed).toContain('The client link is in your copy of the offer email.');
    expect(closed).not.toContain('revoke this link and send again');
    expect(closed).toContain('data-revoke-link'); expect(closed).toContain('Offer v2');
    expect(await renderEditor(false)).toContain('data-offer-form');
    expect(await renderEditor(true,true)).toContain('The client link is revoked. Reopen this request to make a new offer.');
  } finally { sql.close(); }
});

it('keeps question, decline and fit hints outside their accessible labels', async () => {
  const container = await AstroContainer.create();
  const questionHTML = await container.renderToString(questions, { props:{ requestId:'r' } });
  for (const action of ['question','decline']) {
    expect(questionHTML).toContain(`aria-describedby="software-${action}-hint"`);
    expect(questionHTML).toContain(`</label><p id="software-${action}-hint"`);
  }
  const fitHTML = await container.renderToString(fit, { props:{ requestId:'r', fit:null } });
  expect(fitHTML).toContain('aria-describedby="software-fit-note-hint"');
  expect(fitHTML).toContain('</label><p id="software-fit-note-hint"');
});

it('shows the next draft version after decline and reopen', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(editor, { props: { requestId:'r', email:'alex@example.com', revoked:true, offers:[{ version:2, status:'withdrawn', sent_at:'2026-09-29T12:00:00Z' },{ version:1, status:'superseded', sent_at:'2026-09-28T12:00:00Z' }] } });
  expect(html).toContain('Draft v3 · Not sent');
});

it('hides withdrawn offer controls and renders saved fit history as text', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(editor, { props:{ requestId:'r',email:'alex@example.com',offers:[],revoked:false,withdrawn:true } });
  expect(html).toContain('This request is withdrawn.'); expect(html).not.toMatch(/data-offer-form|data-send-offer|data-preview-offer/);
  const fitHTML = await container.renderToString(fit, { props:{ requestId:'r',fit:{ label:'potential-fit',note:'Saved note' },closed:true } });
  expect(fitHTML).toContain('Potential fit'); expect(fitHTML).toContain('Saved note'); expect(fitHTML).not.toContain('<form');
});
it.each([false,true])('replaces only an earlier delivered version (earlier sent %s)', async earlierSent => {
  const { sql,db } = await fixture();
  try {
    sql.exec("UPDATE software_offers SET status='withdrawn',sent_at=NULL WHERE version=1");
    if (earlierSent) {
      sql.exec("UPDATE software_offers SET status='superseded',sent_at='now' WHERE version=1; UPDATE software_offers SET status='withdrawn',sent_at=NULL WHERE version=2; UPDATE software_offers SET status='sent',sent_at='now' WHERE version=3");
    }
    const html = await (await render(db,token)).text();
    if (earlierSent) expect(html).toContain('replaces v1'); else expect(html).not.toContain('replaces');
  } finally { sql.close(); }
});

it('returns an unavailable 404 without project data for foreign and revoked software ids', async () => {
  const {sql,db} = await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,state,step,milestone_index,waiting_for,next_update_on,started_at,started_by,updated_at,signatures_recorded_at,first_payment_recorded_at,created_at,invitation_status) VALUES ('r','current',?,'standard','preparing','direction',0,'',NULL,'now','owner','now','now','now','now','sent')").run(JSON.stringify(terms));
    const {createHash} = await import('node:crypto'); const token = 'a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,?,'now','2099-01-01','now')").run(createHash('sha256').update(token).digest('hex'),'foreign@example.com');
    const container = await AstroContainer.create();
    for (const revoked of [false,true]) {
      if (revoked) { sql.exec("UPDATE audio_client_sessions SET email='alex@example.com'; UPDATE software_projects SET revoked_at='now'"); }
      const response = await container.renderToResponse(softwarePage,{partial:false,request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${token}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
      const html = await response.text(); expect(response.status).toBe(404); expect(html).toContain('This project isn’t available');
      for (const secret of ['Current offer','PRIVATE NOTE','PRIVATE FIT','Status view']) expect(html).not.toContain(secret);
    }
  } finally {sql.close();}
});

it('renders started offers as history without initializing editor actions', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(editor,{props:{requestId:'r',email:'alex@example.com',revoked:false,startedVersion:2,offers:[{id:'current',version:2,status:'sent',terms_json:JSON.stringify(terms),sent_at:'2026-09-29T12:00:00Z'}]}});
  expect(html).toContain('The project started from offer v2.'); expect(html).toContain('Versions'); expect(html).toContain('Offer v2');
  expect(html).not.toContain('data-software-editor'); expect(html).not.toContain('data-offer-form'); expect(html).not.toContain('data-send-offer');
});
it('renders version-specific direction, delivery, acceptance, handoff and earlier decisions without private fields',async()=>{
  const {sql,db}=await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','PRIVATE OWNER','now','now')").run(JSON.stringify(terms));
    const {createHash}=await import('node:crypto'),session='a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    const container=await AstroContainer.create();
    const renderProject=()=>container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('direction','r','direction_review','shared',0,'Proposed direction','Direction v1','concept','PRIVATE AUTHOR','2026-09-29','2026-09-29','2026-09-29',5)");
    let html=await renderProject();expect(html).toContain('Does this match how you work?');expect(html).toContain('Confirm direction');expect(html).toContain('The working milestone is reviewed separately.');
    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','PRIVATE TOKEN','Direction confirmed','direction','direction_confirmed','2026-09-30')");
    html=await renderProject();expect(html).toContain('You confirmed this direction on Sep 30, 2026.');expect(html).not.toContain('data-software-review');
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,criteria_json,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('delivery','r','delivery_review','shared',0,'Working tracker','Delivery v1','working_preview','[\"Try adding the fictional client.\"]','PRIVATE AUTHOR','2026-10-01','2026-10-01','2026-10-01',5)");
    html=await renderProject();expect(html).toContain('Your first milestone is ready to review.');expect(html).toContain('Please review by Oct 8, 2026.');expect(html).toContain('Try adding the fictional client.');expect(html).toContain('Demonstrated');expect(html).toContain('Accept milestone');expect(html).toContain('name="criteria"');expect(html).toContain('No automatic acceptance from silence.');
    sql.exec("INSERT INTO software_project_updates(id,request_id,status,kind,milestone_index,title,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('progress','r','shared','progress',0,'Progress after review','concept','owner','2026-10-02','2026-10-02','2026-10-02')");
    html=await renderProject();expect(html).toContain('data-software-review');expect(html).toContain('/reviews/delivery');expect(html).toContain('Try adding the fictional client.');expect(html).not.toContain('This update is shown for reference.');expect(html).not.toContain('Earlier versions');expect(html.indexOf('Your review')).toBeLessThan(html.indexOf('What we agreed'));
    const multiTerms={...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Follow-up'}]};
    sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify(multiTerms));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('pending-direction','r','direction_review','shared',1,'Next direction','Direction v2','concept','owner','2026-10-03','2026-10-03','2026-10-03')");
    html=await renderProject();
    expect(html).toContain('Your first milestone is ready to review.');expect(html).toContain('Please review by Oct 8, 2026.');
    const rail=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'));
    expect(rail.indexOf('/reviews/delivery')).toBeLessThan(rail.indexOf('/reviews/pending-direction'));
    expect(rail).toContain('Accept milestone');expect(rail).toContain('Confirm direction');
    expect(html.slice(html.indexOf('Earlier updates'))).not.toContain('/reviews/pending-direction');
    sql.exec("DELETE FROM software_project_updates WHERE id='pending-direction'; UPDATE software_projects SET milestone_index=1");
    html=await renderProject();
    expect(html.slice(html.indexOf('class="project-band'),html.indexOf('class="project-columns'))).toContain('Milestone 2 · Follow-up');
    expect(html.slice(html.indexOf('<aside'),html.indexOf('</aside>'))).toContain('Tracker');

    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','PRIVATE TOKEN','Accepted Delivery v1','delivery','milestone_accepted','2026-10-02')");
    html=await renderProject();expect(html).not.toContain('Your first milestone is ready to review.');expect(html).not.toContain('Please review by');expect(html).toContain('You accepted Delivery v1 on Oct 2, 2026.');expect(html).toContain('Handoff follows full payment.');
    sql.exec("INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-01','PRIVATE OWNER'); INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,next_step,created_by,created_at,updated_at,shared_at) VALUES ('handoff','r','handoff','shared',0,'Delivered files','handoff','[{\"label\":\"Handoff notes\",\"url\":\"https://example.com/notes\"}]','Anything new is a separate milestone.','PRIVATE AUTHOR','2026-10-03','2026-10-03','2026-10-03')");
    html=await renderProject();expect(html).toContain('Handoff ready');expect(html).toContain('Handoff notes');expect(html).toContain('Corrections through Oct 31, 2026.');expect(html).toContain('Earlier updates');expect(html).not.toContain('After acceptance');
    sql.prepare("UPDATE software_project_updates SET links_json=? WHERE id='handoff'").run(JSON.stringify([{label:'Project files',url:'https://thesuperhuman.us/studio/files'},{label:'External files',url:'https://example.com/files'}]));
    html=await renderProject();
    expect(html).toMatch(/href="https:\/\/thesuperhuman.us\/studio\/files">Project files <span aria-hidden="true"[^>]*>→<\/span>/);
    expect(html).toMatch(/href="https:\/\/example.com\/files" target="_blank" rel="noopener noreferrer">External files <span aria-hidden="true"[^>]*>↗<\/span>/);
    sql.prepare("UPDATE software_projects SET terms_json=?").run(JSON.stringify({...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Follow-up'}]}));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('direction2','r','direction_review','shared',1,'Follow-up direction','Direction v1','concept','owner','2026-10-04','2026-10-04','2026-10-04')");
    html=await renderProject();expect(html).toContain('/reviews/direction2');expect(html).toContain('Handoff ready');expect(html).toContain('Project files');expect(html).toContain('Corrections through Oct 31, 2026.');
    sql.exec("UPDATE software_project_updates SET status='superseded' WHERE id='direction2'; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('second-delivery','r','delivery_review','shared',1,'Follow-up delivery','Follow-up v1','working_preview','owner','2026-10-05','2026-10-05','2026-10-05'); INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted follow-up','second-delivery','milestone_accepted','2026-10-06'); INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,next_step,created_by,created_at,updated_at,shared_at) VALUES ('second-handoff','r','handoff','shared',1,'Follow-up files','handoff','[{\"label\":\"Follow-up notes\",\"url\":\"https://example.com/follow-up\"}]','Follow-up corrections only.','owner','2026-10-07','2026-10-07','2026-10-07')");
    html=await renderProject();const strips=html.slice(html.indexOf('class="project-history'));
    expect(strips.indexOf('Follow-up v1 is accepted.')).toBeLessThan(strips.indexOf('Delivery v1 is accepted.'));
    expect(strips).toContain('Follow-up notes');expect(strips).toContain('Follow-up corrections only.');expect(strips).toContain('Corrections through Nov 5, 2026.');expect(strips).toContain('Project files');
    sql.exec("DELETE FROM software_project_messages WHERE update_id='second-delivery'; DELETE FROM software_project_updates WHERE id IN ('second-delivery','second-handoff')");
    sql.exec("DELETE FROM software_milestone_payments; UPDATE software_project_updates SET status='superseded' WHERE id='delivery'; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('delivery2','r','delivery_review','shared',0,'Corrected tracker','Delivery v2','working_preview','owner','2026-10-10','2026-10-10','2026-10-10',5); INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted Delivery v2','delivery2','milestone_accepted','2026-10-12')");
    html=await renderProject();expect(html).toContain('Corrections through Nov 1, 2026.');expect(html).not.toContain('Handoff ready');
    for(const secret of ['PRIVATE OWNER','PRIVATE AUTHOR','PRIVATE TOKEN','PRIVATE NOTE','PRIVATE FIT REVIEW','240000']) expect(html).not.toContain(secret);
    const ownerHTML=await container.renderToString(composer,{request:new Request('https://thesuperhuman.us/owner/requests/r/update'),params:{id:'r'},locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    expect(ownerHTML).toContain('Delivery review');expect(ownerHTML).toContain('Acceptance checks');expect(ownerHTML).toContain('At least 5 Business Days.');expect(ownerHTML).toContain('This milestone is paid in full');expect(ownerHTML).toContain('Keep the files available for at least 30 days.');
  } finally {sql.close();}
});

it('renders the pending review before newer updates in a separate latest section', async () => {
  const {sql,db} = await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','now')").run(JSON.stringify(terms));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('delivery','r','delivery_review','shared',0,'Pending delivery','Delivery v1','working_preview','owner','2026-09-29','2026-09-29','2026-09-29'),('progress','r','progress','shared',0,'Newer concept','v1','concept','owner','2026-09-30','2026-09-30','2026-09-30'),('progress2','r','progress','shared',0,'Newest concept','v2','concept','owner','2026-10-01','2026-10-01','2026-10-01')");
    const {createHash} = await import('node:crypto'), session = 'a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    const container = await AstroContainer.create();
    const renderProject = () => container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    let html = await renderProject();
    expect(html).toContain('Your first milestone is ready to review.');
    const current = html.slice(html.indexOf('class="project-current'),html.indexOf('<aside'));
    expect(current).toMatch(/Pending delivery[\s\S]*<section class="latest-updates[^>]*>[\s\S]*<h3[^>]*>Latest update<\/h3>[\s\S]*Newest concept[\s\S]*Newer concept/);
    expect(html.match(/Newer concept/g)).toHaveLength(1);
    expect(html.match(/Newest concept/g)).toHaveLength(1);
    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','client','Accepted','delivery','milestone_accepted','2026-10-02')");
    html = await renderProject();
    expect(html).not.toContain('Latest update');
    expect(html.slice(html.indexOf('class="project-current'),html.indexOf('<aside'))).toContain('Newest concept');
    expect(html.slice(html.indexOf('class="project-current'),html.indexOf('<aside'))).not.toContain('Pending delivery');
  } finally {sql.close();}
});

it('keeps update requests separate from Waiting on you and renders the Today software row', async () => {
  const {sql,db} = await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,next_update_on) VALUES ('r','current',?,'invoice','now','now','2026-09-29','owner','now','now','2026-10-08')").run(JSON.stringify(terms));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,what_changed,client_request,created_by,created_at,updated_at,shared_at) VALUES ('u','r','progress','shared',0,'An update','concept','A concept','Send a sample','owner','now','now','2026-09-29')");
    const {createHash} = await import('node:crypto'); const session = 'a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    const container = await AstroContainer.create();
    const renderProject = () => container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    let html = await renderProject();
    expect(html).toContain('Send a sample'); expect(html).not.toContain('Waiting on you');
    expect(html).not.toContain('What I’ll need from you'); expect(html).not.toContain('Outside this offer');
    expect(html).toContain('Payment · Invoiced on delivery'); expect(html).toContain('aria-label="Next steps"');
    expect(html).toMatch(/Ask a question <span aria-hidden="true"[^>]*>↓/);
    sql.exec("UPDATE software_projects SET state='waiting_for_input',waiting_for='A redacted sample export.',next_update_on='2026-09-28'");
    html = await renderProject(); expect(html).toContain('Waiting on you'); expect(html).toContain('A redacted sample export.');
    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at) VALUES ('r','client','alex@example.com','Question','2026-09-29')");
    html = await container.renderToString(today,{locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    expect(html).toContain('Projects needing a next step'); expect(html).toMatch(/<strong[^>]*>Current offer<\/strong>/);
    expect(html).toContain('Waiting for your input'); expect(html).toMatch(/class="studio-pill signal[^"]*"[^>]*>Update promised for Sep 28/);
    sql.exec("UPDATE software_projects SET state='complete'");
    html = await renderProject(); expect(html).not.toContain('href="#conversation"');
  } finally {sql.close();}
});

it('returns a private temporary-unavailable 503 without the database', async () => {
  const response = await render(undefined,token), html = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(html).toContain('This offer is temporarily unavailable.');
  expect(html).toContain('Please try again later.');
  expect(html).not.toContain('Ask Kazon for a current link');
});

it('hides Reopen for a started request and gates both sending retry controls at one minute', async()=>{
  const {sql,db}=await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,invitation_status) VALUES ('r','current',?,'invoice','now','now','now','owner','now','now','sending')").run(JSON.stringify(terms));
    sql.exec("UPDATE owner_requests SET status='reviewed'");
    const container=await AstroContainer.create(),locals={owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}};
    const ownerHTML=await container.renderToString(ownerRequest,{params:{id:'r'},request:new Request('https://thesuperhuman.us/owner/requests/r'),locals:locals as any});
    expect(ownerHTML).not.toContain('data-action="reopen"');expect(ownerHTML).not.toContain('data-action="resolve"');
    for (const column of ['completed_at','revoked_at']) {
      sql.exec(`UPDATE software_projects SET ${column}='now'`);
      const closedHTML=await container.renderToString(ownerRequest,{params:{id:'r'},request:new Request('https://thesuperhuman.us/owner/requests/r'),locals:locals as any});
      expect(closedHTML).toContain('data-action="resolve"');
      sql.exec(`UPDATE software_projects SET ${column}=NULL`);
    }
    const now=Date.now();
    const clock=Date.now; Date.now=()=>now;
    try {
      for(const age of [59_999,60_000]) {
        const attempted=new Date(now-age).toISOString();
        sql.prepare('UPDATE software_projects SET invitation_attempted_at=?').run(attempted);
        const project=sql.prepare('SELECT * FROM software_projects').get();
        const html=await container.renderToString(panel,{props:{requestId:'r',project,closed:false,updates:[{id:'u',kind:'progress',status:'shared',title:'Update',notification_status:'sending',notification_attempted_at:attempted}]},locals:locals as any});
        if(age<60_000) {
          expect(html).not.toContain('data-software-notice');
          expect(html.match(/Checking delivery. Retry is available after a minute./g)).toHaveLength(2);
        } else expect(html.match(/I checked Resend; retry/g)).toHaveLength(2);
      }
    } finally {Date.now=clock;}
  } finally {sql.close();}
});

it('renders offer-scoped deposit controls before start and a paid deposit confirmation without a project',async()=>{
  const {sql,db}=await fixture();
  try {
    const container=await AstroContainer.create(),sentOffer=sql.prepare("SELECT * FROM software_offers WHERE id='current'").get();
    const ownerPanel=()=>container.renderToString(panel,{props:{requestId:'r',requestUpdatedAt:'now',sentOffer,project:null,updates:[],closed:false},locals:{runtime:{env:{MUSIC_DB:db}}} as any});
    let html=await ownerPanel();expect(html).toContain('Create deposit invoice');expect(html).toContain('Allow card for this invoice');
    sql.exec(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,created_by,created_at,updated_at)
      VALUES ('old-deposit','r','old',0,'deposit',120000,7,'paid','PRIVATE OWNER','2026-09-29','2026-09-29')`);
    html=await ownerPanel();expect(html).not.toContain('data-deposit-invoice-id');expect(html).toContain('Create deposit invoice');
    sql.exec(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,stripe_customer_id,hosted_invoice_url,due_at,created_by,created_at,updated_at)
      VALUES ('current-deposit','r','current',0,'deposit',120000,7,'open','cus_PRIVATE','https://example.com/deposit','2026-10-07','PRIVATE OWNER','2026-09-30','2026-09-30')`);
    html=await ownerPanel();expect(html).toContain('Deposit · Open · Due Oct 7, 2026');expect(html).toMatch(/<a[^>]*style="white-space: nowrap"[^>]*>Open invoice ↗<\/a>/);expect(html).not.toContain('Create deposit invoice');
    sql.exec("UPDATE software_invoices SET status='paid',status_updated_at='2026-09-30' WHERE id='current-deposit'");
    html=await ownerPanel();expect(html).toContain('data-deposit-invoice-id="current-deposit"');expect(html).toMatch(/name="payment"[^>]*checked/);expect(html).not.toContain('cus_PRIVATE');
    expect(sql.prepare('SELECT count(*) AS n FROM software_projects').get()).toEqual({n:0});
  } finally {sql.close();}
});
it('renders only the client project invoices with private payment links and preserves manual initial payment',async()=>{
  const {sql,db}=await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','now')").run(JSON.stringify(terms));
    const {createHash}=await import('node:crypto'),session='a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    sql.exec(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,stripe_customer_id,stripe_invoice_id,hosted_invoice_url,due_at,created_by,created_at,updated_at)
      VALUES ('current-balance','r','current',0,'balance',120000,15,'open','cus_PRIVATE','in_PRIVATE','https://example.com/balance','2026-10-15','PRIVATE OWNER','2026-09-30','2026-09-30'),
      ('old-deposit','r','old',0,'deposit',111111,7,'paid','cus_PRIVATE_OLD','in_PRIVATE_OLD','https://example.com/old-secret','2026-10-01','PRIVATE OWNER','2026-09-29','2026-09-29')`);
    const container=await AstroContainer.create();
    const renderProject=()=>container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    let html=await renderProject();expect(html).toContain('Invoices');expect(html).toContain('Pay invoice ↗');expect(html).toContain('$1,200.00');expect(html).toContain('Due Oct 15, 2026');expect(html).toContain('Initial payment · Received');
    expect(html).not.toMatch(/PRIVATE|old-secret|1,111.11/);
    for (const status of ['open','payment_failed','uncollectible','paid','void']) {
      sql.prepare("UPDATE software_invoices SET status=? WHERE id='current-balance'").run(status);
      html=await renderProject();
      expect(html.includes('Pay invoice ↗')).toBe(['open','payment_failed','uncollectible'].includes(status));
    }
    sql.exec("UPDATE software_invoices SET status='open' WHERE id='current-balance'");
    sql.exec(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at)
      VALUES ('current-deposit','r','current',0,'deposit',120000,7,'payment_failed','https://example.com/deposit','owner','2026-09-30','2026-09-30')`);
    html=await renderProject();expect(html).toContain('Initial payment · Received');
    expect(html).toContain('Deposit · $1,200.00 · Payment failed');
    sql.exec("UPDATE software_invoices SET status='void' WHERE id='current-deposit'");
    html=await renderProject();expect(html).toContain('Initial payment · Received');expect(html).toContain('Deposit · $1,200.00 · Void');
    expect(html.indexOf('Deposit · $1,200.00')).toBeLessThan(html.indexOf('Balance · $1,200.00'));
    sql.exec("UPDATE software_invoices SET status='paid',status_updated_at='2026-10-01' WHERE id='current-deposit'");
    html=await renderProject();expect(html).toContain('Initial payment · Received');expect(html).toContain('Deposit · $1,200.00 · Paid Oct 1, 2026');
    sql.exec("UPDATE software_invoices SET status='void' WHERE id='current-deposit'");
    html=await renderProject();expect(html).toContain('Initial payment · Received');
  } finally {sql.close();}
});

it('renders the approved receipt and keeps booking reassurance only on the send step', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(start, { request:new Request('https://thesuperhuman.us/software/start'), locals:{runtime:{env:{PUBLIC_TURNSTILE_SITE_KEY:'test',MUSIC_DB:{},TURNSTILE_SECRET_KEY:'test',RATE_LIMIT:{}}}} as any });
  for (const copy of ['Software brief · sent','Your brief is in.','I reply with a fixed-price first milestone, or a question or two.','If it looks right, you sign the agreement online. It takes about two minutes.','Work starts, and you follow it on your own private project page.']) expect(html).toContain(copy);
  expect(html).not.toMatch(/data-print|Print or save|Not provided/);
  expect(html.match(/No booking or payment at this stage\./g)).toHaveLength(1);
  const receipt = parse(html) as any;
  const find = (node: any): any => node.attrs?.some((attr: any) => attr.name === 'class' && attr.value.split(' ').includes('intake-next-steps')) ? node : node.childNodes?.map(find).find(Boolean);
  const steps = find(receipt);
  expect(steps?.tagName).toBe('ol');
  expect(steps.childNodes.filter((node: any) => node.tagName === 'li')).toHaveLength(3);
  expect(await readFile('src/styles/audio-intake.css', 'utf8')).toMatch(/\.intake-next-steps\s*\{[^}]*list-style:\s*decimal\s*[;}]/);
});

it('renders each owner brief outcome and gates uncertain retry at one minute', async () => {
  const {sql,db} = await fixture();
  const container = await AstroContainer.create();
  try {
    for (const [status,age,button] of [[null,0,true],['sent',120000,false],['failed',0,true],['uncertain',0,false],['uncertain',120000,true]] as const) {
      if (status === null) sql.exec("UPDATE owner_requests SET details_json=json_remove(details_json,'$.clientCopyStatus','$.clientCopyAttemptedAt')");
      else sql.prepare("UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus',?,'$.clientCopyAttemptedAt',?)").run(status,new Date(Date.now()-age).toISOString());
      const html = await container.renderToString(ownerRequest,{params:{id:'r'},request:new Request('https://thesuperhuman.us/owner/requests/r'),locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db}}} as any});
      expect(html).toContain(`Client copy: ${status == null || status === 'failed' ? "didn&#39;t send" : status}`);
      expect(html.includes('data-send-project-invitation')).toBe(button);
      expect(html.includes('data-confirmed-not-sent="true"')).toBe(status === 'uncertain' && button);
    }
  } finally {sql.close();}
});

it('renders all three personalized receipt outcomes into the rendered page', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(start,{request:new Request('https://thesuperhuman.us/software/start'),locals:{runtime:{env:{}}} as any});
  const dom = parse(html);
  const find = (node: any, attribute: string): any => node.attrs?.some((attr: any) => attr.name === attribute) ? node : node.childNodes?.map((child: any) => find(child,attribute)).find(Boolean);
  const document = {querySelector: (selector: string) => {
    if (selector === '#software-inquiry') return null;
    const node = find(dom,selector.slice(1,-1));
    return {
      set textContent(value: string) { node.childNodes = [{nodeName:'#text',value,parentNode:node}]; },
      set hidden(value: boolean) { node.attrs = node.attrs.filter((attr: any) => attr.name !== 'hidden'); if (value) node.attrs.push({name:'hidden',value:''}); },
    };
  }};
  vi.stubGlobal('document',document);
  try {
    const {renderSoftwareReceipt} = await import('~/scripts/software-inquiry');
    for (const [status,line,note] of [
      ['sent','A copy is on its way to alex@example.com.',"It has everything you wrote, so you don't need to save this page."],
      ['uncertain','Your copy should arrive shortly.',"If it doesn't, your brief is still saved and I'll still reply."],
      [undefined,"I couldn't send your copy just now, but your brief is saved and I'll still reply.",null],
      ['failed',"I couldn't send your copy just now, but your brief is saved and I'll still reply.",null],
    ]) {
      renderSoftwareReceipt({brief:{name:'Alex Example',email:'alex@example.com'},clientCopyStatus:status});
      expect(serialize(find(dom,'data-receipt-thanks'))).toBe("Thanks, Alex. I'll read it myself and reply within two business days.");
      expect(serialize(find(dom,'data-copy-status'))).toBe(line);
      const renderedNote = find(dom,'data-copy-note');
      expect(renderedNote.attrs.some((attr: any) => attr.name === 'hidden')).toBe(note === null);
      if (note) expect(serialize(renderedNote)).toBe(note);
    }
  } finally {vi.unstubAllGlobals();}
});
