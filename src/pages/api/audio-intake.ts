import type { APIRoute } from 'astro';
import { ownerRequestForIntake, validateIntake } from '~/lib/audio-intake';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { deliverProjectInvitation } from '~/lib/audio-project-invitations';
import { musicRequest } from '~/lib/music-request';
import { sendUrgentOwnerAlert } from '~/lib/owner-alerts';
import { saveOwnerRequest } from '~/lib/owner-requests';
import { checkRateLimit } from '~/lib/rate-limit';
import { verifyTurnstile } from '~/lib/turnstile';
export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request, 32768);
  if (body instanceof Response) return body;
  const result = validateIntake(body);
  if (!result.ok) return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  const env = locals.runtime?.env;
  if (!env?.MUSIC_DB || !env.TURNSTILE_SECRET_KEY || !env.RATE_LIMIT) {
    return Response.json({ ok: false, error: 'Sending is unavailable right now. Your details are still here. Please email kazon.wilson@thesuperhuman.us.' }, { status: 503 });
  }
  const input = result.value;
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    // Bound verification attempts separately so a failed challenge can be retried.
    const attempts = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:audio-attempt:', 10);
    if (!attempts.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending again.' }, { status: 429 });
    if (!await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip)) return Response.json({ ok: false, errors: { turnstileToken: 'Please complete the security check again.' } }, { status: 403 });
    const limit = await checkRateLimit(env.RATE_LIMIT, ip, 'rl:audio:');
    if (!limit.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending again.' }, { status: 429 });
    let saved: Awaited<ReturnType<typeof saveOwnerRequest>>;
    try {
      saved = await saveOwnerRequest(env.MUSIC_DB, ownerRequestForIntake(input));
    } catch {
      await env.RATE_LIMIT.delete(`rl:audio:${ip}`);
      await sendUrgentOwnerAlert(env, {
        category: 'request-storage', route: '/api/audio-intake', requestId: crypto.randomUUID(),
        code: 'd1-write-failed', occurredAt: new Date().toISOString(),
      });
      return Response.json({ ok: false, error: 'We couldn’t confirm delivery. Your details are still here. Try again later or email kazon.wilson@thesuperhuman.us.' }, { status: 503 });
    }
    if (clientPortalEnabled(env)) {
      const delivery = deliverProjectInvitation(env.MUSIC_DB, saved.id, env)
        .catch(() => console.error('Studio invitation email state is uncertain.'));
      if (locals.runtime?.ctx) locals.runtime.ctx.waitUntil(delivery);
      else await delivery;
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Sending is temporarily unavailable. Your details are still here. Please try again later.' }, { status: 503 });
  }
};
