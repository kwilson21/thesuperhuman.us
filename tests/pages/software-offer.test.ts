import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, serialize } from 'parse5';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { hashOfferToken, type OfferTerms } from '~/lib/software-offers';
import { agreementValues, agreementDetailsSchema } from '~/lib/agreement-fields';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let start: any, privacy: any;
let linkLanding: any, archiveLanding: any, agreements: any, signPage: any, agreementPanel: any, directory: string, softwarePage: any, composer: any, today: any, page: any, preview: any, editor: any, questions: any, fit: any, panel: any, ownerRequest: any;
const token = 'a'.repeat(43);
const terms = { outcome:'Current offer',summary:'A shared view.',milestones:[{ name:'Tracker',deliverables:['Status view'],acceptance:['Add a client.'],feeCents:240000 }],clientInputs:'',exclusions:'',timing:'',paymentMode:'standard' };
beforeAll(async () => {
  directory = await mkdtemp(resolve('.software-render-'));
  await build({ entryPoints:{ privacy:'src/pages/privacy.astro', start:'src/pages/software/start.astro', linkLanding:'src/pages/offer/[token]/verify.astro', archiveLanding:'src/pages/agreements/verify.astro', agreements:'src/pages/owner/agreements.astro', signPage:'src/pages/offer/[token]/sign.astro', agreementPanel:'src/components/owner/SoftwareAgreementPanel.astro', panel:'src/components/owner/SoftwareProjectPanel.astro', ownerRequest:'src/pages/owner/requests/[id].astro', today:'src/pages/owner/index.astro', composer:'src/pages/owner/requests/[id]/update.astro', software:'src/pages/studio/software/[id].astro', client:'src/pages/offer/[token].astro', preview:'src/pages/owner/requests/[id]/offer.astro', editor:'src/components/owner/SoftwareOfferEditor.astro', questions:'src/components/owner/SoftwareQuestions.astro', fit:'src/components/owner/SoftwareFitReview.astro' }, outdir:directory, outExtension:{ '.js':'.mjs' }, bundle:true, format:'esm', platform:'node', packages:'external',
    plugins:[{ name:'astro-test-render', setup(builder) {
      builder.onResolve({ filter:/\.css(?:\?|$)|\?astro/ }, () => ({ path:'empty-style',namespace:'empty' }));
      builder.onLoad({ filter:/.*/,namespace:'empty' }, () => ({ contents:'',loader:'js' }));
      builder.onResolve({ filter:/^~\// }, args => ({ path:resolve('src',args.path.slice(2)) + (args.path.endsWith('.astro') ? '' : '.ts') }));
      builder.onLoad({ filter:/\.astro$/ }, async args => ({ contents:(await transform(await readFile(args.path,'utf8'),{ filename:args.path,internalURL:'astro/compiler-runtime',astroGlobalArgs:'"https://thesuperhuman.us"',resolvePath:specifier => specifier })).code,loader:'ts',resolveDir:dirname(args.path) }));
    } }],
  });
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(directory)) { const compiled = (await import(/* @vite-ignore */ pathToFileURL(resolve(directory,file)).href)).default; if (file.startsWith('privacy')) privacy = compiled; else if (file.startsWith('start')) start = compiled; else if (file.startsWith('linkLanding')) linkLanding = compiled; else if (file.startsWith('archiveLanding')) archiveLanding = compiled; else if (file.startsWith('agreements')) agreements = compiled; else if (file.startsWith('signPage')) signPage = compiled; else if (file.startsWith('agreementPanel')) agreementPanel = compiled; else if (file.startsWith('panel')) panel = compiled; else if (file.startsWith('ownerRequest')) ownerRequest = compiled; else if (file.startsWith('today')) today = compiled; else if (file.startsWith('composer')) composer = compiled; else if (file.startsWith('software')) softwarePage = compiled; else if (file.startsWith('client')) page = compiled; else if (file.startsWith('preview')) preview = compiled; else if (file.startsWith('editor')) editor = compiled; else if (file.startsWith('questions')) questions = compiled; else fit = compiled; }
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

it.each(['{}', '{"outcome":"Invalid"}', 'null', 'broken JSON'])('renders invalid terms %s as the existing unavailable state', async termsJSON => {
  const { sql,db } = await fixture();
  try {
    const unknown = await render(db,'b'.repeat(43));
    sql.prepare("UPDATE software_offers SET terms_json=? WHERE status='sent'").run(termsJSON);
    const response = await render(db,token);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await unknown.text());
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
    let html=await renderProject();expect(html).toContain('Does this match how you work?');expect(html).toContain('Confirm this direction');expect(html).toContain('The working milestone is reviewed separately.');
    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','PRIVATE TOKEN','Direction confirmed','direction','direction_confirmed','2026-09-30')");
    html=await renderProject();expect(html).toContain('You confirmed sketch 1.');expect(html).not.toContain('data-software-review');expect(html).not.toContain('Does this match how you work?');
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,criteria_json,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('delivery','r','delivery_review','shared',0,'Working tracker','Delivery v1','working_preview','[\"Try adding the fictional client.\"]','PRIVATE AUTHOR','2026-10-01','2026-10-01','2026-10-01',5)");
    html=await renderProject();expect(html).toContain('Version 1 is ready to try.');expect(html).toContain('Please try it by Oct 8, 2026.');expect(html).toContain('Included in this delivery');expect(html).toContain('Full agreed scope · Milestone 1');expect(html).toContain('Nothing is accepted until you click Accept.');expect(html).toContain('Try adding the fictional client.');expect(html).not.toContain('Demonstrated');expect(html).toContain('Accept version 1');expect(html).toContain('name="criteria"');expect(html).toMatch(/<h2[^>]*>Your decision<\/h2>/);expect(html).not.toContain('Does this match how you work?');
    sql.exec("INSERT INTO software_project_updates(id,request_id,status,kind,milestone_index,title,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('progress','r','shared','progress',0,'Progress after review','concept','owner','2026-10-02','2026-10-02','2026-10-02')");
    html=await renderProject();expect(html).toContain('data-software-review');expect(html).toContain('/reviews/delivery');expect(html).toContain('Try adding the fictional client.');expect(html).not.toContain('This update is shown for reference.');expect(html).toContain('Earlier versions');expect(html.indexOf('Try these')).toBeLessThan(html.indexOf('What we agreed'));
    const multiTerms={...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Follow-up'}]};
    sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify(multiTerms));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('pending-direction','r','direction_review','shared',1,'Next direction','Direction v2','concept','owner','2026-10-03','2026-10-03','2026-10-03')");
    html=await renderProject();
    expect(html).toContain('Progress after review');expect(html).not.toContain('Version 1 is ready to try.');expect(html).toContain('Please try it by Oct 8, 2026.');
    const rail=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'));
    expect(rail.indexOf('/reviews/delivery')).toBeLessThan(rail.indexOf('/reviews/pending-direction'));
    expect(rail).toContain('Accept version 1');expect(rail).toContain('Confirm this direction');
    expect(html.slice(html.indexOf('aria-label="Next steps"'),html.indexOf('class="project-history'))).toContain('/reviews/pending-direction');expect(html.slice(html.indexOf('Earlier updates'))).not.toContain('Next direction');expect(html.match(/data-endpoint="[^"]*\/reviews\/pending-direction"/g)).toHaveLength(1);
    sql.exec("UPDATE software_projects SET milestone_index=1");
    html=await renderProject();
    const advancedRail=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'));
    expect(advancedRail.indexOf('/reviews/delivery')).toBeGreaterThan(-1);
    expect(advancedRail.indexOf('/reviews/delivery')).toBeLessThan(advancedRail.indexOf('/reviews/pending-direction'));
    sql.exec("DELETE FROM software_project_updates WHERE id='pending-direction'; UPDATE software_projects SET milestone_index=1");
    html=await renderProject();
    expect(html).toContain('Current offer · milestone 2');expect(html).toContain('Milestone 2 is starting.');
    const startingRail=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'));
    expect(startingRail).toContain('/reviews/delivery');
    expect(startingRail).toContain('Accept version 1');
    expect(html.slice(html.indexOf('Earlier updates'))).not.toContain('/reviews/delivery');
    expect(html.match(/data-endpoint="[^"]*\/reviews\/delivery"/g)).toHaveLength(1);

    expect(html).toContain('data-milestone="Tracker"');
    sql.exec('UPDATE software_projects SET milestone_index=0');

    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','PRIVATE TOKEN','Accepted Delivery v1','delivery','milestone_accepted','2026-10-02')");
    html=await renderProject();expect(html).not.toContain('Version 1 is ready to try.');expect(html).not.toContain('Please review by');expect(html).toContain('You accepted version 1 of milestone 1.');expect(html).toContain('Handoff follows full payment.');
    sql.exec("INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-01','PRIVATE OWNER'); INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,next_step,created_by,created_at,updated_at,shared_at) VALUES ('handoff','r','handoff','shared',0,'Delivered files','handoff','[{\"label\":\"Handoff notes\",\"url\":\"https://example.com/notes\"}]','Anything new is a separate milestone.','PRIVATE AUTHOR','2026-10-03','2026-10-03','2026-10-03')");
    html=await renderProject();expect(html).toContain('Handoff notes');expect(html).toContain('Corrections are covered through Oct 31, 2026.');expect(html).toContain('Earlier updates');expect(html).not.toContain('After acceptance');
    sql.prepare("UPDATE software_project_updates SET links_json=? WHERE id='handoff'").run(JSON.stringify([{label:'Project files',url:'https://thesuperhuman.us/studio/files'},{label:'External files',url:'https://example.com/files'}]));
    html=await renderProject();
    expect(html).toMatch(/href="https:\/\/thesuperhuman.us\/studio\/files">Project files <span aria-hidden="true"[^>]*>→<\/span>/);
    expect(html).toMatch(/href="https:\/\/example.com\/files" target="_blank" rel="noopener noreferrer">External files <span aria-hidden="true"[^>]*>↗<\/span>/);
    sql.prepare("UPDATE software_projects SET terms_json=?").run(JSON.stringify({...terms,milestones:[...terms.milestones,{...terms.milestones[0],name:'Follow-up'}]}));
    sql.exec("UPDATE software_projects SET milestone_index=1; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('direction2','r','direction_review','shared',1,'Follow-up direction','Direction v1','concept','owner','2026-10-04','2026-10-04','2026-10-04')");
    html=await renderProject();expect(html).toContain('/reviews/direction2');expect(html).toContain('Project files');expect(html).toContain('Corrections are covered through Oct 31, 2026.');
    sql.exec("UPDATE software_project_updates SET status='superseded' WHERE id='direction2'; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('second-delivery','r','delivery_review','shared',1,'Follow-up delivery','Follow-up v1','working_preview','owner','2026-10-05','2026-10-05','2026-10-05'); INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted follow-up','second-delivery','milestone_accepted','2026-10-06'); INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,next_step,created_by,created_at,updated_at,shared_at) VALUES ('second-handoff','r','handoff','shared',1,'Follow-up files','handoff','[{\"label\":\"Follow-up notes\",\"url\":\"https://example.com/follow-up\"}]','Follow-up corrections only.','owner','2026-10-07','2026-10-07','2026-10-07')");
    html=await renderProject();const strips=html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'));
    expect(html).toContain("It&#39;s yours.");
    expect(html).toContain('Follow-up notes');expect(html).toContain('Corrections are covered through Nov 5, 2026.');expect(strips).toContain('Project files');
    sql.exec("DELETE FROM software_project_messages WHERE update_id='second-delivery'; DELETE FROM software_project_updates WHERE id IN ('second-delivery','second-handoff')");
    sql.exec("DELETE FROM software_milestone_payments; UPDATE software_projects SET milestone_index=0; UPDATE software_project_updates SET status='superseded' WHERE id='delivery'; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('delivery2','r','delivery_review','shared',0,'Corrected tracker','Delivery v2','working_preview','owner','2026-10-10','2026-10-10','2026-10-10',5); INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted Delivery v2','delivery2','milestone_accepted','2026-10-12')");
    html=await renderProject();expect(html).toContain('Version 2 is accepted.');expect(html).not.toContain("It&#39;s yours.");expect(html).not.toContain('Your files · Milestone 1');expect(html.slice(html.indexOf('Earlier updates'))).toContain('Project files');expect(html.slice(html.indexOf('Earlier updates'))).toContain('Oct 3, 2026');expect(html).toContain('Anything new is a separate milestone.');expect(html.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(1);
    for(const secret of ['PRIVATE OWNER','PRIVATE AUTHOR','PRIVATE TOKEN','PRIVATE NOTE','PRIVATE FIT REVIEW','240000']) expect(html).not.toContain(secret);
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,created_by,created_at,updated_at,shared_at) VALUES ('progress-link','r','progress','shared',0,'Prior progress','concept','[{\"label\":\"Prior progress reference\",\"url\":\"https://example.com/progress\"}]','owner','2026-10-14','2026-10-14','2026-10-14')");
    const ownerHTML=await container.renderToString(composer,{request:new Request('https://thesuperhuman.us/owner/requests/r/update'),params:{id:'r'},locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    expect(ownerHTML).toContain('Delivery review');expect(ownerHTML).toContain('Evidence for every acceptance check');expect(ownerHTML).toContain('Choose 5–30 Business Days. Larger windows are set in the executed agreement.');expect(ownerHTML).toContain('name="delivered_deliverables"');expect(ownerHTML).toContain('Reuse a saved project link');expect(ownerHTML).toContain('Prior progress reference');expect(ownerHTML).toContain('This milestone is paid in full');expect(ownerHTML).toContain('Keep these files available for 30 days.');
  } finally {sql.close();}
});

it('keeps newer progress first and pending review actions in the rail', async () => {
  const {sql,db} = await fixture();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','now')").run(JSON.stringify(terms));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('delivery','r','delivery_review','shared',0,'Pending delivery','Delivery v1','working_preview','owner','2026-09-29','2026-09-29','2026-09-29'),('progress','r','progress','shared',0,'Newer concept','v1','concept','owner','2026-09-30','2026-09-30','2026-09-30'),('progress2','r','progress','shared',0,'Newest concept','v2','concept','owner','2026-10-01','2026-10-01','2026-10-01')");
    const {createHash} = await import('node:crypto'), session = 'a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    const container = await AstroContainer.create();
    const renderProject = () => container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    let html = await renderProject();
    expect(html).not.toContain('Version 1 is ready to try.');
    const current = html.slice(html.indexOf('class="project-current'),html.indexOf('<aside'));
    expect(current).toContain('Current offer');expect(current).not.toContain('Newer concept');expect(current).toContain('Newest concept');expect(html).toContain('Earlier updates');
    expect(html.match(/Newer concept/g)).toHaveLength(1);
    expect(html.match(/Newest concept/g)).toHaveLength(1);
    sql.exec("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','client','Accepted','delivery','milestone_accepted','2026-10-02')");
    html = await renderProject();
    expect(html).not.toContain('Latest update');
    expect(html).toContain('Current offer');expect(html).not.toContain('aria-label="Next steps"');
    expect(html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'))).toContain('See the delivered version');
  } finally {sql.close();}
});

it('reopens an earlier milestone revision with its saved evidence intact', async () => {
  const {sql,db}=await fixture(), container=await AstroContainer.create();
  try {
    const multiTerms={...terms,milestones:[
      {...terms.milestones[0],name:'First milestone',deliverables:['First view'],acceptance:['Add a client.','Export the sample.']},
      {...terms.milestones[0],name:'Second milestone',deliverables:['Second view'],acceptance:['Open settings.']},
    ]};
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,state,step,milestone_index) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','2026-10-10','building','build',1)").run(JSON.stringify(multiTerms));
    sql.prepare("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,criteria_json,delivered_deliverables_json,created_by,created_at,updated_at,shared_at) VALUES ('old-review','r','delivery_review','shared',0,'First delivery','Delivery v1','working_preview',?,?, 'owner','2026-10-01','2026-10-01','2026-10-01')")
      .run(JSON.stringify(['Old evidence 1','Old evidence 2']),JSON.stringify(['First view']));
    sql.prepare("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Requested changes to Delivery v1 for milestone 1. Checks reported unmet: [1]. Deliverables unavailable: [].\n\nChecks reported unmet: 1. Add a client.\n\nPlease fix the client form.','old-review','changes_requested','2026-10-02')").run();
    sql.prepare("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,what_changed,criteria_json,delivered_deliverables_json,links_json,created_by,created_at,updated_at) VALUES ('revision-draft','r','delivery_review','draft',0,'Revised first view','Delivery v2','working_preview','I fixed the form.',?,?, '[]','owner','2026-10-03','2026-10-04')")
      .run(JSON.stringify(['Saved new evidence','Saved second check']),JSON.stringify(['First view']));
    sql.exec("UPDATE software_project_updates SET next_step='Keep the saved next step.' WHERE id='revision-draft'");
    const html=await container.renderToString(composer,{request:new Request('https://thesuperhuman.us/owner/requests/r/update?respond=old-review'),params:{id:'r'},locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    expect(html).toContain('Respond to requested changes');expect(html).toContain('Please fix the client form.');
    expect(html).toContain('Saved new evidence');expect(html).toContain('Saved second check');
    const clientPreview=html.slice(html.indexOf('class="client-preview'),html.indexOf('data-preview-templates'));expect(clientPreview.match(/Keep the saved next step\./g)).toHaveLength(1);
    expect(html).not.toContain('That revision request is no longer the latest review.');
    expect(html).toContain('value="0" selected');expect(html).toContain('Milestone 1 · First milestone');
    const project=await db.prepare("SELECT * FROM software_projects WHERE request_id='r'").first();
    const updates=(await db.prepare("SELECT * FROM software_project_updates WHERE request_id='r'").all()).results;
    const ownerPanel=await container.renderToString(panel,{props:{requestId:'r',requestUpdatedAt:'now',project,updates,closed:false},locals:{runtime:{env:{MUSIC_DB:db}}} as any});
    expect(ownerPanel).toContain('/owner/requests/r/update?respond=old-review');
    expect(ownerPanel).toContain('Continue revision draft');
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
    expect(html).not.toContain('Payment · Invoiced on delivery'); expect(html).not.toContain('aria-label="Next steps"');
    expect(html).toContain('Ask a question');
    sql.exec("UPDATE software_projects SET state='waiting_for_input',waiting_for='A redacted sample export.',next_update_on='2026-09-28'");
    html = await renderProject(); expect(html).not.toContain('Waiting on you'); expect(html).toContain('A redacted sample export.');
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
    let html=await renderProject();expect(html).toContain('Invoices');expect(html).toContain('Pay invoice ↗');expect(html).toContain('$1,200.00');expect(html).toContain('Due Oct 15, 2026');expect(html).not.toContain('Initial payment · Received');
    expect(html).not.toMatch(/PRIVATE|old-secret|1,111.11/);
    for (const status of ['open','payment_failed','uncollectible','paid','void']) {
      sql.prepare("UPDATE software_invoices SET status=? WHERE id='current-balance'").run(status);
      html=await renderProject();
      expect(html.includes('Pay invoice ↗')).toBe(['open','payment_failed','uncollectible'].includes(status));
    }
    sql.exec("UPDATE software_invoices SET status='open' WHERE id='current-balance'");
    sql.exec(`INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at)
      VALUES ('current-deposit','r','current',0,'deposit',120000,7,'payment_failed','https://example.com/deposit','owner','2026-09-30','2026-09-30')`);
    html=await renderProject();expect(html).not.toContain('Initial payment · Received');
    expect(html).toContain('Deposit · $1,200.00 · Payment failed');
    sql.exec("UPDATE software_invoices SET status='void' WHERE id='current-deposit'");
    html=await renderProject();expect(html).not.toContain('Initial payment · Received');expect(html).toContain('Deposit · $1,200.00 · Void');
    expect(html.indexOf('Deposit · $1,200.00')).toBeLessThan(html.indexOf('Balance · $1,200.00'));
    sql.exec("UPDATE software_invoices SET status='paid',status_updated_at='2026-10-01' WHERE id='current-deposit'");
    html=await renderProject();expect(html).not.toContain('Initial payment · Received');expect(html).toContain('Deposit · $1,200.00 · Paid Oct 1, 2026');
    sql.exec("UPDATE software_invoices SET status='void' WHERE id='current-deposit'");
    html=await renderProject();expect(html).not.toContain('Initial payment · Received');
  } finally {sql.close();}
});


it('renders one signing page, returning details, waiting and both-signed actions', async () => {
  const { sql, db } = await fixture();
  try {
    const session = 's'.repeat(43), sessionHash = await hashOfferToken(session);
    sql.prepare("INSERT INTO software_agreement_templates VALUES ('msa','msa',1,'Template',?,1,'now','owner')").run('a'.repeat(64));
    sql.exec("INSERT INTO software_agreement_clients VALUES ('client','alex@example.com','Example LLC','example llc','LLC','Wyoming','Business address','notice@example.com','now'); INSERT INTO software_agreement_links(id,purpose,offer_id,recipient_email,token_hash,issued_at,expires_at) VALUES ('challenge','agreement','current','alex@example.com','synthetic','now','2099-01-01')");
    sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1; UPDATE software_offers SET msa_template_id='msa',recipient_email_snapshot='alex@example.com',agreement_details_json='{}' WHERE id='current'");
    sql.prepare("INSERT INTO software_agreement_sessions VALUES (?,'agreement','current',?,'alex@example.com','challenge','now','2099-01-01',NULL,'csrf')").run(sessionHash, await hashOfferToken(token));
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(JSON.stringify({planned_start:'2026-10-01',planned_end:'2026-10-20',environment:'Browser',operating_responsibilities:'Client operates',update_rhythm:'Weekly',milestones:terms.milestones.map(()=>({start:'2026-10-01',target:'2026-10-20',handoff:'Source'}))}));
    sql.prepare("UPDATE owner_requests SET details_json=? WHERE id='r'").run(JSON.stringify({company:'Example LLC'}));
    const container = await AstroContainer.create();
    const render = (query = '') => container.renderToString(signPage, { params: { token }, request: new Request(`https://thesuperhuman.us/offer/${token}/sign${query}`, { headers: { cookie: `agreement_session=${session}` } }), locals: { runtime: { env: { MUSIC_DB: db } } } as any });
    let html = await render();
    expect(html).toContain('Ready to sign.');expect(html).toContain('value="Example LLC"');
    expect(html).toMatch(/<p[^>]*><a[^>]*data-document-link="msa"[^>]*>Read the agreement<\/a><\/p>/);
    expect(html).toMatch(/<p[^>]*><a[^>]*data-document-link="sow"[^>]*>Read the statement of work<\/a><\/p>/);
    expect(html).toContain('1 milestone ·');expect(html).not.toContain('1 milestones');
    expect(html).toMatch(/Agreement version v2026-09-30<\/p>\s*<\/section>/);
    sql.prepare("UPDATE software_offers SET terms_json=? WHERE id='current'").run(JSON.stringify({...terms,milestones:[terms.milestones[0],terms.milestones[0]]}));
    const originalDetails=sql.prepare("SELECT agreement_details_json FROM software_offers WHERE id='current'").get().agreement_details_json;
    const multiDetails=JSON.parse(originalDetails);
    multiDetails.milestones=[{...multiDetails.milestones[0],target:'2026-10-10'},{...multiDetails.milestones[0],start:'2026-10-11'}];
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(JSON.stringify(multiDetails));
    expect(await render()).toContain('2 milestones ·');
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(originalDetails);
    sql.prepare("UPDATE software_offers SET terms_json=? WHERE id='current'").run(JSON.stringify(terms));
    expect(html).toContain('Signing applies your name above as your electronic signature on the agreement and statement of work linked above.');
    expect(html).not.toContain('Step 2 of 3');expect(html).not.toContain('Before you sign');
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('data-terms-reader');expect(html).toContain('v2026-09-30');
    sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('reused','msa','old','r','client','msa','executed','Original executed MSA',?,?,'now','2026-09-30','old-session')").run('b'.repeat(64),JSON.stringify({client:{legal_name:'Example LLC',entity_type:'LLC',jurisdiction:'Wyoming',business_address:'Business address'}}));
    sql.exec("UPDATE software_offers SET reused_msa_id='reused' WHERE id='current'");
    html=await render();expect(html).toContain('Your signed agreement from Sep 30, 2026 still applies.');expect(html).toContain('Read it');expect(html).not.toContain('Read the agreement');expect(html).not.toContain('Read the full agreement and statement of work');expect(html).toContain('Signing applies your name above as your electronic signature on the statement of work linked above.');expect(html).toContain('Same as last time: Example LLC, LLC, Wyoming, Business address.');expect(html).toMatch(/data-business-details[^>]*hidden/);
    sql.prepare("INSERT INTO software_agreement_drafts VALUES('current','alex@example.com',?,'now')").run(JSON.stringify({legal_name:'Example LLC',signer_name:'Alex',entity_type:'LLC',state:'Wyoming',business_address:'Updated business address'}));
    html=await render();expect(html).toMatch(/name="country"[^>]*value="United States"/);expect(html).not.toMatch(/data-country[^>]*hidden/);expect(html).not.toContain('Same as last time');expect(html).toContain('Updated business address');expect(html).not.toMatch(/data-business-details[^>]*hidden/);
    sql.exec("DELETE FROM software_agreement_drafts WHERE offer_id='current'");
    sql.exec("UPDATE software_offers SET reused_msa_id=NULL WHERE id='current'");
    const values = { client: { signer_name: 'Example Signer', signer_title: 'Owner', legal_name: 'Example LLC', portfolio: 'deny', naming: false }, contractor: { signer_name: 'Example Contractor', legal_name: 'Example Contractor LLC' }, system: { payment: 'Standard' }, choices: { portfolio: 'Do not allow', naming: 'No' } };
    sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES ('sow','sow','current','r','client','msa','review','Exact SOW',?,?,'now','2026-09-30',?)").run('a'.repeat(64), JSON.stringify(values), sessionHash);
    html = await render('?review=1');
    expect(html).toContain('Ready to sign.');expect(html).toContain('Exact SOW');
    expect(html).toMatch(/id="consent-updated"[^>]*hidden[^>]*>The documents were updated. Please tick the box again./);
    expect(html).not.toContain('SHA-256');expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toMatch(/name="documents"[^>]*value="\[\]"/);
    sql.exec("UPDATE software_agreements SET status='client_signed'");
    html = await render();
    expect(html).toContain('Signed. Over to Kazon.');
    expect(html).toContain('Kazon countersigns next.');
    html = await container.renderToString(agreementPanel, { props: { requestId: 'r', offerId: 'current' }, locals: { runtime: { env: { MUSIC_DB: db } } } as any });
    expect(html).toContain('Countersign the agreement.');
    expect(html).toContain('countersign-columns');
    expect(html).toContain('Portfolio · Do not allow');
    expect(html).toContain('Payment · Standard');
    expect(html).toContain('Review filled SOW');
    expect(html).toContain('data-agreement-review-link');
    expect(html).toContain('Countersign as Example Contractor');
    expect(html).not.toContain('name=\"authority\"');
    expect(html).toContain("Countersigning applies your name above as your electronic signature on the statement of work you reviewed.");
    expect(html.indexOf('Client’s signed choices')).toBeLessThan(html.indexOf('value="countersign"'));
    sql.exec("UPDATE software_agreements SET status='executed'");
    html = await render();
    expect(html).toContain('Signed by both of you.');
    expect(html).not.toContain('Open your project page');
    expect(html).toContain("I'll email you the link to your project page when work starts.");
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','now','owner','now','now')").run(JSON.stringify(terms));
    html=await render();expect(html).toContain('Open your project page');
    sql.exec("INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at) VALUES('signing-deposit','r','current',0,'deposit',120000,7,'open','https://example.com/deposit','owner','now','now')");
    html=await render();expect(html).toContain('Pay the deposit ↗');expect(html).toContain('https://example.com/deposit');
  } finally { sql.close(); }
});

it('keeps manual signing closed and shows start exceptions only when required', async () => {
  const { sql, db } = await fixture();
  try {
    const container = await AstroContainer.create();
    const render = (details: unknown) => container.renderToString(panel, { props: { requestId: 'r', requestUpdatedAt: 'now', project: null, sentOffer: { id: 'current', version: 2, terms_json: JSON.stringify(terms), agreement_details_json: JSON.stringify(details) }, updates: [], closed: false }, locals: { runtime: { env: { MUSIC_DB: db } } } as any });
    let html = await render({ po_requirement: 'not_required', planned_start: '2000-01-01' });
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Signed outside the website<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toMatch(/<label class="confirmation[^"]*"[^>]*><input type="checkbox" name="external_kept_copy"/);
    expect(html).toMatch(/<label class="confirmation[^"]*"[^>]*><input type="checkbox" name="inputs_ready"/);
    expect(html).not.toContain('name="po_number"');
    expect(html).not.toContain('name="earlier_start_on"');
    html = await render({ po_requirement: 'before_start', planned_start: '2099-01-01' });
    expect(html).toContain('name="po_number"');
    expect(html).toContain('name="earlier_start_on"');
    expect(html).toContain('name="earlier_start_agreement"');
  } finally { sql.close(); }
});

it('renders Agreements with the owner heading, active navigation and ordered rail sections', async () => {
  const { sql, db } = await fixture();
  try {
    const container = await AstroContainer.create();
    const html = await container.renderToString(agreements, { partial: false,
      request: new Request('https://thesuperhuman.us/owner/agreements'),
      locals: { owner: { email: 'owner@example.com' }, runtime: { env: { MUSIC_DB: db } } },
    } as any);
    expect(html.match(/class="owner-header"/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/owner\/agreements"[^>]*aria-current="page"/);
    expect(html).toMatch(/class="owner-breadcrumb[^" ]*(?: [^"]*)?"[^>]*><a href="\/owner"/);
    expect(html).toMatch(/class="owner-page-heading compact[^"]*"[^>]*>[\s\S]*class="owner-kicker[^"]*"[^>]*>Owner \/ Agreements<\/p><h1[^>]*>Agreements\.<\/h1><p[^>]*>Manage private templates/);
    expect([...html.matchAll(/<section class="rail-section[^"]*"[^>]*><h2[^>]*>([^<]+)<\/h2>/g)].map(match => match[1])).toEqual([
      'Website signing', 'Contractor details', 'MSA template', 'SOW template', 'Agreement retention', 'Expired email verification data',
    ]);
    expect(html.match(/data-template-editor/g)).toHaveLength(2);
  } finally { sql.close(); }
});


it('reads immutable agreed fees, dates and complete legal text without enabling new consent', async () => {
  const {sql,db} = await fixture();
  const {createHash} = await import('node:crypto');
  const session='a'.repeat(72), hash='b'.repeat(64);
  const fixed:OfferTerms={...terms,paymentMode:'standard',clientInputs:'Synthetic access and sample.',exclusions:'Live rollout.',timing:'Dates are conditional on agreed client inputs.',milestones:[{...terms.milestones[0],feeCents:101,checkpoint:{label:'Working view',cancellationPercent:80}}]};
  const owner=agreementDetailsSchema.parse({planned_start:'2026-10-01',planned_end:'2026-10-20',environment:'Synthetic browser environment',operating_responsibilities:'Client operates the delivered tool.',update_rhythm:'Every Thursday',milestones:[{start:'2026-10-02',target:'2026-10-19',handoff:'Source and notices',checkpoint_criteria:'Status is saved',checkpoint_evidence:'Synthetic preview'}],support:'Agreed support only',expenses_taxes:'No extra expenses'});
  const values=agreementValues(fixed,owner,{legal_name:'Example Client LLC',entity_type:'LLC',jurisdiction:'WY',business_address:'Example business address',notice_email:'alex@example.com',reviewer_name:'Alex',reviewer_email:'alex@example.com',approver_name:'Alex',approver_email:'alex@example.com',signer_name:'Alex',signer_title:'Owner',portfolio:'deny',naming:false},{legal_name:'Example Contractor LLC',entity_jurisdiction:'WY',signer_name:'Example Owner',signer_title:'Owner',notice_email:'owner@example.com',business_address:'Registered agent address',registered_agent_confirmed:true},{effective_on:'2026-09-30',msa_version:'2026-09-30 / template 1',sow_number:'SOW-example',offer_version:2,template_version:1});
  try {
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at,next_update_on) VALUES ('r','current',?,'standard','now','now','2026-09-30','PRIVATE OWNER','now','now','2026-11-01')").run(JSON.stringify(fixed));
    const container=await AstroContainer.create();
    const render=(cookie=session)=>container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${cookie}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    let html=await render();
    expect(html).toContain('$1.01 fixed fee');expect(html).toContain('50% of each milestone before it starts');
    expect(html).toContain('signed outside the website');expect(html).toContain('Milestone delivery dates are not recorded');
    expect(html).not.toContain('Download complete signed agreement packet');
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(JSON.stringify(owner));
    html=await render();
    for (const text of ['Planned Oct 1, 2026 to Oct 20, 2026','Target delivery: Oct 19, 2026','Synthetic browser environment','Client operates the delivered tool.','Source and notices','Status is saved. Synthetic preview','5 business days','30 calendar days']) expect(html).toContain(text);
    expect(html).toContain('signed outside the website');
    expect(html).not.toContain('Download complete signed agreement packet');
    sql.prepare("INSERT INTO software_agreement_clients VALUES ('party','alex@example.com','Example Client LLC','example','LLC','WY','Example address','alex@example.com','now')").run();
    for (const kind of ['msa','sow']) {
      sql.prepare("INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES (?,?,1,'Synthetic template',?,'now','PRIVATE TEMPLATE ACTOR')").run(kind,kind,hash);
      sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,msa_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,executed_at,review_session_hash) VALUES (?,?,'current',?,'party',?,?,'executed',?,?,?,'now','2026-09-30','now','PRIVATE SIGNING SESSION')").run(kind,kind,kind==='msa'?'previous-request':'r',kind,kind==='sow'?'msa':null,kind==='msa'?'Exact MSA: <script>not executable</script> and every cancellation obligation.':'Exact SOW: full material terms and responsibilities.',hash,JSON.stringify(values));
    }
    sql.exec("UPDATE software_projects SET agreement_id='sow'; UPDATE software_offers SET terms_json='{}' WHERE id='current'");
    html=await render();
    const reader=html.slice(html.indexOf('data-terms-reader'),html.indexOf('Invoices'));
    expect(html).toContain('Planned Oct 1, 2026 to Oct 20, 2026');expect(html).toContain('Target delivery: Oct 19, 2026');
    expect(reader).not.toContain('Nov 1, 2026');
    expect(html).toContain('$0.50 deposit / $0.51 balance');expect(html).toContain('80%, includes prior payments');
    for (const text of ['Synthetic access and sample.','Live rollout.','Client operates the delivered tool.','Source and notices','Every Thursday','Agreed support only','No extra expenses']) expect(html).toContain(text);
    expect(html).toContain('Exact MSA: &lt;script&gt;not executable&lt;/script&gt;');expect(html).toContain('Exact SOW: full material terms and responsibilities.');
    // Reused MSA belongs to an older request. Download the current SOW packet,
    // whose authorization and artifact include this project's complete signed record.
    expect(html).not.toContain('/api/agreements/msa/file');expect(html).toContain('/api/agreements/sow/file');
    expect(html).toContain('Download complete signed agreement packet');
    expect(html).toContain('Opening stages or reading terms does not give consent');expect(html).not.toMatch(/name="consent"|data-agreement-flow|PRIVATE TEMPLATE ACTOR|PRIVATE SIGNING SESSION|PRIVATE OWNER/);
    for (let stage=0;stage<4;stage++) expect(html).toMatch(new RegExp(`id="agreed-stage-${stage}" data-terms-stage(?:="")? aria-labelledby=`));
    expect(html).toMatch(/data-terms-controls(?:="")? hidden/);
    const forbidden=await render('b'.repeat(72));expect(forbidden).not.toMatch(/Exact MSA|Exact SOW|Synthetic browser environment/);
    sql.exec("UPDATE owner_requests SET email='new-recipient@example.com' WHERE id='r'; UPDATE audio_client_sessions SET email='new-recipient@example.com'");
    html=await render();expect(html).not.toMatch(/Exact MSA|Exact SOW|Synthetic browser environment|Download complete signed agreement packet/);expect(html).toContain('retained website agreement is unavailable here');
    sql.exec("UPDATE owner_requests SET email='alex@example.com' WHERE id='r'; UPDATE audio_client_sessions SET email='alex@example.com'; UPDATE software_agreements SET archive_closed_at='now' WHERE id='sow'");
    html=await render();expect(html).not.toMatch(/Exact MSA|Exact SOW|Synthetic browser environment/);expect(html).toContain('retained website agreement is unavailable here');expect(html).not.toContain('signed outside the website');
  } finally {sql.close();}
});

it.each(['accepted-unpaid','paid-awaiting-handoff','handed-off'].flatMap(state=>[30,45].flatMap(days=>['website','external'].map(signing=>({state,days,signing})))))('keeps the correction deadline beside acceptance ($state, $days days, $signing)', async ({state,days,signing}) => {
  const paid=state!=='accepted-unpaid';
  const {sql,db}=await fixture(), container=await AstroContainer.create();
  try {
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','now')").run(JSON.stringify(terms));
    const owner=agreementDetailsSchema.parse({correction_calendar_days:days,planned_start:'2026-10-01',planned_end:'2026-10-20',environment:'Synthetic browser environment',operating_responsibilities:'Client operates the delivered tool.',update_rhythm:'Every Thursday',milestones:[{start:'2026-10-02',target:'2026-10-19',handoff:'Source and notices',checkpoint_criteria:'Status is saved',checkpoint_evidence:'Synthetic preview'}],support:'Agreed support only',expenses_taxes:'No extra expenses'});
    const values=agreementValues({...terms,paymentMode:'standard'},owner,{legal_name:'Example Client LLC',entity_type:'LLC',jurisdiction:'WY',business_address:'Example business address',notice_email:'alex@example.com',reviewer_name:'Alex',reviewer_email:'alex@example.com',approver_name:'Alex',approver_email:'alex@example.com',signer_name:'Alex',signer_title:'Owner',portfolio:'deny',naming:false},{legal_name:'Example Contractor LLC',entity_jurisdiction:'WY',signer_name:'Example Owner',signer_title:'Owner',notice_email:'owner@example.com',business_address:'Registered agent address',registered_agent_confirmed:true},{effective_on:'2026-09-30',msa_version:'2026-09-30 / template 1',sow_number:'SOW-example',offer_version:2,template_version:1});
    sql.exec("INSERT INTO software_agreement_clients VALUES ('party','alex@example.com','Example Client LLC','example','LLC','WY','Example address','alex@example.com','now'); INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES ('sow','sow',1,'Template','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','now','owner')");
    sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES ('sow','sow','current','r','party','sow','executed','Agreed terms','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',?,'now','2026-09-30','session')").run(JSON.stringify(values));
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(JSON.stringify({...owner,correction_calendar_days:signing==='website' ? 90 : days}));
    if(signing==='website') sql.exec("UPDATE software_projects SET agreement_id='sow'");
    const session='a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(await hashOfferToken(session));
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('accepted','r','delivery_review','shared',0,'Delivery','Delivery v2','working_preview','owner','2026-10-01','2026-10-01','2026-10-01');
      INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted','accepted','milestone_accepted','2026-10-02');
      INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at) VALUES ('balance','r','current',0,'milestone',240000,30,'open','https://example.com/invoice','owner','now','now');
      INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,what_changed,client_request,next_step,created_by,created_at,updated_at,shared_at) VALUES ('progress','r','progress','shared',0,'Preparing your guide','working_preview','The guide is drafted. The examples are ready. The final checklist is complete.','Read the guide.','Share the files.','owner','2026-10-03','2026-10-03','2026-10-03')`);
    if(paid) sql.exec("INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-03','owner'); UPDATE software_invoices SET status='paid'");
    if(state==='handed-off') sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('handoff','r','handoff','shared',0,'Files','handoff','owner','2026-10-02','2026-10-02','2026-10-02')");
    const html=await container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}}} as any);
    const deadline=days===30 ? 'Nov 1, 2026' : 'Nov 16, 2026';
    expect(html.split(`Corrections are covered through ${deadline}.`)).toHaveLength(2);
    const acceptance=html.indexOf('You accepted Version 2 on Oct 2, 2026.');
    expect(acceptance).toBeGreaterThan(-1);
    expect(html.slice(acceptance,html.indexOf('Your files',acceptance)>-1 ? html.indexOf('Your files',acceptance) : html.indexOf('class="project-history',acceptance))).toContain(`Corrections are covered through ${deadline}.`);
    if(state==='handed-off') return;
    const current=html.slice(0,html.indexOf('class="project-history'));
    expect(html.match(/You accepted Version 2 on Oct 2, 2026\./g)).toHaveLength(1);
    expect(html.slice(html.indexOf('class="project-history'))).not.toContain('id="version-accepted"');
    expect(current).toContain(paid ? 'Paid. Your files are on the way.' : 'Version 2 is accepted.');
    expect(current).toContain(paid ? 'I&#39;ll share the files and handoff notes here soon.' : 'Thanks. The last step is the balance.');
    expect(current).toMatch(/<h2[^>]*>Preparing your guide<\/h2>/);
    expect(current).toContain('The guide is drafted. The examples are ready. The final checklist is complete.');
    expect(current).toContain('I need from you: Read the guide.');
    expect(current).toContain('Next from me: Share the files.');
    expect(current).not.toContain('/updates/progress/visual');
    if(!paid) expect(current).toContain('Pay $2,400 ↗');
  } finally {sql.close();}
});

it('puts the named review work first through partial, complete, accepted and handoff states', async () => {
  vi.useFakeTimers({toFake:['Date']});
  vi.setSystemTime(new Date('2026-10-11T03:30:00Z'));
  const {sql,db}=await fixture(), container=await AstroContainer.create();
  try {
    const scope={...terms,milestones:[{...terms.milestones[0],deliverables:['Status view','Sample import']}]};
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','2026-09-29','owner','now','now')").run(JSON.stringify(scope));
    const session='a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(await hashOfferToken(session));
    const render=()=>container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,visual_key,visual_alt,preview_url,what_changed,created_by,created_at,updated_at,shared_at) VALUES ('progress','r','progress','shared',0,'Latest progress','v1','working_preview','private-image','The fictional tracker.','https://example.com/latest','I updated the layout.','owner','2026-09-30','2026-09-30','2026-09-30')`);
    sql.exec("UPDATE software_project_updates SET checks_limitations='Sample import is not included.',next_step='Build the import.',client_request='Send a sample.' WHERE id='progress'");
    let quiet=await render();expect(quiet).toContain('I need from you: Send a sample.');expect(quiet).toContain('Next from me: Build the import.');expect(quiet).toMatch(/<h3[^>]*>Not included yet<\/h3><p[^>]*>Sample import is not included\.<\/p>/);expect(quiet).toContain('/updates/progress/visual');expect(quiet).toContain('alt="The fictional tracker."');expect(quiet).toContain('Open v1 ↗');expect(quiet).not.toContain('aria-label="Next steps"');expect(quiet).not.toContain('data-software-review');
    sql.exec("DELETE FROM software_project_updates WHERE id='progress'");
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,what_changed,preview_url,delivered_deliverables_json,created_by,created_at,updated_at,shared_at,review_window_days) VALUES ('v2','r','delivery_review','shared',0,'Tracker','Delivery v2','working_preview','I added CSV import. Please try the sample. More internal detail.','https://example.com/preview','["Status view"]','owner','2026-10-01','2026-10-01','2026-10-01',5)`);
    sql.exec("UPDATE software_project_updates SET checks_limitations='Sample import is not included.',next_step='Build the import.',client_request='Send a sample.' WHERE id='v2'");
    sql.exec("UPDATE software_projects SET next_update_on='2026-10-10'");
    let html=await render();
    expect(html.match(/Next update: Oct 10, 2026/g)).toHaveLength(1);
    sql.exec("UPDATE software_projects SET next_update_on='2026-10-09'");
    expect(await render()).not.toContain('Next update:');
    sql.exec("UPDATE software_projects SET next_update_on='2026-10-11'");
    expect(await render()).toContain('Next update: Oct 11, 2026');
    sql.exec("UPDATE software_project_updates SET criteria_json='[\"Add a client. Checked in the preview.\"]' WHERE id='v2'");
    html=await render();
    expect(html).not.toContain('Agreed checks');
    expect(html).toMatch(/<strong[^>]*>Version 2<\/strong><span[^>]*>Now · Oct 1, 2026<\/span>/);
    expect(html).toMatch(/<div[^>]*>Add a client\.<p[^>]*>Checked in the preview\.<\/p><\/div>/);
    expect(html.match(/See what's included/g)).toHaveLength(1);
    sql.exec("UPDATE software_project_updates SET criteria_json='[\"Evidence without a repeated check.\"]' WHERE id='v2'");
    expect(await render()).toContain('Evidence without a repeated check.');
    expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>After payment<\/span>/);
    expect(html).toMatch(/<h3[^>]*>Not included yet<\/h3><p[^>]*>Sample import is not included\.<\/p>/);
    expect(html).toContain('Version 2 is ready to try.');expect(html).toContain('I need from you: Send a sample.');expect(html).toContain('Next from me: Build the import.');expect(html).toContain('Please try it by Oct 8, 2026.');expect(html).toContain('More internal detail.');
    expect(html).toContain('Open version 2 ↗');expect(html).toContain('Try these');expect(html).toContain('aria-pressed="false"');expect(html).toContain('data-review-mark="not-yet"');
    expect(html).toContain("This version doesn't include everything we agreed yet.");expect(html).toMatch(/value="milestone_accepted" disabled/);
    expect(html).toContain('What did you see?');expect(html).toContain('The $1,200 balance is invoiced on delivery and due within 15 days.');expect(html).not.toContain('accepts milestone 1 in full');
    for(const old of ['WORKING PREVIEW','Demonstrated','Try check','Agreement · Complete','Initial payment ·','Waiting on you','What I need from you']) expect(html).not.toContain(old);
    expect(html.indexOf('class="project-current')).toBeLessThan(html.indexOf('aria-label="Next steps"'));expect(html.indexOf('aria-label="Next steps"')).toBeLessThan(html.indexOf('So far'));
    sql.exec(`UPDATE software_project_updates SET delivered_deliverables_json='["Status view","Sample import"]'; UPDATE software_projects SET payment_mode='invoice'`);
    html=await render();expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>After payment<\/span>/);expect(html).not.toMatch(/value="milestone_accepted" disabled/);expect(html).toContain('This milestone is invoiced on delivery and due within 30 days.');
    sql.exec(`UPDATE software_project_updates SET kind='direction_review',artifact_version='Direction v1',evidence_type='concept'`);
    html=await render();expect(html).toMatch(/<h3[^>]*>Not included yet<\/h3><p[^>]*>Sample import is not included\.<\/p>/);expect(html).toContain("Here&#39;s the first sketch.");expect(html).toContain('Please look it over by Oct 8, 2026.');expect(html).toContain('Confirm this direction');expect(html).not.toContain('After you accept');expect(html).not.toContain('accepts milestone 1 in full');expect(html).not.toContain('data-review-mark');expect(html).not.toContain('name="criteria"');
    for (const kind of ['direction_review','delivery_review','progress']) {
      for (const evidence of ['concept','prototype','working_preview']) {
        sql.prepare('UPDATE software_project_updates SET kind=?,evidence_type=? WHERE id=\'v2\'').run(kind,evidence);
        html=await render();expect(html.includes('Sketch, not built yet')).toBe(evidence==='concept');
      }
    }
    sql.exec("UPDATE software_project_updates SET kind='direction_review',evidence_type='concept' WHERE id='v2'");
    sql.exec(`UPDATE software_project_updates SET artifact_version='Direction v2'`);html=await render();expect(html).toContain('Sketch 2.');expect(html).toContain('Open sketch 2 ↗');expect(html).toContain('I need from you: Send a sample.');expect(html).toContain('Next from me: Build the import.');
    sql.exec(`UPDATE software_project_updates SET artifact_version='Client Sketch V2 beta'`);html=await render();expect(html).toContain('Client Sketch V2 beta.');expect(html).toContain('Open Client Sketch V2 beta ↗');expect(html).toContain('data-version="Client Sketch V2 beta"');
    sql.exec(`UPDATE software_project_updates SET kind='delivery_review',artifact_version='Release V2 beta'`);html=await render();expect(html).toContain('Release V2 beta is ready to try.');expect(html).toContain('Accept Release V2 beta');expect(html).toContain('Open Release V2 beta ↗');expect(html).toMatch(/<strong[^>]*>Release V2 beta<\/strong>/);
    sql.exec(`UPDATE software_project_updates SET kind='delivery_review',artifact_version='Delivery v2'; INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted Delivery v2','v2','milestone_accepted','2026-10-02'); INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at) VALUES ('balance','r','current',0,'milestone',240000,30,'open','https://example.com/invoice','owner','now','now')`);
    html=await render();expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>After payment<\/span>/);expect(html).toContain('Version 2 is accepted.');expect(html).toContain('Thanks. The last step is the balance.');expect(html).toContain('Pay $2,400 ↗');expect(html).toContain("Your files unlock as soon as it&#39;s paid.");
    sql.exec(`INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-03','owner'); UPDATE software_invoices SET status='paid'`);
    html=await render();expect(html).toMatch(/<h2[^>]*>Your decision<\/h2>/);expect(html).not.toContain('Try these');expect(html).toContain('Paid. Your files are on the way.');expect(html).toContain('I&#39;ll share the files and handoff notes here soon.');expect(html).toContain('You accepted Version 2 on Oct 2, 2026.');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>Handoff coming<\/span>/);expect(html).not.toContain('The last step is the balance.');expect(html).not.toContain('Pay $2,400 ↗');
    sql.exec(`DELETE FROM software_milestone_payments; UPDATE software_invoices SET status='open'`);
    sql.exec(`INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-03','owner'); UPDATE software_invoices SET status='paid'; INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,links_json,created_by,created_at,updated_at,shared_at) VALUES ('handoff','r','handoff','shared',0,'Files','handoff','[{"label":"Handoff notes","url":"https://example.com/notes"}]','owner','2026-10-03','2026-10-03','2026-10-03')`);
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('earlier-handoff','r','handoff','shared',0,'Earlier files','handoff','owner','2026-10-02','2026-10-02','2026-10-02')`);
    html=await render();expect(html).toContain("It&#39;s yours.");expect(html).toContain('Handoff notes');expect(html.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(1);expect(html).not.toContain('data-software-review');
    sql.exec(`UPDATE software_project_updates SET what_changed='The final source and guide are ready.',client_request='Save the source and guide.',checks_limitations='No live rollout.',next_step='Support within the correction period.' WHERE id='handoff'`);
    html=await render();expect(html).toContain("It&#39;s yours.");expect(html).toContain('Your files');expect(html).toMatch(/<h3[^>]*>Not included<\/h3><p[^>]*>No live rollout\.<\/p>/);expect(html).toMatch(/<h3[^>]*>Support after handoff<\/h3><p[^>]*>Support within the correction period\.<\/p>/);
    const currentHandoffFiles=html.slice(html.indexOf('Your files'),html.indexOf('</section>',html.indexOf('Your files')));
    expect(currentHandoffFiles).not.toMatch(/<h2[^>]*>Files<\/h2>/);
    expect(html.indexOf('Your files · Milestone 1')).toBeLessThan(html.indexOf('Your decision'));
    expect(html).not.toContain('Next update:');
    expect(html).toContain('Agreed checks');
    expect(currentHandoffFiles).toContain('The final source and guide are ready.');
    expect(currentHandoffFiles).toContain('I need from you: Save the source and guide.');
    expect(currentHandoffFiles).toContain('No live rollout.');
    expect(currentHandoffFiles).toContain('Support within the correction period.');
    expect(currentHandoffFiles).not.toContain('<img');
    expect(currentHandoffFiles).not.toContain('Open work');
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,what_changed,next_step,client_request,created_by,created_at,updated_at,shared_at) VALUES ('later','r','progress','shared',0,'Later work','Aftercare V3','working_preview','I updated the operating guide.','Check in next week.','Read the guide.','owner','2026-10-04','2026-10-04','2026-10-04')`);
    html=await render();expect(html).toContain('I updated the operating guide.');expect(html).toContain('Next from me: Check in next week.');expect(html).toContain('I need from you: Read the guide.');expect(html.indexOf('I updated the operating guide.')).toBeLessThan(html.indexOf('Your files'));expect(html).toContain('https://example.com/notes');expect(html).toContain('Support within the correction period.');expect(html.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(1);
    const textOnlyFiles=html.slice(html.indexOf('Your files'),html.indexOf('</section>',html.indexOf('Your files')));
    expect(textOnlyFiles).not.toMatch(/<h2[^>]*>Files<\/h2>/);
    expect(html).toContain('Next update: Oct 11, 2026');
    expect(textOnlyFiles).toContain('The final source and guide are ready.');
    expect(textOnlyFiles).toContain('I need from you: Save the source and guide.');
    expect(textOnlyFiles).toContain('No live rollout.');
    expect(textOnlyFiles).toContain('Support within the correction period.');
    expect(textOnlyFiles).not.toContain('<img');
    expect(textOnlyFiles).not.toContain('Open work');
    expect(html.match(/Support within the correction period\./g)).toHaveLength(1);
    expect(html.match(/id="version-v2"/g)).toHaveLength(1);
    sql.exec("UPDATE software_project_updates SET visual_key='handoff-image',visual_alt='The handed-off tracker.',preview_url='https://example.com/handoff-preview' WHERE id='handoff'");
    html=await render();
    const files=html.slice(html.indexOf('Your files'),html.indexOf('</section>',html.indexOf('Your files')));
    expect(files).toContain('/updates/handoff/visual');expect(files).toContain('alt="The handed-off tracker."');expect(files).toContain('href="https://example.com/handoff-preview"');
    expect(html.match(/src="[^"]*updates\/handoff\/visual"/g)).toHaveLength(1);
    sql.exec("UPDATE software_project_updates SET status='draft' WHERE id='later'");
    html=await render();expect(html).toContain("It&#39;s yours.");expect(html.slice(html.indexOf('Your files'),html.indexOf('</section>',html.indexOf('Your files')))).toContain('https://example.com/handoff-preview');
    sql.exec("UPDATE software_project_updates SET status='shared' WHERE id='later'");
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('sketch','r','direction_review','shared',0,'Undecided sketch','Direction v3','concept','owner','2026-10-05','2026-10-05','2026-10-05')`);
    html=await render();expect(html).toContain('Confirm this direction');expect(html).toContain('Your files');expect(html).toContain('https://example.com/notes');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>Oct 3, 2026<\/span>/);
    sql.exec(`UPDATE software_project_updates SET status='superseded' WHERE id='v2'`);
    sql.exec(`UPDATE software_project_updates SET shared_at='2026-10-06',what_changed='New progress after the sketch.' WHERE id='later'`);
    html=await render();expect(html.slice(0,html.indexOf('class="project-columns'))).toContain('New progress after the sketch.');expect(html).toContain('Confirm this direction');expect(html).toContain('Your files');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>Oct 3, 2026<\/span>/);
    sql.exec(`INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES ('new-delivery','r','delivery_review','shared',0,'New delivery','Delivery v3','working_preview','owner','2026-10-07','2026-10-07','2026-10-07')`);
    html=await render();expect(html).toContain('Version 3 is ready to try.');expect(html).toContain('Your files');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>Oct 3, 2026<\/span>/);
    expect(html.match(/data-endpoint="[^"]*reviews\/sketch"/g)).toHaveLength(1);
    sql.exec(`UPDATE software_project_updates SET delivered_deliverables_json='["Status view"]' WHERE id='new-delivery'`);
    sql.exec("UPDATE software_project_updates SET client_request='Try the corrected import.' WHERE id='new-delivery'; UPDATE software_project_updates SET client_request='Save the files.' WHERE id='handoff'");
    html=await render();
    expect(html.slice(html.indexOf('Your files'),html.indexOf('</section>',html.indexOf('Your files')))).toContain('I need from you: Save the files.');
    sql.exec("UPDATE software_project_updates SET client_request='Review the sketch.' WHERE id='sketch'");
    html=await render();expect(html.slice(html.indexOf('id="review-sketch"'))).toContain('I need from you: Review the sketch.');
    sql.exec("UPDATE software_project_updates SET status='superseded' WHERE id='sketch'; INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Accepted corrected delivery','new-delivery','milestone_accepted','2026-10-08'); DELETE FROM software_milestone_payments; UPDATE software_invoices SET status='open'");
    html=await render();expect(html.slice(html.indexOf('Earlier versions'))).toMatch(/<p class="access-note[^"]*">Sketch, not built yet<\/p>/);expect(html).toContain('Pay $2,400 ↗');expect(html).not.toContain('Your files ·');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>After payment<\/span>/);
    expect(html.slice(html.indexOf('Earlier updates'))).toContain('Oct 3, 2026');
    sql.exec("INSERT INTO software_milestone_payments VALUES ('r',0,'2026-10-08','owner'); UPDATE software_invoices SET status='paid'");
    html=await render();expect(html).toContain('Paid. Your files are on the way.');expect(html).not.toContain('Your files ·');expect(html).toMatch(/<strong[^>]*>Yours<\/strong><span[^>]*>Handoff coming<\/span>/);
    sql.exec("UPDATE software_project_updates SET shared_at='2026-10-09' WHERE id='handoff'; UPDATE software_project_updates SET artifact_version='' WHERE id='later'");
    html=await render();expect(html).toContain('Your files ·');expect(html.slice(html.indexOf('Earlier updates'))).toMatch(/Update · Oct 6, 2026/);expect(html.slice(html.indexOf('Earlier updates'))).not.toContain('Latest update');
    sql.exec("DELETE FROM software_project_messages WHERE update_id='new-delivery'; UPDATE software_project_updates SET status='shared' WHERE id='sketch'");
    sql.exec(`UPDATE software_projects SET milestone_index=1,next_update_on='2026-10-10'`);
    sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify({...scope,milestones:[...scope.milestones,{...scope.milestones[0],name:'Follow-up'}]}));
    html=await render();expect(html).toContain('Milestone 2 is starting.');expect(html).toContain('Next update: Oct 10, 2026');expect(html).not.toContain('Sketch 3.');expect(html).toContain('Your files');expect(html).toContain('https://example.com/notes');expect(html.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(1);
    const olderReview=html.slice(html.indexOf('data-endpoint="/api/studio/software/r/reviews/new-delivery"'));
    expect(olderReview).toMatch(/name="missing_deliverables" value="1"/);expect(olderReview).toMatch(/name="inaccessible_deliverables" value="0"/);
  } finally {sql.close();vi.useRealTimers();}
});
it('masks the recipient on every unauthenticated email receipt', async () => {
  const {sql,db}=await fixture();
  try {
    sql.prepare("INSERT INTO software_agreement_templates VALUES('msa','msa',1,'Template',?,1,'now','owner')").run('a'.repeat(64));
    sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1; UPDATE software_offers SET msa_template_id='msa',recipient_email_snapshot='alex@example.com' WHERE id='current'");
    const container=await AstroContainer.create();
    const html=await container.renderToString(signPage,{params:{token},request:new Request(`https://thesuperhuman.us/offer/${token}/sign?email=sent`),locals:{runtime:{env:{MUSIC_DB:db}}}} as any);
    expect(html).toContain('I sent a link to a•••@example.com.');
    expect(html).not.toContain('alex@example.com');
    expect(html).toContain('data-appearance="interaction-only"');
  } finally {sql.close();}
});

it('renders a quiet Remove control beside each unsent attachment',async()=>{
  const {sql,db}=await fixture();
  try {
    sql.exec('UPDATE software_signing_settings SET software_signing_enabled=1');
    const attachment={filename:'Draft.pdf',version:'1',date:'2026-10-01',key:'agreements/attachments/draft.pdf'};
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE status='draft'").run(JSON.stringify({attachments:[attachment]}));
    const offers=(await db.prepare('SELECT * FROM software_offers').all()).results;
    const html=await (await AstroContainer.create()).renderToString(editor,{props:{requestId:'r',email:'alex@example.com',offers},locals:{runtime:{env:{MUSIC_DB:db}}}} as any);
    expect(html).toMatch(/Draft.pdf[\s\S]*class="studio-quiet"[^>]*data-remove-attachment[^>]*>Remove<\/button>/);
  } finally {sql.close();}
});

it('renders omitted duplicate legacy deliverables by index without offering acceptance',async()=>{
  const {sql,db}=await fixture();
  try {
    const purchased={...terms,milestones:[{...terms.milestones[0],deliverables:['Status view','Status view']}]};
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r','current',?,'standard','now','now','now','owner','now','now')").run(JSON.stringify(purchased));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,delivered_deliverables_json,created_by,created_at,updated_at,shared_at) VALUES('review','r','delivery_review','shared',0,'Tracker','working_preview','[0]','owner','2026-10-01','2026-10-01','2026-10-01')");
    const session='a'.repeat(72);const {createHash}=await import('node:crypto');
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,'alex@example.com','now','2099-01-01','now')").run(createHash('sha256').update(session).digest('hex'));
    const html=await (await AstroContainer.create()).renderToString(softwarePage,{params:{id:'r'},request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}}} as any);
    expect(html).toMatch(/value="milestone_accepted"[^>]*disabled[^>]*>Accept Latest update/);
    expect(html).toMatch(/name="missing_deliverables" value="1"/);
    expect(html).not.toMatch(/name="inaccessible_deliverables" value="1"/);
  } finally {sql.close();}
});

