import { existsSync, readFileSync } from 'node:fs';
import interBase64 from '~/assets/agreement-fonts/Inter-400.base64?raw';
import newsreaderBase64 from '~/assets/agreement-fonts/Newsreader-400.base64?raw';
import { agreementDetailsSchema, contractorSchema, agreementValues } from '~/lib/agreement-fields';
import { templateFields, renderAgreement, type AgreementTemplate } from '~/lib/agreement-templates';
import type { OfferTerms } from '~/lib/software-offers';
import { expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { preflightAgreementPacket, renderAgreementPacket } from '~/lib/agreement-pdf';
import { canonicalJson, hashBytes } from '~/lib/agreement-artifacts';
import type { Agreement } from '~/lib/software-agreements';

const assets = { fetch: async () => { throw new Error('PDF rendering must not fetch font assets.'); } };
function document(kind: 'msa' | 'sow', text: string, offer = 'current'): Agreement {
  return { id: kind, kind, offer_id: offer, canonical_text: text, attachment_manifest_json: '[]' } as Agreement;
}
function extract(pdf: PDFDocument) {
  return pdf.getPages().map(page => {
    const resources = page.node.Resources()!;
    if (!resources.has(PDFName.of('Font'))) return '';
    const dictionary = resources.lookup(PDFName.of('Font'), PDFDict);
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents!];
    return streams.map(ref => {
      const stream = pdf.context.lookup(ref) as PDFRawStream;
      const content = inflateSync(stream.contents).toString();
      let cmap = new Map<string, string>();
      const lines: string[] = [];
      for (const match of content.matchAll(/\/(\S+) [\d.]+ Tf|<([A-Fa-f0-9]+)> Tj/g)) {
        if (match[1]) {
          const resource = dictionary.lookup(PDFName.of(match[1]), PDFDict);
          const unicode = resource.lookup(PDFName.of('ToUnicode')) as PDFRawStream;
          cmap = new Map([...inflateSync(unicode.contents).toString().matchAll(/<([A-Fa-f0-9]{4})> <([A-Fa-f0-9]+)>/g)].map(m => [m[1].toUpperCase(), String.fromCharCode(...(m[2].match(/.{4}/g) ?? []).map(hex => parseInt(hex, 16)))]));
        } else {
          lines.push((match[2].match(/.{4}/g) ?? []).map(hex => cmap.get(hex.toUpperCase()) ?? '').join(''));
        }
      }
      return lines.join('\n');
    }).join('\n');
  }).join('\n');
}
it('renders selectable full legal text, Unicode, wrapped long words, certificates and attachments', async () => {
  const attachment = await PDFDocument.create();
  attachment.addPage([300, 400]);
  const bytes = await attachment.save();
  const text = 'José Ångström\n' + 'Longword'.repeat(200) + '\n' + Array.from({ length: 100 }, (_, i) => `Clause ${i}: preserve the exact words.`).join('\n');
  const sow = document('sow', 'Synthetic SOW\nNo missing terms.');
  sow.attachment_manifest_json = JSON.stringify([{ key: 'attachment', sha256: await hashBytes(bytes) }]);
  const env = { ASSETS: assets, AUDIO: { get: async () => ({ arrayBuffer: async () => bytes }) } } as unknown as Env;
  const result = await renderAgreementPacket(env, [document('msa', text), sow], [{}, { signatures: [{ verified_email: 'client@example.test', ip_address: '192.0.2.1', user_agent: 'Synthetic browser', receipt_id: 'receipt-2' }] }]);
  const pdf = await PDFDocument.load(result);
  const extracted = extract(pdf);
  expect(extracted.replace(/(?:Master Services Agreement|Statement of Work) · v2026-09-30/g, '').replace(/Page \d+ of \d+ \| website-pdf-v2/g, '').replace(/\s/g, '')).toContain(text.replace(/\s/g, ''));
  expect(extracted).toContain('client@example.test');
  expect(extracted).toContain('192.0.2.1');
  expect(extracted).toContain('Synthetic browser');
  expect(extracted).toContain('receipt-2');
  expect(pdf.getPages().at(-1)!.getSize()).toEqual({ width: 300, height: 400 });
  expect(pdf.getPageCount()).toBeGreaterThan(6);
});
it('imports the original executed MSA pages unchanged before the later SOW', async () => {
  const env = { ASSETS: assets } as unknown as Env;
  const original = await renderAgreementPacket(env, [document('msa', 'Original MSA')], [{ signatures: [{ receipt_id: 'original-receipt' }] }]);
  env.MUSIC_DB = { prepare: () => ({ bind: () => ({ first: async () => ({ pdf_key: 'original', pdf_sha256: await hashBytes(original) }) }) }) } as unknown as D1Database;
  env.AUDIO = { get: async () => ({ arrayBuffer: async () => original }) } as unknown as R2Bucket;
  const result = await renderAgreementPacket(env, [document('msa', 'Must not regenerate', 'previous'), document('sow', 'Later SOW')], [{}, { signatures: [{ receipt_id: 'later-receipt' }] }]);
  const pdf = await PDFDocument.load(result);
  const extracted = extract(pdf);
  expect(extracted).toContain('Original MSA');
  expect(extracted).toContain('original-receipt');
  expect(extracted).toContain('Later SOW');
  expect(extracted).not.toContain('Must not regenerate');
  expect(extracted.indexOf('original-receipt')).toBeLessThan(extracted.indexOf('Later SOW'));
});

