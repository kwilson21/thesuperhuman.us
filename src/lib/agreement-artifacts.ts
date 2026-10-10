import { hashOfferToken } from './software-offers';
import { sendAudioMessage } from './audio-resend';
import type { Agreement } from './software-agreements';
export const hashBytes = async (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export type AgreementArtifact = {
  status: string;
  attempt_id: string | null;
  pdf_key: string | null;
  pdf_sha256: string | null;
  bytes: number | null;
  certificate_key: string | null;
};
export const newYorkTime = (value: unknown) =>
  typeof value === 'string'
    ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })
    : null;
/** Signatures persist first. Artifact retries never create a signature. */
export async function prepareAgreementArtifact(
  env: Env,
  id: string,
  render: (env: Env, documents: Agreement[], certificates: unknown[]) => Promise<Uint8Array>,
) {
  const db = env.MUSIC_DB!;
  if (!env.AUDIO) throw new Error('Storage unavailable.');
  const attempt = crypto.randomUUID(),
    at = new Date().toISOString();
  const claimed = await db
    .prepare(
      "UPDATE software_agreement_artifacts SET status='rendering',attempt_id=?,attempted_at=?,error_code=NULL WHERE agreement_id=? AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_artifacts.agreement_id AND a.archive_closed_at IS NULL) RETURNING agreement_id",
    )
    .bind(attempt, at, id)
    .first();
  if (!claimed) return;
  let errorCode = 'render';
  try {
    const agreement = await db
      .prepare("SELECT * FROM software_agreements WHERE id=? AND status='executed'")
      .bind(id)
      .first<Agreement>();
    if (!agreement) throw new Error('Not executed.');
    const documents: Agreement[] = [];
    if (agreement.msa_id) {
      const msa = await db
        .prepare("SELECT * FROM software_agreements WHERE id=? AND status='executed'")
        .bind(agreement.msa_id)
        .first<Agreement>();
      if (!msa) throw new Error('Missing MSA.');
      documents.push(msa);
    }
    documents.push(agreement);
    const certificates = await Promise.all(
      documents.map(async (d) => ({
        document_id: d.id,
        document_sha256: d.text_sha256,
        template_id: d.template_id,
        offer_id: d.offer_id,
        effective_on: d.effective_on,
        executed_at: d.executed_at,
        renderer_version: 'website-pdf-v2',
        versions: {
          template:
            d.kind === 'msa'
              ? JSON.parse(d.values_json).msa?.template_version
              : JSON.parse(d.values_json).system?.template_version,
          offer: JSON.parse(d.values_json).sow?.version,
          contractor_config: JSON.parse(d.values_json).contractor.config_version,
          source_revision: JSON.parse(d.values_json).msa?.source_revision,
          version_label: JSON.parse(d.values_json).msa?.version_label,
        },
        attachments: JSON.parse(d.attachment_manifest_json),
        signatures: (
          await db
            .prepare(
              'SELECT party,typed_name,title,consent_text,consent_version,consent_at,signed_at,document_sha256,owner_subject,verified_email,verified_at,verification_method,intent_text,document_list_json,receipt_id,ip_address,user_agent FROM software_agreement_signatures WHERE agreement_id=? ORDER BY party',
            )
            .bind(d.id)
            .all()
        ).results,
      })),
    );
    if (certificates.some((c) => c.signatures.length !== 2)) throw new Error('Missing signature.');
    const displayCertificates = certificates.map((c) => ({
      ...c,
      executed_at_new_york: newYorkTime(c.executed_at),
      signatures: c.signatures.map((s) => ({
        ...s,
        signed_at_new_york: newYorkTime(s.signed_at),
        verified_at_new_york: newYorkTime(s.verified_at),
      })),
    }));
    const certificate = canonicalJson(displayCertificates),
      certificateHash = await hashOfferToken(certificate),
      key = `agreements/${id}/${certificateHash}.pdf`,
      certificateKey = `agreements/${id}/${certificateHash}.certificate.json`;
    const existing = await env.AUDIO.get(key),
      bytes = existing
        ? new Uint8Array(await existing.arrayBuffer())
        : await render(env, documents, displayCertificates);
    if (existing && existing.customMetadata?.sha256 !== (await hashBytes(bytes)))
      throw new Error('Stored packet hash mismatch.');
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Packet exceeds 25 MiB.');
    const pdfHash = await hashBytes(bytes),
      manifest = canonicalJson({
        documents: documents.map((d) => ({ id: d.id, sha256: d.text_sha256 })),
        certificate_sha256: certificateHash,
        pdf_sha256: pdfHash,
        renderer_version: 'website-pdf-v2',
      });
    errorCode = 'storage';
    if (!existing)
      await env.AUDIO.put(key, bytes, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { sha256: pdfHash },
      });
    await env.AUDIO.put(certificateKey, certificate, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sha256: certificateHash },
    });
    await env.AUDIO.put(`agreements/${id}/${certificateHash}.manifest.json`, manifest);
    for (const d of documents)
      await env.AUDIO.put(`agreements/${d.id}/${d.text_sha256}.txt`, d.canonical_text);
    errorCode = 'readback';
    const readback = await env.AUDIO.get(key),
      certReadback = await env.AUDIO.get(certificateKey);
    if (
      !readback ||
      (await hashBytes(await readback.arrayBuffer())) !== pdfHash ||
      !certReadback ||
      (await hashBytes(await certReadback.arrayBuffer())) !== certificateHash
    )
      throw new Error('Readback mismatch.');
    await db.batch([
      db.prepare(
        "UPDATE software_agreement_artifacts SET status='ready',pdf_key=?,pdf_sha256=?,certificate_key=?,certificate_sha256=?,manifest_json=?,bytes=?,renderer_version='website-pdf-v2',ready_at=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'",
      )
      .bind(
        key,
        pdfHash,
        certificateKey,
        certificateHash,
        manifest,
        bytes.length,
        new Date().toISOString(),
        id,
        attempt,
      )
,
      db.prepare("INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,'artifact-ready','system',? WHERE EXISTS(SELECT 1 FROM software_agreement_artifacts WHERE agreement_id=? AND attempt_id=? AND status='ready')")
        .bind(crypto.randomUUID(),id,new Date().toISOString(),id,attempt),
    ]);
  } catch (error) {
    // No error object/stack, document, certificate, request or signer fields.
    // JSON parser messages can include input excerpts, so do not log those.
    console.error('Agreement artifact preparation failed:',
      error instanceof Error ? error.name : 'UnknownError',
      error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Unknown failure.');
    await db
      .prepare(
        "UPDATE software_agreement_artifacts SET status='failed',error_code=? WHERE agreement_id=? AND attempt_id=? AND status='rendering'",
      )
      .bind(errorCode, id, attempt)
      .run();
  }
}
function base64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function deliverAgreementCopies(env: Env, id: string) {
  const db = env.MUSIC_DB!;
  const artifact = await db
    .prepare("SELECT * FROM software_agreement_artifacts WHERE agreement_id=? AND status='ready'")
    .bind(id)
    .first<AgreementArtifact>();
  if (!artifact?.pdf_key || !env.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL || !env.AUDIO) return;
  const object = await env.AUDIO.get(artifact.pdf_key);
  if (!object || object.size > 25 * 1024 * 1024) return;
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await hashBytes(bytes)) !== artifact.pdf_sha256) return;
  for (const role of ['client', 'contractor']) {
    const attempt = crypto.randomUUID(),
      at = new Date().toISOString();
    const claim = await db
      .prepare(
        "UPDATE software_agreement_deliveries SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND recipient_role=? AND status='pending' AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_deliveries.agreement_id AND a.archive_closed_at IS NULL) RETURNING email",
      )
      .bind(attempt, at, id, role)
      .first<{ email: string }>();
    if (!claim) continue;
    const sent = await sendAudioMessage({
      apiKey: env.RESEND_API_KEY,
      idempotencyKey: `agreement-${id}-${role}-${artifact.pdf_sha256}`,
      payload: {
        from: env.CONTACT_FROM_EMAIL,
        to: [claim.email],
        subject: 'Your signed agreement',
        text: `Both signatures are saved. A complete signed PDF is attached. Keep this copy. Your agreement archive: ${new URL('/agreements', env.SITE_ORIGIN ?? 'https://thesuperhuman.us').href}\nReceipt: ${id}\nEmail acceptance is not proof of inbox receipt.`,
        attachments: [{ filename: 'signed-agreement.pdf', content: base64(bytes) }],
      },
    });
    if (!sent.uncertain)
      await db.batch([db.prepare(
          "UPDATE software_agreement_deliveries SET status=?,sent_at=? WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status='sending'",
        )
        .bind(
          sent.ok ? 'sent' : 'failed',
          sent.ok ? new Date().toISOString() : null,
          id,
          role,
          attempt,
        )
,
        db.prepare("INSERT INTO software_agreement_events(id,agreement_id,action,actor,occurred_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_deliveries WHERE agreement_id=? AND recipient_role=? AND attempt_id=? AND status=?)")
          .bind(crypto.randomUUID(),id,sent.ok?'copy-delivered':'delivery-failed',role,new Date().toISOString(),id,role,attempt,sent.ok?'sent':'failed'),
      ]);
  }
}

