import { sendAudioMessage } from './audio-resend';
import { softwareBriefEmail } from './client-emails';
import type { OwnerRequest } from './owner-model';
import { softwareBrief } from './software-inquiry';

export async function deliverSoftwareBriefCopy(db: D1Database, request: OwnerRequest, env: Env,
  retry = false, confirmedNotSent = false): Promise<string | null> {
  const at = new Date().toISOString();
  try {
    // Claim atomically before sending; uncertain delivery requires an explicit checked retry.
    const claimed = await db.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,
      '$.clientCopyStatus','uncertain','$.clientCopyAttemptedAt',?)
      WHERE id=? AND kind='software' AND status NOT IN ('resolved','withdrawn') AND email<>'' AND
      (${retry ? `(json_extract(details_json,'$.clientCopyStatus')='failed' OR
        (json_extract(details_json,'$.clientCopyStatus')='uncertain' AND ?=1 AND
        json_extract(details_json,'$.clientCopyAttemptedAt')<=?))` : "json_extract(details_json,'$.clientCopyStatus') IS NULL"}) RETURNING id`)
      .bind(at, request.id, ...(retry ? [confirmedNotSent ? 1 : 0, new Date(Date.parse(at) - 60_000).toISOString()] : []))
      .first<{ id: string }>();
    if (!claimed) return null;
    const copy = env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL && env.OWNER_EMAIL
      ? await sendAudioMessage({ apiKey: env.RESEND_API_KEY, payload: {
        from: env.CONTACT_FROM_EMAIL, to: [request.email], reply_to: env.OWNER_EMAIL,
        subject: `Your brief: ${request.summary || 'your project'}`, ...softwareBriefEmail(request.name, softwareBrief(request)),
      } }) : { ok: false };
    const status = copy.ok ? 'sent' : copy.uncertain ? 'uncertain' : 'failed';
    await db.batch([db.prepare(`UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus',?)
      WHERE id=? AND json_extract(details_json,'$.clientCopyAttemptedAt')=?`).bind(status, request.id, at)]);
    return status;
  } catch {
    console.error('Client brief copy state is uncertain.');
    return 'uncertain';
  }
}