it('preflights exact attachment merge inputs and rejects a missing original MSA before send', async () => {
  const terms: OfferTerms = { outcome:'Synthetic',summary:'Test',milestones:[{name:'One',deliverables:['View'],acceptance:['Open'],feeCents:101}],paymentMode:'standard',clientInputs:'',exclusions:'',timing:'' };
  const details = agreementDetailsSchema.parse({ planned_start:'2026-10-01',planned_end:'2026-10-20',environment:'Browser',operating_responsibilities:'Client',update_rhythm:'Weekly',milestones:[{start:'2026-10-01',target:'2026-10-20',handoff:'Source'}] });
  const contractor = contractorSchema.parse({legal_name:'Example LLC',entity_jurisdiction:'Wyoming LLC',signer_name:'Owner',signer_title:'Representative',notice_email:'owner@example.test',business_address:'Example business street',registered_agent_confirmed:true});
  const templates = (['msa','sow'] as const).map(kind => ({kind,version:1,text:templateFields[kind].filter(field=>!field.startsWith('milestone.')).map(field=>`${field}: {{${field}}}`).join('\n')+(kind==='sow'?'\n{{#milestones}}\n'+templateFields.sow.filter(field=>field.startsWith('milestone.')).map(field=>`${field}: {{${field}}}`).join('\n')+'\n{{/milestones}}':'')} as AgreementTemplate));
  const env = {ASSETS:assets,MUSIC_DB:{prepare:()=>({bind:()=>({first:async()=>null})})}} as unknown as Env;
  await expect(preflightAgreementPacket(env,terms,details,contractor,templates,null)).resolves.toBeUndefined();
  await expect(preflightAgreementPacket(env,terms,details,contractor,templates,'missing')).rejects.toThrow('Original MSA unavailable');
  details.attachments = [{filename:'Example.pdf',version:'1',date:'2026-10-01',key:'agreements/attachments/00000000-0000-4000-8000-000000000001.pdf',sha256:'a'.repeat(64),bytes:10}];
  env.AUDIO = {get:async()=>({arrayBuffer:async()=>new TextEncoder().encode('%PDF-broken')})} as unknown as R2Bucket;
  await expect(preflightAgreementPacket(env,terms,details,contractor,templates,null)).rejects.toThrow('Attachment hash mismatch');
}, 30000);

it('bundles exactly the licensed source font bytes', () => {
  for (const [name, encoded] of [['Inter-400', interBase64], ['Newsreader-400', newsreaderBase64]]) {
    expect(Buffer.from(encoded, 'base64')).toEqual(readFileSync(new URL(`../../src/assets/agreement-fonts/${name}.ttf`, import.meta.url)));
  }
});

it('formats PDF certificate dates in New York without changing source evidence', async () => {
  const certificate = { executed_at: '2026-09-30T13:15:43.382Z', effective_on: '2026-09-30', signatures: [{ signed_at: '2026-01-01T02:15:00Z' }] };
  const original = JSON.stringify(certificate);
  const pdf = await PDFDocument.load(await renderAgreementPacket({ ASSETS: assets } as unknown as Env, [document('sow', 'Exact retained agreement')], [certificate]));
  const text = extract(pdf).replace(/\s+/g, " ");
  expect(text).toContain('Sep 30, 2026, 9:15 AM EDT');
  expect(text).toContain('Dec 31, 2025, 9:15 PM EST');
  expect(text).not.toContain('2026-09-30T');
  expect(text).not.toContain('2026-09-30T13:15:43.382Z');
  expect(JSON.stringify(certificate)).toBe(original);
});

