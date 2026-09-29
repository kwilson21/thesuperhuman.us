import type { APIRoute } from 'astro';
import { sendSoftwareRequestNotice } from '~/lib/audio-resend';
import { musicRequest } from '~/lib/music-request';
import { sendUrgentOwnerAlert } from '~/lib/owner-alerts';
import { getOwnerRequest, saveOwnerRequest } from '~/lib/owner-requests';
import { checkRateLimit } from '~/lib/rate-limit';
import { softwareBrief, softwareRequest, validateSoftwareInquiry } from '~/lib/software-inquiry';
import { verifyTurnstile } from '~/lib/turnstile';
export const prerender = false;

const preserved = 'We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.';
async function existing(db: D1Database, submissionId: string) {
  const row = await db.prepare('SELECT id FROM owner_requests WHERE submission_id=?').bind(submissionId).first<{ id: string }>();
  return row ? getOwnerRequest(db, row.id) : null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request, 32768);
  if (body instanceof Response) return body;
  const result = validateSoftwareInquiry(body);
  if (!result.ok) return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  const env = locals.runtime?.env;
  if (!env?.MUSIC_DB || !env.TURNSTILE_SECRET_KEY || !env.RATE_LIMIT)
    return Response.json({ ok: false, error: 'Sending is unavailable right now. Your details are still here. Please email kazon.wilson@thesuperhuman.us.' }, { status: 503 });
  const input = result.value;
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    const attempts = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:software-attempt:', 10);
    if (!attempts.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending again.' }, { status: 429 });
    if (!await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip))
      return Response.json({ ok: false, errors: { turnstileToken: 'Please complete the security check again.' } }, { status: 403 });
    let prior;
    try { prior = await existing(env.MUSIC_DB, input.submissionId); }
    catch {
      await sendUrgentOwnerAlert(env, { category: 'request-storage', route: '/api/software-inquiry', requestId: crypto.randomUUID(), code: 'd1-write-failed', occurredAt: new Date().toISOString() });
      return Response.json({ ok: false, error: preserved }, { status: 503 });
    }
    if (prior) return prior.email.toLowerCase() === input.email.toLowerCase()
      ? Response.json({ ok: true, brief: softwareBrief(prior) })
      : Response.json({ ok: false, error: preserved }, { status: 409 });
    const limit = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:software:');
    if (!limit.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending again. Your details are still here.' }, { status: 429 });
    let saved;
    try {
      saved = await saveOwnerRequest(env.MUSIC_DB, softwareRequest(input));
    } catch (error) {
      const raced = await existing(env.MUSIC_DB, input.submissionId).catch(() => null);
      if (raced) return raced.email.toLowerCase() === input.email.toLowerCase()
        ? Response.json({ ok: true, brief: softwareBrief(raced) })
        : Response.json({ ok: false, error: preserved }, { status: 409 });
      if (error instanceof Error && error.message === 'Request details are too large.')
        return Response.json({ ok: false, errors: { _form: 'Keep the brief shorter and try again.' } }, { status: 400 });
      await env.RATE_LIMIT.delete(`rl:software:${ip}`);
      await sendUrgentOwnerAlert(env, { category: 'request-storage', route: '/api/software-inquiry', requestId: crypto.randomUUID(), code: 'd1-write-failed', occurredAt: new Date().toISOString() });
      return Response.json({ ok: false, error: preserved }, { status: 503 });
    }
    const notice = sendSoftwareRequestNotice({ requestId: saved.id, path: input.path, name: input.name, email: input.email,
      origin: env.SITE_ORIGIN, apiKey: env.RESEND_API_KEY, from: env.CONTACT_FROM_EMAIL, to: env.CONTACT_TO_EMAIL })
      .catch(() => console.error('Owner notification email state is uncertain.'));
    if (locals.runtime?.ctx) locals.runtime.ctx.waitUntil(notice);
    else await notice;
    return Response.json({ ok: true, brief: softwareBrief(saved) });
  } catch {
    return Response.json({ ok: false, error: 'Sending is temporarily unavailable. Your details are still here. Please try again later.' }, { status: 503 });
  }
};