export async function recoverAgreementRendering(
  db: D1Database,
  id: string,
  expectedAttempt: string,
  confirmed: boolean,
) {
  if (!confirmed) return false;
  return Boolean(
    await db
      .prepare(
        "UPDATE software_agreement_artifacts SET status='failed',error_code='render' WHERE agreement_id=? AND status='rendering' AND attempt_id=? AND attempted_at<=? RETURNING agreement_id",
      )
      .bind(id, expectedAttempt, new Date(Date.now() - 60000).toISOString())
      .first(),
  );
}
export async function deliverAgreementNotifications(env: Env, id: string) {
  if (!env.MUSIC_DB || !env.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL) return;
  const agreement = await env.MUSIC_DB.prepare(
    "SELECT request_id,(SELECT receipt_id FROM software_agreement_signatures WHERE agreement_id=software_agreements.id AND party='client') AS receipt_id FROM software_agreements WHERE id=?",
  )
    .bind(id)
    .first<{ request_id: string; receipt_id: string }>();
  if (!agreement) return;
  for (const kind of ['signature-receipt', 'countersign-notice']) {
    const attempt = crypto.randomUUID(),
      at = new Date().toISOString();
    const claim = await env.MUSIC_DB.prepare(
      "UPDATE software_agreement_notifications SET status='sending',attempt_id=?,attempted_at=? WHERE agreement_id=? AND kind=? AND status='pending' AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=software_agreement_notifications.agreement_id AND a.archive_closed_at IS NULL) RETURNING email",
    )
      .bind(attempt, at, id, kind)
      .first<{ email: string }>();
    if (!claim) continue;
    const sent = await sendAudioMessage({
      apiKey: env.RESEND_API_KEY,
      idempotencyKey: `agreement-${id}-${kind}`,
      payload: {
        from: env.CONTACT_FROM_EMAIL,
        to: [claim.email],
        subject:
          kind === 'signature-receipt'
            ? 'Your signature is saved'
            : 'Agreement ready for countersignature',
        text:
          kind === 'signature-receipt'
            ? `Your signature is saved. Waiting for Kazon to countersign. The project has not started. Receipt: ${agreement.receipt_id}`
            : `A client signature is saved. Review the exact agreement before countersigning: ${new URL(`/owner/requests/${agreement.request_id}`, env.SITE_ORIGIN ?? 'https://thesuperhuman.us').href}`,
      },
    });
    if (!sent.uncertain)
      await env.MUSIC_DB.prepare(
        "UPDATE software_agreement_notifications SET status=?,sent_at=? WHERE agreement_id=? AND kind=? AND attempt_id=? AND status='sending'",
      )
        .bind(
          sent.ok ? 'sent' : 'failed',
          sent.ok ? new Date().toISOString() : null,
          id,
          kind,
          attempt,
        )
        .run();
  }
}
