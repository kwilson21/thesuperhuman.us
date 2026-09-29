import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { hashOfferToken } from '~/lib/software-offers';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let directory: string, softwarePage: any, page: any, preview: any, editor: any, questions: any, fit: any;
const token = 'a'.repeat(43);
const terms = { outcome:'Current offer',summary:'A shared view.',milestones:[{ name:'Tracker',deliverables:['Status view'],acceptance:['Add a client.'],feeCents:240000 }],clientInputs:'',exclusions:'',timing:'',paymentMode:'standard' };
beforeAll(async () => {
  directory = await mkdtemp(resolve('.software-render-'));
  await build({ entryPoints:{ software:'src/pages/studio/software/[id].astro', client:'src/pages/offer/[token].astro', preview:'src/pages/owner/requests/[id]/offer.astro', editor:'src/components/owner/SoftwareOfferEditor.astro', questions:'src/components/owner/SoftwareQuestions.astro', fit:'src/components/owner/SoftwareFitReview.astro' }, outdir:directory, outExtension:{ '.js':'.mjs' }, bundle:true, format:'esm', platform:'node', packages:'external',
    plugins:[{ name:'astro-test-render', setup(builder) {
      builder.onResolve({ filter:/\.css(?:\?|$)|\?astro/ }, () => ({ path:'empty-style',namespace:'empty' }));
      builder.onLoad({ filter:/.*/,namespace:'empty' }, () => ({ contents:'',loader:'js' }));
      builder.onResolve({ filter:/^~\// }, args => ({ path:resolve('src',args.path.slice(2)) + (args.path.endsWith('.astro') ? '' : '.ts') }));
      builder.onLoad({ filter:/\.astro$/ }, async args => ({ contents:(await transform(await readFile(args.path,'utf8'),{ filename:args.path,internalURL:'astro/compiler-runtime',astroGlobalArgs:'"https://thesuperhuman.us"',resolvePath:specifier => specifier })).code,loader:'ts',resolveDir:dirname(args.path) }));
    } }],
  });
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(directory)) { const compiled = (await import(/* @vite-ignore */ pathToFileURL(resolve(directory,file)).href)).default; if (file.startsWith('software')) softwarePage = compiled; else if (file.startsWith('client')) page = compiled; else if (file.startsWith('preview')) preview = compiled; else if (file.startsWith('editor')) editor = compiled; else if (file.startsWith('questions')) questions = compiled; else fit = compiled; }
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
    const renderEditor = (resolved:boolean, revoked = false) => container.renderToString(editor, { props:{ requestId:'r', email:'alex@example.com', offers, revoked, resolved } });
    const open = await renderEditor(false);
    expect(open).toContain('The client link is in your copy of the offer email. To issue a new one, revoke this link and send again.');
    expect(open).toContain('data-offer-form');
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
