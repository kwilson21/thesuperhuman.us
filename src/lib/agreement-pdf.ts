import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import interBase64 from '~/assets/agreement-fonts/Inter-400.base64?raw';
import newsreaderBase64 from '~/assets/agreement-fonts/Newsreader-400.base64?raw';
import type { Agreement } from './software-agreements';
import { canonicalJson, hashBytes } from './agreement-artifacts';
import { agreementValues, type AgreementDetails, type ClientAgreement, contractorSchema } from './agreement-fields';
import type { OfferTerms } from './software-offers';
import type { AgreementTemplate } from './agreement-templates';
import { renderAgreement, agreementCertificateText } from './agreement-templates';
function fontBytes(base64: string) {
  // Raw base64 imports bundle the licensed bytes; no asset binding or filesystem.
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  const widths = new Map<string, number>();
  const measure = (value: string) => {
    const cached = widths.get(value);
    if (cached !== undefined) return cached;
    const measured = font.widthOfTextAtSize(value, size);
    widths.set(value, measured);
    return measured;
  };
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (measure(line + (line ? ' ' : '') + word) <= width) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const char of word) {
        if (measure(line + char) > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
export async function renderAgreementPacket(
  env: Env,
  documents: Agreement[],
  certificates: unknown[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const inter = await pdf.embedFont(fontBytes(interBase64)),
    heading = await pdf.embedFont(fontBytes(newsreaderBase64));
  const supported = new Set(inter.getCharacterSet());
  const text = (value: string) => {
    for (const char of value)
      if (!['\n', '\r', '\t'].includes(char) && !supported.has(char.codePointAt(0)!))
        throw new Error('Unsupported character. Arrange outside-site signing.');
    return value;
  };
  let page = pdf.addPage([612, 792]),
    y = 750,
    importedPages = 0;
  const add = (value: string, title = false) => {
    const font = title ? heading : inter,
      size = title ? 18 : 10.5,
      lines = wrap(text(value), font, size, 528);
    if (title && y < 90) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    for (const line of lines) {
      if (y < 57) {
        page = pdf.addPage([612, 792]);
        y = 750;
      }
      page.drawText(line, { x: 42, y, size, font });
      y -= title ? 24 : 15;
    }
    y -= 6;
  };
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (
      i === 0 &&
      doc.kind === 'msa' &&
      documents.length > 1 &&
      doc.offer_id !== documents[documents.length - 1].offer_id
    ) {
      const artifact = await env
        .MUSIC_DB!.prepare(
          "SELECT pdf_key,pdf_sha256 FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'",
        )
        .bind(doc.id)
        .first<{ pdf_key: string; pdf_sha256: string }>();
      if (!artifact) throw new Error('Original signed MSA copy unavailable.');
      const object = await env.AUDIO.get(artifact.pdf_key);
      if (!object) throw new Error('Original signed MSA unavailable.');
      const bytes = await object.arrayBuffer();
      if ((await hashBytes(bytes)) !== artifact.pdf_sha256)
        throw new Error('Original MSA hash mismatch.');
      const original = await PDFDocument.load(bytes);
      pdf.removePage(0);
      importedPages = original.getPageCount();
      for (const originalPage of await pdf.copyPages(original, original.getPageIndices()))
        pdf.addPage(originalPage);
      continue;
    }
    if (i) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    add(doc.kind === 'msa' ? 'Master Services Agreement' : 'Statement of Work', true);
    add(doc.canonical_text);
    page = pdf.addPage([612, 792]);
    y = 750;
    add('Signing certificate', true);
    add(
      'This certificate records electronic signatures. It is not an identity certification or a PKI digital seal.',
    );
    add('Unsupported browser evidence characters use lossless JSON Unicode escapes.');
    add(agreementCertificateText(canonicalJson(certificates[i])));
  }
  const renderedEnd = pdf.getPageCount();
  const attachments = JSON.parse(documents[documents.length - 1].attachment_manifest_json) as {
    key: string;
    sha256: string;
  }[];
  for (const attachment of attachments) {
    const object = await env.AUDIO.get(attachment.key);
    if (!object) throw new Error('Missing attachment.');
    const bytes = await object.arrayBuffer();
    if ((await hashBytes(bytes)) !== attachment.sha256)
      throw new Error('Attachment hash mismatch.');
    const source = await PDFDocument.load(bytes);
    for (const page of await pdf.copyPages(source, source.getPageIndices())) pdf.addPage(page);
  }
  pdf.getPages().forEach((p: PDFPage, i: number) => {
    if (i < importedPages || i >= renderedEnd) return;
    p.drawText(`Page ${i + 1} of ${pdf.getPageCount()} | website-pdf-v1`, {
      x: 42,
      y: 30,
      font: inter,
      size: 8,
    });
  });
  return pdf.save();
}

/** Validate the actual merge inputs before sending. Reserve space for bounded signer evidence. */
export async function preflightAgreementPacket(env: Env, terms: OfferTerms, details: AgreementDetails,
  contractor: ReturnType<typeof contractorSchema.parse>, templates: AgreementTemplate[], reusedMsaId: string | null) {
  const client: ClientAgreement = {
    business_engagement: true, legal_name: 'W'.repeat(200), entity_type: 'W'.repeat(200),
    jurisdiction: 'W'.repeat(100), business_address: 'W'.repeat(1000), notice_email: 'sample@example.test',
    reviewer_name: 'W'.repeat(200), reviewer_email: 'sample@example.test', approver_name: 'W'.repeat(200),
    approver_email: 'sample@example.test', signer_name: 'W'.repeat(200), signer_title: 'W'.repeat(200),
    portfolio: 'deny', naming: false, initials: 'W'.repeat(20),
  };
  const documents: Agreement[] = templates.map(template => {
    const values = agreementValues(terms, details, client, contractor, {
      effective_on: details.planned_start, msa_version: `${details.planned_start} / template ${templates[0].version}`, sow_number: 'SOW-preflight',
      offer_version: 1, template_version: template.version,
    });
    return { id: 'preflight', kind: template.kind, offer_id: 'preflight',
      canonical_text: renderAgreement(template.kind, template.text, values),
      attachment_manifest_json: JSON.stringify(template.kind === 'sow' ? details.attachments : []),
    } as Agreement;
  });
  if (reusedMsaId) {
    const original = await env.MUSIC_DB!.prepare("SELECT * FROM software_agreements WHERE id=? AND status='executed' AND archive_closed_at IS NULL").bind(reusedMsaId).first<Agreement>();
    if (!original) throw new Error('Original MSA unavailable.');
    documents[0] = original;
  }
  const packet = await renderAgreementPacket(env, documents, documents.map(() => ({ evidence: Array(16).fill('W'.repeat(1024)).join('\n') })));
  if (packet.length + 1024 * 1024 > 25 * 1024 * 1024) throw new Error('Complete packet exceeds the copy limit.');
}