it('renders scanner-safe agreement and archive landings with exact copy', async()=>{
  const {sql,db}=await fixture();
  try {
    const key='k'.repeat(43);
    sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1; UPDATE software_offers SET recipient_email_snapshot='alex@example.com' WHERE id='current'");
    const container=await AstroContainer.create();
    for(const archive of [false,true]) {
      sql.prepare("INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").run(archive?'archive':'agreement',archive?'archive':'agreement',archive?null:'current',archive?null:await hashOfferToken(token),'alex@example.com',await hashOfferToken(key),'now','2099-01-01');
      const response=await container.renderToResponse(archive?archiveLanding:linkLanding,{params:{token},request:new Request(`https://thesuperhuman.us/${archive?'agreements':`offer/${token}`}/verify?key=${key}`),locals:{runtime:{env:{MUSIC_DB:db}}}} as any);
      const html=await response.text();
      expect(response.status).toBe(200);expect(response.headers.get('referrer-policy')).toBe('no-referrer');expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain(archive?'Your documents are ready.':'Your agreement is ready.');
      expect(html).toContain(archive?'>Continue</button>':'>Continue to sign</button>');expect(html).toContain('This link works once.');expect(html).toContain('method="post"');
      expect(html).toMatch(/<form class="agreement-form"/);
      if(!archive)expect(html).toContain('Current offer');
      for (const origin of ['https://thesuperhuman.us', 'http://127.0.0.1:4321']) {
        const preview = await container.renderToResponse(archive?archiveLanding:linkLanding, {params:{token}, request:new Request(`${origin}/${archive?'agreements':`offer/${token}`}/verify?key=${key}`), locals:{runtime:{env:{MUSIC_DB:db,SITE_ORIGIN:'http://127.0.0.1:4321'}}}} as any);
        expect(preview.status).toBe(origin === 'http://127.0.0.1:4321' ? 200 : 404);
        if (preview.status === 200) expect(await preview.text()).toContain(archive?'Your documents are ready.':'Your agreement is ready.');
      }
      expect(sql.prepare('SELECT used_at FROM software_agreement_links WHERE id=?').get(archive?'archive':'agreement').used_at).toBeNull();
      sql.exec('DELETE FROM software_agreement_links');
      const expired=await container.renderToString(archive?archiveLanding:linkLanding,{params:{token},request:new Request(`https://thesuperhuman.us/${archive?'agreements':`offer/${token}`}/verify?key=${key}`),locals:{runtime:{env:{MUSIC_DB:db}}}} as any);
      expect(expired).toMatch(/class="page-lede"[^>]*>Links work once and last an hour\.<\/p>/);
      expect(expired).toMatch(/class="agreement-form"/);
    }
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

it('renders legacy reissue guidance and removes signing actions after a project starts',async()=>{
  const {sql,db}=await fixture();
  try {
    const container=await AstroContainer.create();
    const offers=(await db.prepare('SELECT * FROM software_offers').all()).results;
    const html=await container.renderToString(editor,{props:{requestId:'r',email:'alex@example.com',revoked:true,offers}});
    expect(html).toContain('Sent before website signing. The client will sign outside the website. For website signing, create a new draft.');
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard','now','now','now','owner','now','now')").run(JSON.stringify(terms));
    const done=await (await render(db,token)).text();
    expect(done).toContain('Signed by both of you.');expect(done).toContain('Open your project page');expect(done).not.toContain('Review and sign');
    sql.prepare("UPDATE software_offers SET agreement_details_json=? WHERE id='current'").run(JSON.stringify({review_business_days:12,correction_calendar_days:60,handoff_access_days:90}));
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at,review_window_days) VALUES('old-draft','r','progress','draft',0,'Draft','concept','owner','now','now',5)");
    const ownerHTML=await container.renderToString(composer,{request:new Request('https://thesuperhuman.us/owner/requests/r/update'),params:{id:'r'},locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    expect(ownerHTML).toContain('Keep these files available for 90 days.');
    expect(ownerHTML).toMatch(/name="review_window_days"[^>]*value="12"/);
  } finally {sql.close();}
});
it.each(['client_signed','executed'])('renders a %s offer without another signing action',async status=>{
  const {sql,db}=await fixture();
  try {
    sql.exec("UPDATE software_signing_settings SET software_signing_enabled=1; INSERT INTO software_agreement_clients VALUES('party','alex@example.com','Example Client','example','LLC','WY','Example address','alex@example.com','now'); INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES('template','sow',1,'Synthetic',lower(hex(zeroblob(32))),'now','owner')");
    sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('agreement','sow','current','r','party','template',?,'Synthetic',?,'{}','now','2026-10-01','session')").run(status,'a'.repeat(64));
    sql.exec("UPDATE software_offers SET msa_template_id='template' WHERE id='current'");
    const html=await (await render(db,token)).text();
    expect(html).toContain(status==='executed'?'Signed by both of you.':'Signed. Over to Kazon.');
    expect(html).not.toContain('Review and sign');expect(html).not.toContain('data-agreement-link');
    expect(sql.prepare('SELECT count(*) n FROM audio_client_allowances').get().n).toBe(0);
  } finally {sql.close();}
});

it('keeps payment and acceptance terms with each rail review and decisions with current work', async () => {
  const {sql,db}=await fixture(),container=await AstroContainer.create();
  try {
    const scope={...terms,milestones:[terms.milestones[0],{...terms.milestones[0],name:'Follow-up',feeCents:360000}]};
    sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,milestone_index,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES ('r','current',?,'standard',1,'now','now','2026-09-29','owner','now','now')").run(JSON.stringify(scope));
    const session='a'.repeat(72);
    sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES (?,'alex@example.com','now','2099-01-01','now')").run(await hashOfferToken(session));
    const render=()=>container.renderToString(softwarePage,{request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),params:{id:'r'},locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}} as any});
    for(const [id,milestone,version] of [['old',0,1],['new',1,2]] as const) sql.prepare("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES (?,'r','delivery_review','shared',?,'Tracker',?,'working_preview','owner','now','now',?)").run(id,milestone,`Delivery v${version}`,`2026-10-0${version}`);
    for(const mode of ['standard','invoice']) {
      sql.prepare('UPDATE software_projects SET payment_mode=?').run(mode);
      const html=await render();
      for(const [id,milestone,version] of [['old',1,1],['new',2,2]] as const) {
        const section=html.slice(html.indexOf(`id="review-${id}"`),html.indexOf('</form>',html.indexOf(`id="review-${id}"`)));
        expect(section).toMatch(new RegExp(`Accepting version ${version} accepts milestone ${milestone} in full, including every check above\\.<\\/p>\\s*<button`));
        expect(section).toMatch(new RegExp(`Accept version ${version}<\\/button>\\s*<p[^>]*>${mode==='standard' ? 'The' : 'This milestone'}`));
        expect(section).toContain(mode==='standard' ? (milestone===1 ? '$1,200 balance is invoiced' : '$1,800 balance is invoiced') : 'This milestone is invoiced');
      }
    }
    sql.exec("INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,due_at,created_by,created_at,updated_at) VALUES('balance','r','current',0,'milestone',240000,30,'open','https://example.com/pay','2026-11-01','owner','now','now')");
    let html=await render();
    let rail=html.slice(html.indexOf('id="review-old"'),html.indexOf('</form>',html.indexOf('id="review-old"')));
    expect(rail).toContain('Invoice due Nov 1, 2026.');expect(rail).toContain('Pay $2,400 ↗');expect(rail).toContain('href="https://example.com/pay"');expect(rail).toContain('The files are yours once it&#39;s paid.');
    expect(html.slice(html.indexOf('id="review-new"'),html.indexOf('</form>',html.indexOf('id="review-new"')))).not.toContain('Invoice due');
    sql.exec("UPDATE software_invoices SET status='paid'");
    html=await render();rail=html.slice(html.indexOf('id="review-old"'),html.indexOf('</form>',html.indexOf('id="review-old"')));
    expect(rail).toContain('Invoice due Nov 1, 2026.');expect(rail).not.toContain('Pay $2,400');
    sql.exec('DELETE FROM software_invoices');
    for(const kind of ['direction_review','delivery_review']) {
      sql.prepare("UPDATE software_project_updates SET status='superseded',kind=? WHERE id='new'").run(kind);
      sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,created_by,created_at,updated_at,shared_at) VALUES('replacement','r','delivery_review','shared',1,'Tracker','Delivery v3','working_preview','owner','now','now','2026-10-04')");
      html=await render();
      expect(html).toContain('href="#version-new"');expect(html.match(/id="version-new"/g)).toHaveLength(1);
      sql.exec("DELETE FROM software_project_updates WHERE id='replacement'");
    }
    sql.exec("UPDATE software_project_updates SET status='shared' WHERE id='new'");
    sql.exec("DELETE FROM software_project_updates WHERE id='old'");
    for(const [kind,decision,record] of [['direction_review','direction_confirmed','You confirmed this direction on'],['delivery_review','changes_requested','You asked for changes on'],['delivery_review','milestone_accepted','You accepted Version 2 on']]) {
      sql.prepare("UPDATE software_project_updates SET kind=? WHERE id='new'").run(kind);
      sql.exec('DELETE FROM software_project_messages');
      sql.prepare("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES ('r','client','token','Please revise.','new',?,'2026-10-03')").run(decision);
      const html=await render(),current=html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'));
      expect(current).toMatch(/<h2[^>]*>Your decision<\/h2>/);
      expect(current).toContain(record);
      expect(current.match(/Your decision/g)).toHaveLength(1);
      expect(current).not.toContain('After you accept');
    }
  } finally {sql.close();}
});

