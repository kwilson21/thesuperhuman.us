import { agreementEvent } from './agreement-events';
import { hashOfferToken, getLinkedOffer, newOfferToken } from './software-offers';
import { normalizeClientEmail, takeStudioAllowance } from './audio-client-access';
import { sendAudioMessage } from './audio-resend';
import { verifyTurnstile } from './turnstile';
export const agreementHeaders = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};
export const agreementJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: agreementHeaders });
export async function cleanupAgreementAccess(db: D1Database) {
  const before = new Date(Date.now() - 30 * 86400000).toISOString();
  // Successful verification evidence lives in immutable signatures, independently of these short-lived rows.
  await db.batch([
    db
      .prepare('DELETE FROM software_agreement_sessions WHERE expires_at<? OR revoked_at<?')
      .bind(before, before),
    db
      .prepare(
        'DELETE FROM software_agreement_challenges WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM software_agreement_sessions s WHERE s.challenge_id=software_agreement_challenges.id)',
      )
      .bind(before),
  ]);
}
export async function signingEnabled(db: D1Database) {
  return Boolean(
    (
      await db
        .prepare('SELECT software_signing_enabled FROM software_signing_settings WHERE id=1')
        .first<{ software_signing_enabled: number }>()
    )?.software_signing_enabled,
  );
}
export type AgreementSession = {
  token_hash: string;
  purpose: 'agreement' | 'archive';
  offer_id: string | null;
  link_hash: string | null;
  recipient_email: string;
  verified_at: string;
  expires_at: string;
  csrf_nonce: string;
};
export const sessionCookie = (token: string, secure: boolean, purpose = 'agreement') =>
  `${purpose === 'archive' ? 'agreement_archive' : 'agreement_session'}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? '; Secure' : ''}`;
export async function agreementSession(
  db: D1Database,
  request: Request,
  purpose: 'agreement' | 'archive' = 'agreement',
  offerId?: string,
) {
  const name = purpose === 'archive' ? 'agreement_archive' : 'agreement_session';
  const token = request.headers
    .get('cookie')
    ?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1];
  if (!token) return null;
  const session = await db
    .prepare(
      'SELECT * FROM software_agreement_sessions WHERE token_hash=? AND purpose=? AND expires_at>? AND revoked_at IS NULL',
    )
    .bind(await hashOfferToken(token), purpose, new Date().toISOString())
    .first<AgreementSession>();
  if (!session || (offerId && session.offer_id !== offerId)) return null;
  if (purpose === 'agreement') {
    const live = await db
      .prepare(
        `SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND r.status NOT IN ('withdrawn','resolved') AND o.recipient_email_snapshot=?`,
      )
      .bind(session.offer_id, session.link_hash, session.recipient_email)
      .first();
    if (!live) return null;
  }
  return session;
}
async function codeHash(secret: string, scope: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(scope)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function issueAgreementCode(
  env: Env,
  request: Request,
  input: { turnstileToken: string; email?: string },
  token?: string,
) {
  const db = env.MUSIC_DB,
    purpose = token ? 'agreement' : 'archive';
  if (
    !db ||
    !env.AUDIO_CLIENT_CODE_KEY ||
    !env.RESEND_API_KEY ||
    !env.CONTACT_FROM_EMAIL ||
    !env.TURNSTILE_SECRET_KEY
  )
    return agreementJson(
      { ok: false, error: 'Agreement sign-in is temporarily unavailable.' },
      503,
    );
  if (token && !(await signingEnabled(db)))
    return agreementJson({ ok: false, error: 'Website signing is off.' }, 404);
  const offer = token ? await getLinkedOffer(db, token) : null;
  if (token && (!offer || !offer.recipient_email_snapshot || !offer.msa_template_id))
    return agreementJson({ ok: false, error: 'This offer is unavailable for signing.' }, 404);
  const email = normalizeClientEmail(offer?.recipient_email_snapshot ?? input.email ?? '');
  if (!email) return agreementJson({ ok: false, error: 'Enter a valid email address.' }, 400);
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  if (
    !(await takeStudioAllowance(db, `${purpose}-code-ip`, ip, 20, env.AUDIO_CLIENT_CODE_KEY))
  )
    return agreementJson(
      { ok: false, error: 'Please wait a few minutes before requesting another code.' },
      429,
    );
  if (!(await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip)))
    return agreementJson({ ok: false, error: 'Complete the security check again.' }, 403);
  if (!(await takeStudioAllowance(db, `${purpose}-code-email`, email, 3, env.AUDIO_CLIENT_CODE_KEY)))
    return agreementJson(
      { ok: false, error: 'Please wait a few minutes before requesting another code.' },
      429,
    );
  const receipt = {
    ok: true,
    message: 'If an agreement is available, a code is on its way.',
    challenge_id: crypto.randomUUID(),
  };
  if (
    !offer &&
    !(await db
      .prepare(
        "SELECT 1 FROM software_agreement_clients c JOIN software_agreements a ON a.client_id=c.id WHERE c.recipient_email=? AND a.status='executed'",
      )
      .bind(email)
      .first())
  )
    return agreementJson(receipt);
  const at = new Date(),
    id = receipt.challenge_id,
    code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, '0'),
    linkHash = token ? await hashOfferToken(token) : null;
  const hash = await codeHash(
    env.AUDIO_CLIENT_CODE_KEY,
    `${purpose}:${id}:${offer?.id ?? ''}:${email}:${code}`,
  );
  try {
    await db.batch([
      db
        .prepare(
          `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_challenges WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another code','$') END`,
        )
        .bind(purpose, email, offer?.id ?? null, new Date(at.getTime() - 30000).toISOString()),
      ...(offer ? [liveSigningGuard(db, offer.id, linkHash!, email)] : []),
      db
        .prepare(
          'UPDATE software_agreement_challenges SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL',
        )
        .bind(at.toISOString(), purpose, email, offer?.id ?? null),
      agreementEvent(
        db,
        'code-issued',
        await hashOfferToken(id),
        at.toISOString(),
        null,
        offer?.id ?? null,
      ),
      db
        .prepare(
          'INSERT INTO software_agreement_challenges(id,purpose,offer_id,link_hash,recipient_email,code_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          purpose,
          offer?.id ?? null,
          linkHash,
          email,
          hash,
          at.toISOString(),
          new Date(at.getTime() + 600000).toISOString(),
        ),
    ]);
  } catch {
    return agreementJson(
      { ok: false, error: 'Wait at least 30 seconds before requesting another code.' },
      429,
    );
  }
  const sent = await sendAudioMessage({
    apiKey: env.RESEND_API_KEY,
    payload: {
      from: env.CONTACT_FROM_EMAIL,
      to: [email],
      subject: 'Your agreement sign-in code',
      text: `Your agreement sign-in code is ${code}. It expires in 10 minutes. ${offer ? 'This verifies the offer recipient.' : 'This opens your retained agreement archive.'} If you did not request it, ignore this email.`,
    },
  });
  if (!sent.ok && !sent.uncertain)
    await db
      .prepare('UPDATE software_agreement_challenges SET used_at=? WHERE id=?')
      .bind(at.toISOString(), id)
      .run();
  return agreementJson(receipt);
}
export const liveSigningGuard = (db: D1Database, id: string, linkHash: string, email: string) =>
  db
    .prepare(
      `SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END`,
    )
    .bind(id, linkHash, email);
