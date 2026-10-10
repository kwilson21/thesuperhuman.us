import { agreementEvent } from "./agreement-events";
import {
  hashOfferToken,
  getLinkedOffer,
  newOfferToken,
} from "./software-offers";
import {
  normalizeClientEmail,
  reserveStudioAllowance,
} from "./audio-client-access";
import { sendAudioMessage } from "./audio-resend";
import { escapeHtml } from "./email-template";
import { verifyTurnstile } from "./turnstile";
export const maskedAgreementEmail = (email: string) => `${[...email][0]}•••@${email.split('@')[1]}`;
export const agreementHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};
export const agreementJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: agreementHeaders });
export async function cleanupAgreementAccess(db: D1Database) {
  const before = new Date(Date.now() - 30 * 86400000).toISOString();
  // Successful verification evidence lives in immutable signatures, independently of these short-lived rows.
  await db.batch([
    db
      .prepare(
        "DELETE FROM software_agreement_sessions WHERE expires_at<? OR revoked_at<?",
      )
      .bind(before, before),
    db
      .prepare(
        "DELETE FROM software_agreement_links WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM software_agreement_sessions s WHERE s.link_id=software_agreement_links.id)",
      )
      .bind(before),
  ]);
}
export async function signingEnabled(db: D1Database) {
  return Boolean(
    (
      await db
        .prepare(
          "SELECT software_signing_enabled FROM software_signing_settings WHERE id=1",
        )
        .first<{ software_signing_enabled: number }>()
    )?.software_signing_enabled,
  );
}
export type AgreementSession = {
  token_hash: string;
  purpose: "agreement" | "archive";
  offer_id: string | null;
  link_hash: string | null;
  recipient_email: string;
  verified_at: string;
  expires_at: string;
  csrf_nonce: string;
};
export const sessionCookie = (
  token: string,
  secure: boolean,
  purpose = "agreement",
) =>
  `${purpose === "archive" ? "agreement_archive" : "agreement_session"}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${secure ? "; Secure" : ""}`;