async function reviewStateFixture() {
  const fixtureData=await fixture(),{sql,db}=fixtureData,container=await AstroContainer.create();
  const scope=structuredClone({...terms,milestones:[terms.milestones[0],{...terms.milestones[0],name:'Follow-up'}]});
  sql.prepare("INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,created_at,updated_at) VALUES('r','current',?,'standard','now','now','now','owner','now','now')").run(JSON.stringify(scope));
  const session='a'.repeat(72);
  sql.prepare("INSERT INTO audio_client_sessions(token_hash,email,created_at,expires_at,last_seen_at) VALUES(?,'alex@example.com','now','2099-01-01','now')").run(await hashOfferToken(session));
  const render=()=>container.renderToString(softwarePage,{params:{id:'r'},request:new Request('https://thesuperhuman.us/studio/software/r',{headers:{cookie:`studio_session=${session}`}}),locals:{runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}}} as any);
  const add=(id:string,kind:string,milestone=0,date='2026-10-01')=>sql.prepare("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,artifact_version,evidence_type,criteria_json,delivered_deliverables_json,what_changed,created_by,created_at,updated_at,shared_at) VALUES(?,'r',?,'shared',?,?,?,'working_preview','[\"Unique evidence for this check.\"]','[0]',?,'owner',?,?,?)").run(id,kind,milestone,`${id} work`,kind==='direction_review'?'Direction v1':'Delivery v1',`${id} explanation`,date,date,date);
  const decision=(id:string,value='milestone_accepted')=>sql.prepare("INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES('r','client','token','Decision',?,?,'2026-10-02')").run(id,value);
  return {...fixtureData,scope,container,render,add,decision};
}
it.each([false,true])('keeps earlier accepted milestones under current work, paid=%s',async paid=>{
  const {sql,render,add,decision}=await reviewStateFixture();
  try {
    add('accepted','delivery_review');decision('accepted');add('current','progress',1,'2026-10-04');
    sql.exec("UPDATE software_project_updates SET preview_url='https://example.com/delivered',visual_key='private-image',visual_alt='Delivered screen',checks_limitations='Delivery limitation',next_step='Delivery next step' WHERE id='accepted'");
    sql.exec("UPDATE software_projects SET milestone_index=1; INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at) VALUES('balance','r','current',0,'balance',120000,15,'open','https://example.com/pay','owner','now','now')");
    if(paid)sql.exec("INSERT INTO software_milestone_payments VALUES('r',0,'2026-10-03','owner'); UPDATE software_invoices SET status='paid'");
    let html=await render(),current=html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'));
    expect(current).toMatch(/<h2[^>]*>Milestone 1<\/h2>/);
    expect(current).toContain('See the delivered version');
    expect(current).toContain('accepted work');
    expect(current).toContain('Unique evidence for this check.');
    expect(current).toContain('accepted explanation');
    expect(current).toContain('https://example.com/delivered');
    expect(current).toContain('/updates/accepted/visual');
    expect(current).toContain('Delivered screen');
    expect(current).toContain('Delivery limitation');
    expect(current).toContain('Delivery next step');
    expect(current.match(/You accepted Version 1 on Oct 2, 2026\./g)).toHaveLength(1);
    expect(current).toContain('You accepted Version 1 on Oct 2, 2026.');
    expect(current).toContain(paid?'Paid. Your files are on the way.':'Pay $1,200 ↗');
    expect(current.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(1);
    expect(current.indexOf('current work')).toBeLessThan(current.indexOf('Milestone 1'));
    add('handoff','handoff',0,'2026-10-05');
    html=await render();current=html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'));
    expect(current).toContain('Your files · Milestone 1');expect(current).not.toMatch(/<h2[^>]*>Milestone 1<\/h2>/);
  } finally {sql.close();}
});
it.each([false,true])('shows each combined review record once before and after earlier handoff, paid=%s',async paid=>{
  const {sql,render,add,decision}=await reviewStateFixture();
  try {
    add('accepted','delivery_review');decision('accepted');
    add('direction','direction_review',1,'2026-10-02');
    add('delivery','delivery_review',1,'2026-10-03');
    add('progress','progress',1,'2026-10-04');
    sql.exec("UPDATE software_projects SET milestone_index=1");
    if(paid)sql.exec("INSERT INTO software_milestone_payments VALUES('r',0,'2026-10-03','owner')");
    for(const handedOff of [false,true]) {
      if(handedOff)add('handoff','handoff',0,'2026-10-05');
      const html=await render(),history=html.slice(html.indexOf('class="project-history'));
      expect(html.match(/You accepted Version 1 on Oct 2, 2026\./g)).toHaveLength(1);
      for(const id of ['direction','delivery','progress'])expect(html.match(new RegExp(`${id} work`,'g'))).toHaveLength(1);
      expect(history.includes('id="version-accepted"')).toBe(handedOff);
      expect(html).not.toContain('id="version-direction"');
      expect(html).not.toContain('id="version-delivery"');
    }
  } finally {sql.close();}
});
it.each([false,true])('derives acceptance from delivery despite an undecided direction, paid=%s',async paid=>{
  const {sql,render,add,decision}=await reviewStateFixture();
  try {
    add('direction','direction_review');add('accepted','delivery_review',0,'2026-10-02');decision('accepted');
    sql.exec("INSERT INTO software_invoices(id,request_id,offer_id,milestone_index,kind,amount_cents,days_until_due,status,hosted_invoice_url,created_by,created_at,updated_at) VALUES('balance','r','current',0,'balance',120000,15,'open','https://example.com/pay','owner','now','now')");
    if(paid)sql.exec("INSERT INTO software_milestone_payments VALUES('r',0,'2026-10-03','owner'); UPDATE software_invoices SET status='paid'");
    const html=await render(),current=html.slice(html.indexOf('class="project-current'),html.indexOf('<aside'));
    expect(html.slice(0,html.indexOf('class="project-columns'))).toContain(paid?'Paid. Your files are on the way.':'Version 1 is accepted.');
    expect(current).toContain('You accepted Version 1 on Oct 2, 2026.');expect(current).toContain('Corrections are covered through Nov 1, 2026.');
    if(!paid)expect(current).toContain('Pay $1,200 ↗');
    expect(html.slice(html.indexOf('<aside'))).toContain('Confirm this direction');
  } finally {sql.close();}
});
it.each(['delivery_review','direction_review'])('shows newer progress above pending %s actions without a handoff',async kind=>{
  const {sql,render,add}=await reviewStateFixture();
  try {
    add('pending',kind);add('newer','progress',0,'2026-10-03');
    const html=await render(),top=html.slice(0,html.indexOf('<aside'));
    expect(top).toContain('newer explanation');expect(top).toContain('newer work');expect(top).not.toContain('pending work');
    expect(html.slice(html.indexOf('<aside'))).toContain(kind==='delivery_review'?'Accept version 1':'Confirm this direction');
  } finally {sql.close();}
});
it.each(['active','complete','superseded'])('keeps evidence unless editable form displays it: %s',async state=>{
  const {sql,render,add}=await reviewStateFixture();
  try {
    add('review','delivery_review');
    if(state==='complete')sql.exec("UPDATE software_projects SET state='complete'");
    if(state==='superseded')sql.exec("UPDATE software_project_updates SET status='superseded'");
    const html=await render();
    expect(html).toContain('Unique evidence for this check.');
    expect(html.includes('Agreed checks')).toBe(state!=='active');
    expect(html.includes('data-software-review')).toBe(state==='active');
  } finally {sql.close();}
});
it.each([
  ['Save','Saved records persist','Saved records persist'],
  ['Save','Save records persist','Save records persist'],
  ['Save','Save: Records persist','Records persist'],
  ['Save.','Save. Records persist','Records persist'],
  ['Save!','Save!\nRecords persist','Records persist'],
  ['Save?','Save? Records persist','Records persist'],
  ['Save.','Save.records persist','Save.records persist'],
  ['Save.',' Save. Records persist',' Save. Records persist'],
])('trims evidence only at a clear boundary: %s / %s',async(check,evidence,expected)=>{
  const {sql,render,add,scope}=await reviewStateFixture();
  try {
    scope.milestones[0].acceptance=[check];sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify(scope));
    add('review','delivery_review');sql.prepare('UPDATE software_project_updates SET criteria_json=?').run(JSON.stringify([evidence]));
    const html=await render();expect(html).toMatch(new RegExp(`<p class="hint[^\"]*">${expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}<\\/p>`));
  } finally {sql.close();}
});
it.each(['direction_confirmed','milestone_accepted','changes_requested'])('names the milestone in client decision messages: %s',async value=>{
  const {sql,render,add,decision}=await reviewStateFixture();
  try {
    add('review',value==='direction_confirmed'?'direction_review':'delivery_review',1);decision('review',value);
    const html=await render();
    expect(html).toContain(value==='direction_confirmed'?'You confirmed sketch 1 for milestone 2.':value==='milestone_accepted'?'You accepted version 1 of milestone 2.':'You asked for changes to version 1 of milestone 2.');
  } finally {sql.close();}
});
it.each([
  [false,'Direction v2','You confirmed sketch 2.'],
  [true,'Direction v2','You confirmed sketch 2 for milestone 2.'],
  [false,'Import workflow sketch','You confirmed Import workflow sketch.'],
  [true,'Import workflow sketch','You confirmed Import workflow sketch for milestone 2.'],
])('names the confirmed sketch (multiple milestones: %s, label: %s)',async(multiple,label,expected)=>{
  const {sql,render,add,decision,scope}=await reviewStateFixture();
  try {
    if(!multiple) {
      scope.milestones=scope.milestones.slice(0,1);
      sql.prepare('UPDATE software_projects SET terms_json=?').run(JSON.stringify(scope));
    }
    add('review','direction_review',multiple?1:0);
    sql.prepare('UPDATE software_project_updates SET artifact_version=? WHERE id=?').run(label,'review');
    decision('review','direction_confirmed');
    expect(await render()).toContain(expected);
  } finally {sql.close();}
});
it('renders future milestone choices unavailable for progress but available for review drafts',async()=>{
  const {sql,db,container}=await reviewStateFixture();
  try {
    const render=()=>container.renderToString(composer,{params:{id:'r'},request:new Request('https://thesuperhuman.us/owner/requests/r/update'),locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db,AUDIO_CLIENT_PORTAL_ENABLED:'true'}}}} as any);
    let html=await render();expect(html).toMatch(/<option value="1"[^>]*disabled[^>]*hidden/);
    sql.exec("INSERT INTO software_project_updates(id,request_id,kind,status,milestone_index,title,evidence_type,created_by,created_at,updated_at) VALUES('draft-review','r','direction_review','draft',1,'Sketch','concept','owner','now','now')");
    html=await render();expect(html).toMatch(/<option value="1" selected[^>]*>Milestone 2/);
  } finally {sql.close();}
});
it('keeps every earlier acceptance visible until its own handoff',async()=>{
  const {sql,render,add,decision,scope}=await reviewStateFixture();
  try {
    scope.milestones.push({...scope.milestones[0],name:'Final stage'});
    sql.prepare('UPDATE software_projects SET milestone_index=2,terms_json=?').run(JSON.stringify(scope));
    for(const milestone of [0,1]){add(`accepted-${milestone}`,'delivery_review',milestone);decision(`accepted-${milestone}`);}
    const html=await render(),current=html.slice(html.indexOf('class="project-current'),html.indexOf('class="project-history'));
    for(const milestone of [1,2])expect(current).toMatch(new RegExp(`<h2[^>]*>Milestone ${milestone}<\\/h2>`));
    expect(current.match(/You accepted Version 1 on Oct 2, 2026\./g)).toHaveLength(2);
    expect(current.match(/Corrections are covered through Nov 1, 2026\./g)).toHaveLength(2);
    add('handoff','handoff',0,'2026-10-03');
    const updated=await render(),updatedCurrent=updated.slice(updated.indexOf('class="project-current'),updated.indexOf('class="project-history'));
    expect(updatedCurrent).toContain('Your files · Milestone 1');expect(updatedCurrent).not.toMatch(/<h2[^>]*>Milestone 1<\/h2>/);expect(updatedCurrent).toMatch(/<h2[^>]*>Milestone 2<\/h2>/);
  } finally {sql.close();}
});

