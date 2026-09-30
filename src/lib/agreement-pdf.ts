import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import interUrl from '~/assets/agreement-fonts/Inter-400.ttf?url';
import newsreaderUrl from '~/assets/agreement-fonts/Newsreader-400.ttf?url';
import type { Agreement } from './software-agreements';
import { canonicalJson, hashBytes } from './agreement-artifacts';
import { agreementCertificateText } from './agreement-templates';
async function fontBytes(env: Env, url: string) {
  // Static deploy assets only. No external font request or client-controlled URL.
  const response = await env.ASSETS.fetch(new Request(new URL(url, 'https://assets.invalid')));
  if (!response.ok) throw new Error('Font asset unavailable.');
  return response.arrayBuffer();
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (font.widthOfTextAtSize(line + (line ? ' ' : '') + word, size) <= width) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width) {
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
  const inter = await pdf.embedFont(await fontBytes(env, interUrl)),
    heading = await pdf.embedFont(await fontBytes(env, newsreaderUrl));
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