export async function agreementSession(
  db: D1Database,
  request: Request,
  purpose: "agreement" | "archive" = "agreement",
  offerId?: string,
) {
  const name =
    purpose === "archive" ? "agreement_archive" : "agreement_session";
  const token = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1];
  if (!token) return null;
  const session = await db
    .prepare(
      "SELECT * FROM software_agreement_sessions WHERE token_hash=? AND purpose=? AND expires_at>? AND revoked_at IS NULL",
    )
    .bind(await hashOfferToken(token), purpose, new Date().toISOString())
    .first<AgreementSession>();
  if (!session || (offerId && session.offer_id !== offerId)) return null;
  if (purpose === "agreement") {
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
export async function issueAgreementLink(
  env: Env,
  request: Request,
  input: { turnstileToken: string; email?: string },
  token?: string,
) {
  const db = env.MUSIC_DB,
    purpose = token ? "agreement" : "archive";
  if (
    !db ||
    !env.AUDIO_CLIENT_CODE_KEY ||
    !env.RESEND_API_KEY ||
    !env.CONTACT_FROM_EMAIL ||
    !env.TURNSTILE_SECRET_KEY
  )
    return agreementJson(
      { ok: false, error: "Agreement sign-in is temporarily unavailable." },
      503,
    );
  if (token && !(await signingEnabled(db)))
    return agreementJson({ ok: false, error: "Website signing is off." }, 404);
  const offer = token ? await getLinkedOffer(db, token) : null;
  if (token && (!offer?.recipient_email_snapshot || !offer.msa_template_id))
    return agreementJson(
      { ok: false, error: "This offer is unavailable for signing." },
      404,
    );
  const email = normalizeClientEmail(
    offer?.recipient_email_snapshot ?? input.email ?? "",
  );
  if (!email)
    return agreementJson(
      { ok: false, error: "Enter a valid email address." },
      400,
    );
  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  // Verify before charging either allowance so bots cannot exhaust a recipient's access.
  if (
    !(await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip))
  )
    return agreementJson(
      { ok: false, error: "Complete the security check again." },
      403,
    );
  const allowances: Awaited<ReturnType<typeof reserveStudioAllowance>>[] = [];
  for (const [scope, value, limit] of [
    [`${purpose}-link-ip`, ip, 20],
    [`${purpose}-link-email`, email, 3],
  ] as const) {
    const allowance = await reserveStudioAllowance(db,scope,value,limit,env.AUDIO_CLIENT_CODE_KEY);
    allowances.push(allowance);
    if (!allowance.allowed) return agreementJson({ok:false,error:'Please wait a few minutes before requesting another link.'},429);
  }
  const receipt = {
    ok: true,
    message: token
      ? `I sent a link to ${(await agreementSession(db,request,"agreement",offer!.id)) ? email : maskedAgreementEmail(email)}. Tap it on any device to open your agreement.`
      : "If an agreement is available, a link is on its way.",
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
    id = crypto.randomUUID(),
    key = newOfferToken(),
    hash = await hashOfferToken(key),
    linkHash = token ? await hashOfferToken(token) : null;
  try {
    await db.batch([
      db
        .prepare(
          `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM software_agreement_links WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND issued_at>?) THEN 1 ELSE json_extract('Wait before requesting another link','$') END`,
        )
        .bind(
          purpose,
          email,
          offer?.id ?? null,
          new Date(at.getTime() - 30000).toISOString(),
        ),
      ...(offer ? [liveSigningGuard(db, offer.id, linkHash!, email)] : []),
      db
        .prepare(
          "UPDATE software_agreement_links SET used_at=? WHERE purpose=? AND recipient_email=? AND offer_id IS ? AND used_at IS NULL",
        )
        .bind(at.toISOString(), purpose, email, offer?.id ?? null),
      agreementEvent(
        db,
        "link-issued",
        await hashOfferToken(id),
        at.toISOString(),
        null,
        offer?.id ?? null,
      ),
      db
        .prepare(
          "INSERT INTO software_agreement_links(id,purpose,offer_id,link_hash,recipient_email,token_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          purpose,
          offer?.id ?? null,
          linkHash,
          email,
          hash,
          at.toISOString(),
          new Date(at.getTime() + 3600000).toISOString(),
        ),
    ]);
  } catch {
    return agreementJson(
      {
        ok: false,
        error: "Wait at least 30 seconds before requesting another link.",
      },
      429,
    );
  }
  const url = new URL(
    token ? `/offer/${token}/verify` : "/agreements/verify",
    request.url,
  );
  url.searchParams.set("key", key);
  const brief = offer
    ? await db
        .prepare("SELECT name FROM owner_requests WHERE id=?")
        .bind(offer.request_id)
        .first<{ name: string }>()
    : null;
  const project = offer
    ? JSON.parse(offer.terms_json).outcome
    : "your retained agreements";
  const greeting = `Hi ${brief?.name?.trim().split(/\s+/)[0] || "there"},`;
  const intro = `Tap below to review and sign the agreement for ${project}.`;
  const expiry =
    "This link works once and expires in an hour. If you didn't ask for it, you can ignore this email.";
  const sent = await sendAudioMessage({
    apiKey: env.RESEND_API_KEY,
    payload: {
      from: env.CONTACT_FROM_EMAIL,
      to: [email],
      subject: "Open your agreement",
      text: `${greeting}\n\n${intro}\n\nReview and sign: ${url.href}\n\n${expiry}\n\nKazon`,
      html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url.href)}">Review and sign</a></p><p>${escapeHtml(expiry)}</p><p>Kazon</p>`,
    },
  });
  if (!sent.ok && !sent.uncertain) {
    if (token) {
      await db.batch([
        db.prepare('DELETE FROM software_agreement_sessions WHERE link_id=?').bind(id),
        db.prepare('DELETE FROM software_agreement_links WHERE id=?').bind(id),
        ...allowances.flatMap(allowance=>[db.prepare('DELETE FROM audio_client_allowances WHERE key=? AND window_start=? AND uses=1').bind(allowance.key,allowance.windowStart),db.prepare('UPDATE audio_client_allowances SET uses=uses-1 WHERE key=? AND window_start=? AND uses>1').bind(allowance.key,allowance.windowStart)]),
      ]);
      return agreementJson({ok:false,error:"That email didn't go through. Please try again."},502);
    }
    await db.prepare('UPDATE software_agreement_links SET used_at=? WHERE id=?').bind(at.toISOString(),id).run();
  }
  return agreementJson(receipt);
}
export const liveSigningGuard = (
  db: D1Database,
  id: string,
  linkHash: string,
  email: string,
) =>
  db
    .prepare(
      `SELECT CASE WHEN EXISTS(SELECT 1 FROM software_offers o JOIN software_offer_links l ON l.request_id=o.request_id JOIN owner_requests r ON r.id=o.request_id WHERE o.id=? AND o.status='sent' AND l.token_hash=? AND l.revoked_at IS NULL AND o.recipient_email_snapshot=? AND r.status NOT IN ('resolved','withdrawn') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id) AND EXISTS(SELECT 1 FROM software_signing_settings WHERE software_signing_enabled=1)) THEN 1 ELSE json_extract('Signing state changed','$') END`,
    )
    .bind(id, linkHash, email);