it('renders all four personalized receipt outcomes into the rendered page', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(start,{request:new Request('https://thesuperhuman.us/software/start'),locals:{runtime:{env:{}}} as any});
  const dom = parse(html);
  const find = (node: any, attribute: string): any => node.attrs?.some((attr: any) => attr.name === attribute) ? node : node.childNodes?.map((child: any) => find(child,attribute)).find(Boolean);
  expect(find(dom,'data-intake-progress').attrs.some((attr: any) => attr.name === 'hidden')).toBe(false);
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
    ] as const) {
      renderSoftwareReceipt({brief:{name:'Alex Example',email:'alex@example.com'},clientCopyStatus:status});
      expect(serialize(find(dom,'data-receipt-thanks'))).toBe("Thanks, Alex. I'll read it myself and reply within two business days.");
      expect(serialize(find(dom,'data-copy-status'))).toBe(line);
      const card = find(dom,'data-copy-card');
      expect(serialize(card).split(line)).toHaveLength(2);
      expect(card.attrs.find((attr: any) => attr.name === 'class').value).toContain('intake-link-panel');
      const receipt = card.parentNode;
      expect(receipt.childNodes.indexOf(card)).toBeLessThan(receipt.childNodes.findIndex((node: any) => node.tagName === 'ol'));
      expect(serialize(receipt).match(/data-copy-card/g)).toHaveLength(1);
      expect(serialize(dom).match(/data-copy-status/g)).toHaveLength(1);
      expect(find(dom,'data-intake-progress').attrs.some((attr: any) => attr.name === 'hidden')).toBe(true);
      expect(find(dom,'data-copy-icon').attrs.some((attr: any) => attr.name === 'hidden')).toBe(status !== 'sent' && status !== 'uncertain');
      const renderedNote = find(dom,'data-copy-note');
      expect(renderedNote.attrs.some((attr: any) => attr.name === 'hidden')).toBe(note === null);
      if (note) expect(serialize(renderedNote)).toBe(note);
    }
  } finally {vi.unstubAllGlobals();}
});