export async function completeAgreementCode(
  env: Env,
  request: Request,
  input: { challenge_id: string; code: string },
  token?: string,
) {
  const db = env.MUSIC_DB,
    purpose = token ? 'agreement' : 'archive';
  if (!db || !env.AUDIO_CLIENT_CODE_KEY)
    return agreementJson(
      { ok: false, error: 'Agreement sign-in is temporarily unavailable.' },
      503,
    );
  const challenge = await db
    .prepare('SELECT * FROM software_agreement_challenges WHERE id=? AND purpose=?')
    .bind(input.challenge_id, purpose)
    .first<{
      offer_id: string | null;
      link_hash: string | null;
      recipient_email: string;
      code_hash: string;
    }>();
  if (!challenge)
    return agreementJson({ ok: false, error: 'That code is invalid or expired.' }, 401);
  if (
    token &&
    ((await hashOfferToken(token)) !== challenge.link_hash || !(await signingEnabled(db)))
  )
    return agreementJson({ ok: false, error: 'This offer link has changed.' }, 401);
  const at = new Date().toISOString();
  // Charge every attempt atomically, including the fifth. A consumed code can never issue another session.
  const charged = await db
    .prepare(
      'UPDATE software_agreement_challenges SET attempts=attempts+1 WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5 RETURNING attempts',
    )
    .bind(input.challenge_id, at)
    .first();
  const hash = await codeHash(
    env.AUDIO_CLIENT_CODE_KEY,
    `${purpose}:${input.challenge_id}:${challenge.offer_id ?? ''}:${challenge.recipient_email}:${input.code}`,
  );
  if (!charged || hash !== challenge.code_hash) {
    await agreementEvent(db,'code-rejected',await hashOfferToken(input.challenge_id),at,null,challenge.offer_id).run();
    return agreementJson(
      { ok: false, error: 'That code is invalid or expired. Request a new one if needed.' },
      401,
    );
  }
  const session = newOfferToken(),
    sessionHash = await hashOfferToken(session),
    csrf = newOfferToken();
  try {
    await db.batch([
      ...(token
        ? [
            liveSigningGuard(
              db,
              challenge.offer_id!,
              challenge.link_hash!,
              challenge.recipient_email,
            ),
          ]
        : []),
      db
        .prepare(
          `SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreement_challenges WHERE id=? AND used_at IS NULL AND expires_at>? AND code_hash=?) THEN 1 ELSE json_extract('Code already consumed','$') END`,
        )
        .bind(input.challenge_id, at, hash),
      db
        .prepare('UPDATE software_agreement_challenges SET used_at=? WHERE id=?')
        .bind(at, input.challenge_id),
      agreementEvent(db, 'verified', sessionHash, at, null, challenge.offer_id),
      db
        .prepare(
          'INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,challenge_id,verified_at,expires_at,csrf_nonce) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          sessionHash,
          purpose,
          challenge.offer_id,
          challenge.link_hash,
          challenge.recipient_email,
          input.challenge_id,
          at,
          new Date(Date.now() + 1800000).toISOString(),
          csrf,
        ),
    ]);
  } catch {
    return agreementJson({ ok: false, error: 'That code is invalid or expired.' }, 401);
  }
  return Response.json(
    { ok: true, csrf_nonce: csrf },
    {
      headers: {
        ...agreementHeaders,
        'set-cookie': sessionCookie(session, new URL(request.url).protocol === 'https:', purpose),
      },
    },
  );
}
