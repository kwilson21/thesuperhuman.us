import { agreementEvent } from './agreement-events';
import { hashOfferToken, offerTermsSchema, type SoftwareOffer } from './software-offers';
import { softwareGuard } from './software-projects';
import {
  agreementValues,
  validateAgreementDetails,
  clientAgreementSchema,
  contractorSchema,
  consentText,
  authorityText,
  intentText,
} from './agreement-fields';
import {
  renderAgreement,
  validateAgreementCharacters,
  type AgreementTemplate,
} from './agreement-templates';
import { liveSigningGuard, type AgreementSession } from './agreement-access';
import casefold from './agreement-casefold.json';
export const legalNameKey = (value: string) =>
  [...value.trim().normalize('NFC')]
    .map((c) => (casefold.mapping as Record<string, string>)[c] ?? c.toLowerCase())
    .join('');
export function abandonUnsignedAgreementReviews(db: D1Database, requestId: string, at: string) {
  return db
    .prepare(
      "UPDATE software_agreements SET status='abandoned',abandoned_at=?,abandoned_reason='Offer link changed',ended_at=?,retain_until=? WHERE request_id=? AND status='review'",
    )
    .bind(at, at, new Date(Date.parse(at) + 90 * 86400000).toISOString(), requestId);
}
export type Agreement = {
  id: string;
  kind: 'msa' | 'sow';
  offer_id: string;
  request_id: string;
  client_id: string;
  template_id: string;
  msa_id: string | null;
  status: 'review' | 'client_signed' | 'executed' | 'abandoned';
  canonical_text: string;
  text_sha256: string;
  values_json: string;
  effective_on: string;
  executed_at: string | null;
  review_session_hash: string;
  attachment_manifest_json: string;
  terminated_at: string | null;
};
export async function offerAgreements(db: D1Database, id: string) {
  return (
    await db
      .prepare(
        "SELECT * FROM software_agreements WHERE offer_id=? AND status<>'abandoned' ORDER BY kind",
      )
      .bind(id)
      .all<Agreement>()
  ).results;
}
export function sessionGuard(db: D1Database, s: AgreementSession) {
  return softwareGuard(
    db,
    'SELECT 1 FROM software_agreement_sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL',
    [s.token_hash, new Date().toISOString()],
  );
}
export async function reviewAgreements(
  db: D1Database,
  offer: SoftwareOffer,
  session: AgreementSession,
  input: unknown,
) {
  const client = clientAgreementSchema.parse(input),
    terms = offerTermsSchema.parse(JSON.parse(offer.terms_json)),
    details = validateAgreementDetails(JSON.parse(offer.agreement_details_json!), terms),
    contractor = contractorSchema.parse(
      (({ config_version, ...values }) => values)(JSON.parse(offer.contractor_snapshot_json!)),
    );
  const existing = await offerAgreements(db, offer.id);
  if (existing.some((a) => a.status !== 'review'))
    throw new Error('A signature is already saved. These documents cannot change.');
  const replacedClientIds = [...new Set(existing.map((agreement) => agreement.client_id))];
  const at = new Date().toISOString(),
    effective = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const identity = {
    ...client,
    recipient_email: session.recipient_email,
    legal_name_key: legalNameKey(client.legal_name),
  };
  const previous = await db
    .prepare(
      'SELECT id FROM software_agreement_clients WHERE recipient_email=? AND legal_name_key=? AND entity_type=? AND jurisdiction=?',
    )
    .bind(
      identity.recipient_email,
      identity.legal_name_key,
      client.entity_type,
      client.jurisdiction,
    )
    .first<{ id: string }>();
  const clientId = previous?.id ?? crypto.randomUUID();
  const reused = offer.reused_msa_id
    ? await db
        .prepare(
          "SELECT * FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL AND archive_closed_at IS NULL AND EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=software_agreements.id AND f.status='ready') AND client_id=?",
        )
        .bind(offer.reused_msa_id, clientId)
        .first<Agreement>()
    : null;
  if (offer.reused_msa_id && !reused)
    throw new Error(
      'The confirmed MSA does not match this legal party. Ask Kazon for a new offer.',
    );
  const msaTemplate = await db
    .prepare('SELECT * FROM software_agreement_templates WHERE id=?')
    .bind(reused?.template_id ?? offer.msa_template_id)
    .first<AgreementTemplate>();
  const sowTemplate = await db
    .prepare('SELECT * FROM software_agreement_templates WHERE id=?')
    .bind(offer.sow_template_id)
    .first<AgreementTemplate>();
  if (!msaTemplate || !sowTemplate) throw new Error('The pinned templates are unavailable.');
  const msaId = reused?.id ?? crypto.randomUUID(),
    sowId = crypto.randomUUID();
  const values = agreementValues(
    terms,
    details,
    client,
    {
      ...contractor,
      config_version: JSON.parse(offer.contractor_snapshot_json!).config_version ?? 1,
    },
    {
      effective_on: effective,
      msa_version: `${reused?.effective_on ?? effective} / template ${msaTemplate.version}`,
      sow_number: `SOW-${sowId}`,
      offer_version: offer.version,
      template_version: sowTemplate.version,
    },
  );
  const documents = [] as { id: string; kind: 'msa' | 'sow'; hash: string; text: string }[];
  if (!reused) {
    const text = renderAgreement('msa', msaTemplate.text, values);
    documents.push({ id: msaId, kind: 'msa', hash: await hashOfferToken(text), text });
  }
  const sowText = renderAgreement('sow', sowTemplate.text, values);
  documents.push({ id: sowId, kind: 'sow', hash: await hashOfferToken(sowText), text: sowText });
  const pending = await db
    .prepare(
      "SELECT * FROM software_agreements WHERE client_id=? AND template_id=? AND kind='msa' AND status IN ('review','client_signed') AND offer_id<>?",
    )
    .bind(clientId, msaTemplate.id, offer.id)
    .first<Agreement>();
  if (pending)
    throw new Error('Another offer has a pending MSA for this party. Ask Kazon to resolve it.');
  await db.batch([
    liveSigningGuard(db, offer.id, session.link_hash!, session.recipient_email),
    sessionGuard(db, session),
    softwareGuard(
      db,
      "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed'))",
      [offer.id],
    ),
    db
      .prepare('INSERT OR IGNORE INTO software_agreement_clients VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(
        clientId,
        identity.recipient_email,
        client.legal_name,
        identity.legal_name_key,
        client.entity_type,
        client.jurisdiction,
        client.business_address,
        client.notice_email,
        at,
      ),
    db
      .prepare("DELETE FROM software_agreements WHERE offer_id=? AND status='review'")
      .bind(offer.id),
    ...documents.map((d) =>
      db
        .prepare(
          `INSERT INTO software_agreements(id,kind,offer_id,request_id,client_id,template_id,msa_id,sow_number,status,canonical_text,text_sha256,values_json,attachment_manifest_json,created_at,effective_on,review_session_hash) VALUES(?,?,?,?,?,?,?,?,'review',?,?,?,?,?,?,?)`,
        )
        .bind(
          d.id,
          d.kind,
          offer.id,
          offer.request_id,
          clientId,
          d.kind === 'msa' ? msaTemplate.id : sowTemplate.id,
          d.kind === 'sow' ? msaId : null,
          d.kind === 'sow' ? `SOW-${sowId}` : null,
          d.text,
          d.hash,
          JSON.stringify(values),
          JSON.stringify(d.kind === 'sow' ? details.attachments : []),
          at,
          effective,
          session.token_hash,
        ),
    ),
    ...(replacedClientIds.length ? [db
      .prepare(`DELETE FROM software_agreement_clients WHERE id IN (${replacedClientIds.map(() => '?').join(',')})
        AND NOT EXISTS(SELECT 1 FROM software_agreements WHERE client_id=software_agreement_clients.id)
        AND NOT EXISTS(SELECT 1 FROM software_agreement_notices WHERE client_id=software_agreement_clients.id)`)
      .bind(...replacedClientIds)] : []),
    agreementEvent(db, 'reviewed', session.token_hash, at, null, offer.id),
  ]);
  return {
    documents,
    reused_msa: reused
      ? { id: reused.id, text: reused.canonical_text, hash: reused.text_sha256 }
      : null,
  };
}
export const signatureIds = (documents: { id: string; hash: string }[]) =>
  JSON.stringify(
    documents.map((d) => ({ id: d.id, hash: d.hash })).sort((a, b) => a.id.localeCompare(b.id)),
  );