it('renders the AI disclosure beside both answer boxes and the dated retention notice', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(start, { request:new Request('https://thesuperhuman.us/software/start'), locals:{runtime:{env:{}}} as any });
  const document = parse(html);
  const sections: any[] = [];
  function visit(node: any) { if (node.tagName === 'section' && node.attrs?.some((attr: any) => attr.name === 'data-step' && ['1','2'].includes(attr.value))) sections.push(node); for (const child of node.childNodes ?? []) visit(child); }
  visit(document); expect(sections).toHaveLength(2);
  for (const section of sections) {
    const output = serialize(section);
    expect(output).toContain("Suggestions come from Cloudflare's AI, which sees only what you type in the answer boxes.");
    expect(output).toContain('Please leave out passwords, access details and real customer data.');
    expect(output).not.toContain('Leave out passwords and customer data.');
    expect(output).toContain('href="/privacy#software-briefs"'); expect(output).toContain('Suggestions are off.'); expect(output).toContain('Turn off');
  }
  const notice = await container.renderToString(privacy, { request:new Request('https://thesuperhuman.us/privacy') });
  expect(notice).toContain('Updated October 10, 2026'); expect(notice).toContain('id="software-briefs"');
  expect(notice).toContain('a counter derived from your IP address, kept for up to two days');
});

it('shows the countersign requirement beside both disabled closing actions', async () => {
  const {sql,db}=await fixture();
  try {
    sql.prepare("INSERT INTO software_agreement_templates VALUES ('msa','msa',1,'Template',?,1,'now','owner')").run('a'.repeat(64));
    sql.exec("INSERT INTO software_agreement_clients VALUES ('client','alex@example.com','Example LLC','example llc','LLC','Wyoming','Business address','notice@example.com','now')");
    sql.prepare("INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,status,canonical_text,text_sha256,values_json,created_at,effective_on,review_session_hash) VALUES('sow','sow','current','r','client','msa','client_signed','Exact',?,'{}','now','2026-09-30','session')").run('a'.repeat(64));
    const container=await AstroContainer.create();
    const html=await container.renderToString(ownerRequest,{params:{id:'r'},request:new Request('https://thesuperhuman.us/owner/requests/r'),locals:{owner:{email:'owner@example.com'},runtime:{env:{MUSIC_DB:db}}}} as any);
    expect(html).toContain('Countersign or abandon the signed agreement first.');
    for(const action of ['resolve','withdraw']) expect(html).toMatch(new RegExp(`data-action="${action}"[^>]*disabled`));
  } finally {sql.close();}
});