const sampleTemplateFile = new URL('../../scripts/screenshots/fixtures/sample-agreement-templates.json', import.meta.url);
async function checkTemplatePacket(templateFile: string | URL, headings: string[]) {
  const templates = JSON.parse(readFileSync(templateFile, 'utf8'));
  const terms: OfferTerms = { outcome:'Client tracker',summary:'One shared view',milestones:[{name:'Tracker',deliverables:['A shared view'],acceptance:['Add a client'],feeCents:240000}],paymentMode:'standard',clientInputs:'Synthetic sample',exclusions:'Production rollout',timing:'Agreed dates' };
  const details = agreementDetailsSchema.parse({ planned_start:'2026-10-01',planned_end:'2026-10-20',environment:'Browser prototype',operating_responsibilities:'Client',update_rhythm:'Weekly',milestones:[{start:'2026-10-01',target:'2026-10-20',handoff:'Source and notices'}] });
  const contractor = contractorSchema.parse({legal_name:'Example Contractor LLC',entity_jurisdiction:'Wyoming LLC',signer_name:'Example Owner',signer_title:'Representative',notice_email:'owner@example.com',business_address:'200 Example Business Street',registered_agent_confirmed:true});
  const client = { legal_name:'Example Client LLC',entity_type:'LLC',jurisdiction:'Wyoming',business_address:'100 Example Business Street',notice_email:'notices@example.com',signer_name:'Example Signer',signer_title:'Representative',reviewer_name:'Reviewer',reviewer_email:'reviewer@example.com',approver_name:'Approver',approver_email:'approver@example.com',portfolio:'deny' as const,naming:false };
  const values = agreementValues(terms, details, client, contractor, {effective_on:'2026-09-30',msa_version:'2026-09-30 / template 1',sow_number:'SOW-1',offer_version:1,template_version:1});
  const docs = (['msa','sow'] as const).map(kind => document(kind, renderAgreement(kind, templates[kind], values)));
  for (const doc of docs) doc.text_sha256 = await hashBytes(new TextEncoder().encode(doc.canonical_text));
  const certificates = docs.map(doc => ({document_id:doc.id,document_sha256:doc.text_sha256,effective_on:'2026-09-30',executed_at:'2026-09-30T13:25:00Z',versions:{template:1,offer:1,version_label:'v2026-09-30',source_revision:'private-source-revision'},signatures:['client','contractor'].map(party=>({party,typed_name:party==='client'?'Example Signer':'Example Owner',title:'Representative',verified_email:party==='client'?'signer@example.com':'owner@example.com',verified_at:'2026-09-30T13:23:00Z',consent_at:'2026-09-30T13:25:00Z',signed_at:'2026-09-30T13:25:00Z',ip_address:'192.0.2.1',user_agent:'Synthetic browser 🧪',consent_version:'website-signing-v2-'+party,consent_text:'Electronic records consent',intent_text:'Signature intent for '+party}))}));
  const pdf = await PDFDocument.load(await renderAgreementPacket({} as Env, docs, certificates));
  const text = extract(pdf).replace(/\s+/g,' ');
  for (const expected of [...headings,'Example Client LLC','Client tracker','Signed electronically by Example Signer, Representative, on Sep 30, 2026, 9:25 AM EDT']) expect(text).toContain(expected);
  expect(text).not.toContain('client.legal_name:');
  expect(text).not.toContain('{{');
  const certificateText = text.slice(text.indexOf('Signing certificate'));
  for (const label of ['Party','Typed name','Title','Verified email','Verified at (New York)','Consent at (New York)','Signed at (New York)','IP address','Browser','Documents','Agreement version','Consent version','SHA-256']) expect(certificateText).toContain(label);
  expect(text).toContain('v2026-09-30');
  expect(text).not.toContain('Template v1');
  expect(text).not.toContain('Template version');
  expect(text).not.toContain('Source revision');
  expect(text).not.toContain('private-source-revision');
  for (const party of ['client','contractor']) expect(certificateText).toContain('website-signing-v2-'+party);
  expect(certificateText).toContain('Agreement version v2026-09-30');
  expect(certificateText).not.toMatch(/[{}]/);
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const file = names.lookup(1, PDFDict).lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F')) as PDFRawStream;
  expect(inflateSync(file.contents).toString()).toBe(canonicalJson(certificates));
  expect(certificates[0].signatures[0].user_agent).toBe('Synthetic browser 🧪');
}
it('renders supplied or fictional agreements and embeds exact signing evidence', async () => {
  await checkTemplatePacket(process.env.AGREEMENT_TEMPLATE_FILE ?? sampleTemplateFile,
    process.env.AGREEMENT_TEMPLATE_FILE ? [] : ['Sample Master Services Agreement', 'Sample Statement of Work', '2 Sample review list', '4 Sample signature records']);
}, 30000);

// Real clauses stay private; this additional local coverage is optional.
const privateTemplateFile = '.private/signing/templates.json';
it.runIf(existsSync(privateTemplateFile))('renders the real v1 agreements and embeds exact signing evidence', async () => {
  await checkTemplatePacket(privateTemplateFile, ['1 Parties and scope', '14 Signatures', '1 Engagement details', '9 Exceptions attachments and signatures']);
}, 30000);

it('preserves heading characters absent from Newsreader using Inter', async () => {
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  const heading = fontkit.create(Buffer.from(newsreaderBase64,'base64'));
  const inter = fontkit.create(Buffer.from(interBase64,'base64'));
  const character = String.fromCodePoint(inter.characterSet.find((point:number)=>point>1024 && !heading.characterSet.includes(point))!);
  const text = '1 Client '+character;
  const pdf = await PDFDocument.load(await renderAgreementPacket({} as Env,[document('sow',text)],[{}]));
  expect(extract(pdf)).toContain('Client '+character);
});