export async function completeAgreementLink(
  env: Env,
  request: Request,
  key: string,
  token?: string,
) {
  const db = env.MUSIC_DB,
    purpose = token ? "agreement" : "archive";
  const expired = () =>
    agreementJson({ ok: false, error: "This link has expired." }, 401);
  if (!db || !/^[A-Za-z0-9_-]{43}$/.test(key)) return expired();
  const hash = await hashOfferToken(key),
    at = new Date().toISOString();
  const link = await db
    .prepare(
      "SELECT * FROM software_agreement_links WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?",
    )
    .bind(hash, purpose, at)
    .first<{
      id: string;
      offer_id: string;
      link_hash: string;
      recipient_email: string;
    }>();
  if (!link || (token && (await hashOfferToken(token)) !== link.link_hash))
    return expired();
  const session = newOfferToken(),
    sessionHash = await hashOfferToken(session),
    csrf = newOfferToken();
  try {
    await db.batch([
      ...(token
        ? [
            liveSigningGuard(
              db,
              link.offer_id,
              link.link_hash,
              link.recipient_email,
            ),
          ]
        : []),
      db
        .prepare(
          `SELECT CASE WHEN EXISTS(SELECT 1 FROM software_agreement_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?) THEN 1 ELSE json_extract('Link already consumed','$') END`,
        )
        .bind(hash, at),
      db
        .prepare(
          "UPDATE software_agreement_links SET used_at=? WHERE token_hash=?",
        )
        .bind(at, hash),
      agreementEvent(db, "verified", sessionHash, at, null, link.offer_id),
      db
        .prepare(
          "INSERT INTO software_agreement_sessions(token_hash,purpose,offer_id,link_hash,recipient_email,link_id,verified_at,expires_at,csrf_nonce) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          sessionHash,
          purpose,
          link.offer_id,
          link.link_hash,
          link.recipient_email,
          link.id,
          at,
          new Date(Date.parse(at) + 7200000).toISOString(),
          csrf,
        ),
    ]);
  } catch {
    return expired();
  }
  return new Response(null, {
    status: 303,
    headers: {
      ...agreementHeaders,
      location: token ? `/offer/${token}/sign` : "/agreements",
      "set-cookie": sessionCookie(
        session,
        new URL(request.url).protocol === "https:",
        purpose,
      ),
    },
  });
}
