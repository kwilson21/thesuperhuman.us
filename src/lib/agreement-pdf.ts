import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import interBase64 from '~/assets/agreement-fonts/Inter-400.base64?raw';
import newsreaderBase64 from '~/assets/agreement-fonts/Newsreader-400.base64?raw';
import type { Agreement } from './software-agreements';
import { canonicalJson, hashBytes, newYorkTime } from './agreement-artifacts';
import {
  agreementValues,
  agreementVersionLabel,
  type AgreementDetails,
  type ClientAgreement,
  contractorSchema,
  signatureReference,
} from './agreement-fields';
import { softwareDate } from './software-projects';
import type { OfferTerms } from './software-offers';
import type { AgreementTemplate } from './agreement-templates';
import {
  renderAgreement,
  agreementCharacterSupported,
} from './agreement-templates';
function fontBytes(base64: string) {
  // Raw base64 imports bundle the licensed bytes; no asset binding or filesystem.
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
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
      if (
        !['\n', '\r', '\t'].includes(char) &&
        !supported.has(char.codePointAt(0)!)
      )
        throw new Error('Unsupported character. Arrange outside-site signing.');
    return value;
  };
  let page = pdf.addPage([612, 792]),
    y = 720,
    importedPages = 0;
  const add = (value: string, title = false) => {
    const font = title ? heading : inter,
      size = title ? 18 : 11,
      lines = wrap(text(value), font, size, 516);
    if (title && y < 90) {
      page = pdf.addPage([612, 792]);
      y = 720;
    }
    for (const line of lines) {
      if (y < 57) {
        page = pdf.addPage([612, 792]);
        y = 720;
      }
      page.drawText(line, { x: 48, y, size, font });
      y -= title ? 25 : 16;
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
      for (const originalPage of await pdf.copyPages(
        original,
        original.getPageIndices(),
      ))
        pdf.addPage(originalPage);
      continue;
    }
    if (i) {
      page = pdf.addPage([612, 792]);
      y = 720;
    }
    const certificate = certificates[i] as Record<string, unknown>;
    const signatures = (certificate.signatures ?? []) as Record<
      string,
      unknown
    >[];
    const title =
      doc.kind === 'msa' ? 'Master Services Agreement' : 'Statement of Work';
    const versions = (certificate.versions ?? {}) as Record<string, unknown>;
    const start = pdf.getPageCount() - 1;
    // Retain the exact reviewed text. Only the signature-reference placeholders
    // become the recorded signatures; canonical text and its hash stay unchanged.
    let agreementText = doc.canonical_text;
    for (const party of ['contractor', 'client']) {
      const signer = signatures.find((s) => s.party === party);
      if (!signer) continue; // Preflight has no signatures yet.
      const reference = signatureReference;
      const record = `Signed electronically by ${signer.typed_name}, ${signer.title}, on ${newYorkTime(signer.signed_at)}; see signing certificate.`;
      agreementText = agreementText
        .replaceAll(
          `${party === 'client' ? 'Client' : 'Contractor'} signature: ${reference}`,
          `${party === 'client' ? 'Client' : 'Contractor'} signature: ${record}`,
        )
        .replaceAll(
          `${party === 'client' ? 'Client' : 'Contractor'} signing date: ${reference}`,
          `${party === 'client' ? 'Client' : 'Contractor'} signing date: ${newYorkTime(signer.signed_at)}`,
        );
    }
    for (const line of agreementText.split('\n'))
      add(line, line === title || /^\d+ [A-Z]|^Milestone \d+$/.test(line));
    for (const p of pdf.getPages().slice(start))
      p.drawText(`${title} · ${versions.version_label ?? agreementVersionLabel}`, {
        x: 48,
        y: 755,
        font: inter,
        size: 9,
      });
    if (i < documents.length - 1) continue;
    page = pdf.addPage([612, 792]);
    y = 720;
    add('Signing certificate', true);
    add(
      'This record associates electronic signatures with the exact documents listed below. It is not an identity certification or a PKI digital seal.',
    );
    // Unsupported browser characters are escaped only for display, never in evidence.
    const display = (value: unknown) =>
      [...String(value ?? 'Not recorded')]
        .map((char) =>
          agreementCharacterSupported(char)
            ? char
            : char
                .split('')
                .map(
                  (unit) =>
                    `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
                )
                .join(''),
        )
        .join('');
    const row = (label: string, value: unknown) => {
      const lines = wrap(text(display(value)), inter, 10, 370);
      if (y - lines.length * 15 < 57) {
        page = pdf.addPage([612, 792]);
        y = 720;
      }
      page.drawText(label, { x: 48, y, font: inter, size: 10 });
      for (const line of lines) {
        if (y < 57) {
          page = pdf.addPage([612, 792]);
          y = 720;
        }
        page.drawText(line, { x: 194, y, font: inter, size: 10 });
        y -= 15;
      }
      y -= 5;
    };
    row('Document ID', certificate.document_id ?? doc.id);
    row(
      'Effective date',
      certificate.effective_on
        ? softwareDate(String(certificate.effective_on))
        : null,
    );
    row('Executed at (New York)', newYorkTime(certificate.executed_at));
    for (const signer of signatures) {
      add(
        `${signer.party === 'client' ? 'Client' : 'Contractor'} signature`,
        true,
      );
      for (const [label, key] of [
        ['Party', 'party'],
        ['Typed name', 'typed_name'],
        ['Title', 'title'],
        ['Verified email', 'verified_email'],
        ['Verification method', 'verification_method'],
        ['Verified at (New York)', 'verified_at'],
        ['Consent version', 'consent_version'],
        ['Consent at (New York)', 'consent_at'],
        ['Signed at (New York)', 'signed_at'],
        ['IP address', 'ip_address'],
        ['Browser', 'user_agent'],
        ['Receipt', 'receipt_id'],
      ])
        row(
          label,
          key.endsWith('_at') ? newYorkTime(signer[key]) : signer[key],
        );
    }
    add('Electronic consent and intent', true);
    for (const key of ['consent_text', 'intent_text'])
      for (const statement of new Set(
        signatures.map((s) => s[key]).filter(Boolean),
      ))
        add(display(statement));
    add('Documents', true);
    for (let j = 0; j < documents.length; j++) {
      const d = documents[j],
        c = certificates[j] as Record<string, unknown>;
      row(
        'Title',
        d.kind === 'msa' ? 'Master Services Agreement' : 'Statement of Work',
      );
      row(
        'Agreement version',
        (c.versions as Record<string, unknown> | undefined)?.version_label ??
          agreementVersionLabel,
      );
      row(
        'Offer version',
        (c.versions as Record<string, unknown> | undefined)?.offer,
      );
      row('SHA-256', d.text_sha256 ?? c.document_sha256);
    }
    const attachments = (certificate.attachments ?? []) as Record<
      string,
      unknown
    >[];
    for (const attachment of attachments) {
      row('Attachment', attachment.filename);
      row('Version', attachment.version);
      row('SHA-256', attachment.sha256);
    }
  }
  const renderedEnd = pdf.getPageCount();
  const attachments = JSON.parse(
    documents[documents.length - 1].attachment_manifest_json,
  ) as {
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
    for (const page of await pdf.copyPages(source, source.getPageIndices()))
      pdf.addPage(page);
  }
  pdf.getPages().forEach((p: PDFPage, i: number) => {
    if (i < importedPages || i >= renderedEnd) return;
    p.drawText(`Page ${i + 1} of ${pdf.getPageCount()} | website-pdf-v2`, {
      x: 42,
      y: 30,
      font: inter,
      size: 8,
    });
  });
  await pdf.attach(
    new TextEncoder().encode(canonicalJson(certificates)),
    'signing-record.json',
    {
      mimeType: 'application/json',
      description: 'Canonical signing evidence for this packet',
    },
  );
  return pdf.save();
}

/** Validate the actual merge inputs before sending. Reserve space for bounded signer evidence. */
export async function preflightAgreementPacket(env: Env, terms: OfferTerms, details: AgreementDetails,
  contractor: ReturnType<typeof contractorSchema.parse>, templates: AgreementTemplate[], reusedMsaId: string | null) {
  const client: ClientAgreement = {
    legal_name: 'W'.repeat(200), entity_type: 'W'.repeat(200),
    jurisdiction: 'W'.repeat(100), business_address: 'W'.repeat(1000), notice_email: 'sample@example.test',
    reviewer_name: 'W'.repeat(200), reviewer_email: 'sample@example.test', approver_name: 'W'.repeat(200),
    approver_email: 'sample@example.test', signer_name: 'W'.repeat(200), signer_title: 'W'.repeat(200),
    portfolio: 'deny', naming: false,
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
  const packet = await renderAgreementPacket(env, documents, documents.map(() => ({ signatures: ['client', 'contractor'].map(party => ({
    party, typed_name: 'W'.repeat(200), title: 'W'.repeat(200), verified_email: 'W'.repeat(254),
    ip_address: 'W'.repeat(100), user_agent: 'W'.repeat(2000), signed_at: '2026-09-30T13:25:00Z',
    consent_at: '2026-09-30T13:25:00Z', verified_at: '2026-09-30T13:25:00Z',
  })) })));
  if (packet.length + 1024 * 1024 > 25 * 1024 * 1024) throw new Error('Complete packet exceeds the copy limit.');
}
