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
let directory: string, page: any;
const token = 'a'.repeat(43);
const terms = { outcome:'Current offer',summary:'A shared view.',milestones:[{ name:'Tracker',deliverables:['Status view'],acceptance:['Add a client.'],feeCents:240000 }],clientInputs:'',exclusions:'',timing:'',paymentMode:'standard' };
beforeAll(async () => {
  directory = await mkdtemp(resolve('.software-render-'));
  const output = resolve(directory, 'offer.mjs');
  await build({ entryPoints:['src/pages/offer/[token].astro'], outfile:output, bundle:true, format:'esm', platform:'node', packages:'external',
    plugins:[{ name:'astro-test-render', setup(builder) {
      builder.onResolve({ filter:/\.css(?:\?|$)|\?astro/ }, () => ({ path:'empty-style',namespace:'empty' }));
      builder.onLoad({ filter:/.*/,namespace:'empty' }, () => ({ contents:'',loader:'js' }));
      builder.onResolve({ filter:/^~\// }, args => ({ path:resolve('src',args.path.slice(2)) + (args.path.endsWith('.astro') ? '' : '.ts') }));
      builder.onLoad({ filter:/\.astro$/ }, async args => ({ contents:(await transform(await readFile(args.path,'utf8'),{ filename:args.path,internalURL:'astro/compiler-runtime',astroGlobalArgs:'"https://thesuperhuman.us"',resolvePath:specifier => specifier })).code,loader:'ts',resolveDir:dirname(args.path) }));
    } }],
  });
  page = (await import(/* @vite-ignore */ pathToFileURL(output).href)).default;
});
afterAll(async () => { if (directory) await rm(directory,{ recursive:true,force:true }); });
async function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync(resolve('db/music.sql'),'utf8'));
  sql.prepare(`INSERT INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at)
    VALUES ('r','software','workflow','Alex Example','alex@example.com','Tool','{"company":"Example Studio","fit":"PRIVATE FIT"}','new','PRIVATE NOTE','now','now')`).run();
  const offer = sql.prepare(`INSERT INTO software_offers(id,request_id,version,status,terms_json,created_at,updated_at,sent_at,sent_by) VALUES (?,'r',?,?,?,'now','now','now','PRIVATE ACTOR')`);
  offer.run('old',1,'superseded',JSON.stringify({ ...terms,outcome:'OLD PRIVATE TERMS' }));
  offer.run('current',2,'sent',JSON.stringify(terms));
  offer.run('draft',3,'draft',JSON.stringify({ ...terms,outcome:'DRAFT PRIVATE TERMS' }));
  sql.prepare("INSERT INTO software_offer_links VALUES ('r',?,'now',NULL)").run(await hashOfferToken(token));
  const statement = (query: string,args: unknown[] = []) => ({ bind:(...values:unknown[]) => statement(query,values),first:async () => sql.prepare(query).get(...args) ?? null });
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