export async function signAgreements(
  db: D1Database,
  offer: SoftwareOffer,
  session: AgreementSession,
  documents: { id: string; hash: string }[],
  request: Request,
) {
  const agreements = await offerAgreements(db, offer.id),
    toSign = agreements.filter((a) => a.status !== 'executed');
  if (
    !toSign.length ||
    signatureIds(toSign.map((a) => ({ id: a.id, hash: a.text_sha256 }))) !== signatureIds(documents)
  )
    throw new Error('The reviewed documents changed. Review them again.');
  if (toSign.every((a) => a.status === 'client_signed')) {
    const saved = await db
      .prepare(
        "SELECT receipt_id,session_token_hash FROM software_agreement_signatures WHERE agreement_id=? AND party='client'",
      )
      .bind(toSign[0].id)
      .first<{ receipt_id: string; session_token_hash: string }>();
    if (saved?.session_token_hash !== session.token_hash)
      throw new Error('A different signing action is already saved.');
    return saved.receipt_id;
  }
  const values = JSON.parse(toSign[0].values_json),
    client = clientAgreementSchema.parse(values.client),
    at = new Date().toISOString(),
    receipt = crypto.randomUUID(),
    action = toSign.length === 2 ? 'Sign MSA and SOW' : 'Sign SOW';
  await db.batch([
    liveSigningGuard(db, offer.id, session.link_hash!, session.recipient_email),
    sessionGuard(db, session),
    ...reusedMsaGuard(db, offer),
    db
      .prepare(
        `INSERT INTO software_agreement_notices(id,agreement_id,client_id,business_address,notice_email,recorded_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM software_agreement_clients WHERE id=? AND (business_address<>? OR notice_email<>?))`,
      )
      .bind(
        crypto.randomUUID(),
        toSign.find((a) => a.kind === 'sow')!.id,
        toSign[0].client_id,
        client.business_address,
        client.notice_email,
        at,
        toSign[0].client_id,
        client.business_address,
        client.notice_email,
      ),
    ...toSign.flatMap((a) => [
      softwareGuard(
        db,
        "SELECT 1 FROM software_agreements WHERE id=? AND status='review' AND text_sha256=? AND review_session_hash=?",
        [a.id, a.text_sha256, session.token_hash],
      ),
      signatureInsert(
        db,
        a,
        'client',
        client.signer_name,
        client.signer_title,
        client.legal_name,
        session.recipient_email,
        session.verified_at,
        session.token_hash,
        null,
        receipt,
        at,
        action,
        documents,
        request,
      ),
      agreementEvent(db, 'client-signed', session.token_hash, at, a.id, offer.id),
      db
        .prepare(
          "UPDATE software_agreements SET status='client_signed',client_signed_at=? WHERE id=?",
        )
        .bind(at, a.id),
    ]),
    db
      .prepare(
        "INSERT INTO software_agreement_notifications(agreement_id,kind,email) VALUES(?,'signature-receipt',?)",
      )
      .bind(toSign.find((a) => a.kind === 'sow')!.id, session.recipient_email),
    db
      .prepare(
        "INSERT INTO software_agreement_notifications(agreement_id,kind,email) VALUES(?,'countersign-notice',?)",
      )
      .bind(toSign.find((a) => a.kind === 'sow')!.id, values.contractor.notice_email),
  ]);
  return receipt;
}
function reusedMsaGuard(db: D1Database, offer: SoftwareOffer) {
  return offer.reused_msa_id
    ? [
        softwareGuard(
          db,
          "SELECT 1 FROM software_agreements WHERE id=? AND kind='msa' AND status='executed' AND terminated_at IS NULL",
          [offer.reused_msa_id],
        ),
      ]
    : [];
}
function signatureInsert(
  db: D1Database,
  a: Agreement,
  party: string,
  name: string,
  title: string,
  legalParty: string,
  email: string,
  verified: string,
  session: string | null,
  owner: string | null,
  receipt: string,
  at: string,
  action: string,
  documents: { id: string; hash: string }[],
  request: Request,
) {
  validateAgreementCharacters(name + title);
  const ip = request.headers.get('cf-connecting-ip') ?? '',
    ua = request.headers.get('user-agent') ?? '';
  if (ip.length > 100 || ua.length > 2000 || /[\x00-\x1f\x7f]/.test(ip + ua))
    throw new Error('Browser evidence exceeds its limits.');
  return db
    .prepare(
      `INSERT INTO software_agreement_signatures(id,agreement_id,party,typed_name,title,consent_text,authority_text,consent_version,consent_at,signed_at,document_sha256,session_token_hash,owner_subject,verified_email,verified_at,intent_text,document_list_json,receipt_id,ip_address,user_agent) VALUES(?,?,?,?,?,?,?,'website-signing-v1',?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      a.id,
      party,
      name,
      title,
      consentText,
      authorityText(legalParty),
      at,
      at,
      a.text_sha256,
      session,
      owner,
      email,
      verified,
      intentText(action),
      signatureIds(documents),
      receipt,
      ip,
      ua,
    );
}
export async function countersignAgreements(
  db: D1Database,
  offer: SoftwareOffer,
  documents: { id: string; hash: string }[],
  name: string,
  actor: string,
  request: Request,
) {
  const agreements = await offerAgreements(db, offer.id),
    pending = agreements.filter((a) => a.status === 'client_signed');
  if (
    !pending.length ||
    signatureIds(pending.map((a) => ({ id: a.id, hash: a.text_sha256 }))) !==
      signatureIds(documents)
  )
    throw new Error('The pending documents changed. Reload before countersigning.');
  const at = new Date().toISOString(),
    receipt = crypto.randomUUID(),
    config = contractorSchema.parse(
      (({ config_version, ...values }) => values)(JSON.parse(offer.contractor_snapshot_json!)),
    ),
    sow = pending.find((a) => a.kind === 'sow')!;
  await db.batch([
    softwareGuard(
      db,
      "SELECT 1 FROM software_offers o JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND r.status NOT IN ('withdrawn','resolved') AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)",
      [offer.id],
    ),
    ...reusedMsaGuard(db, offer),
    ...pending.flatMap((a) => [
      softwareGuard(
        db,
        "SELECT 1 FROM software_agreements WHERE id=? AND status='client_signed' AND text_sha256=?",
        [a.id, a.text_sha256],
      ),
      signatureInsert(
        db,
        a,
        'contractor',
        name,
        config.signer_title,
        config.legal_name,
        actor.trim().toLowerCase(),
        at,
        null,
        actor,
        receipt,
        at,
        pending.length === 2 ? 'Countersign MSA and SOW' : 'Countersign SOW',
        documents,
        request,
      ),
      agreementEvent(db, 'countersigned', actor, at, a.id, offer.id),
      db
        .prepare("UPDATE software_agreements SET status='executed',executed_at=? WHERE id=?")
        .bind(at, a.id),
    ]),
    ...pending.map((a) =>
      db.prepare('INSERT INTO software_agreement_artifacts(agreement_id) VALUES(?)').bind(a.id),
    ),
    ...(['client', 'contractor'] as const).map((role) =>
      db
        .prepare(
          'INSERT INTO software_agreement_deliveries(agreement_id,recipient_role,email) VALUES(?,?,?)',
        )
        .bind(
          sow.id,
          role,
          role === 'client' ? offer.recipient_email_snapshot : config.notice_email,
        ),
    ),
  ]);
  return sow.id;
}
export async function executedOfferAgreement(db: D1Database, offerId: string) {
  return db
    .prepare(
      `SELECT a.* FROM software_agreements a JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.offer_id=? AND a.kind='sow' AND a.status='executed' AND a.ended_at IS NULL AND a.archive_closed_at IS NULL AND f.status='ready' AND (SELECT count(*) FROM software_agreement_deliveries d WHERE d.agreement_id=a.id AND (d.status='sent' OR d.alternate_delivered_at IS NOT NULL))=2`,
    )
    .bind(offerId)
    .first<Agreement>();
}
