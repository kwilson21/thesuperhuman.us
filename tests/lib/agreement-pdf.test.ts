import { agreementDetailsSchema, contractorSchema } from '~/lib/agreement-fields';
import { templateFields, type AgreementTemplate } from '~/lib/agreement-templates';
import type { OfferTerms } from '~/lib/software-offers';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { preflightAgreementPacket, renderAgreementPacket } from '~/lib/agreement-pdf';
import { hashBytes } from '~/lib/agreement-artifacts';
import type { Agreement } from '~/lib/software-agreements';

const assets = { fetch: async (request: Request) => new Response(readFileSync(new URL(request.url).pathname.slice(1))) };
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
  const result = await renderAgreementPacket(env, [document('msa', text), sow], [{ verified_email: 'client@example.test', ip_address: '192.0.2.1', user_agent: 'Synthetic browser' }, { receipt_id: 'receipt-2' }]);
  const pdf = await PDFDocument.load(result);
  const extracted = extract(pdf);
  expect(extracted.replace(/Page \d+ of \d+ \| website-pdf-v1/g, '').replace(/\s/g, '')).toContain(text.replace(/\s/g, ''));
  expect(extracted).toContain('client@example.test');
  expect(extracted).toContain('192.0.2.1');
  expect(extracted).toContain('Synthetic browser');
  expect(extracted).toContain('receipt-2');
  expect(pdf.getPages().at(-1)!.getSize()).toEqual({ width: 300, height: 400 });
  expect(pdf.getPageCount()).toBeGreaterThan(6);
});
it('imports the original executed MSA pages unchanged before the later SOW', async () => {
  const env = { ASSETS: assets } as unknown as Env;
  const original = await renderAgreementPacket(env, [document('msa', 'Original MSA')], [{ receipt_id: 'original-receipt' }]);
  env.MUSIC_DB = { prepare: () => ({ bind: () => ({ first: async () => ({ pdf_key: 'original', pdf_sha256: await hashBytes(original) }) }) }) } as unknown as D1Database;
  env.AUDIO = { get: async () => ({ arrayBuffer: async () => original }) } as unknown as R2Bucket;
  const result = await renderAgreementPacket(env, [document('msa', 'Must not regenerate', 'previous'), document('sow', 'Later SOW')], [{}, { receipt_id: 'later-receipt' }]);
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
