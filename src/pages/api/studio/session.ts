import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled, completeClientCode, hashValue, normalizeClientEmail, studioSessionCookie } from '~/lib/audio-client-access';
import { musicRequest } from '~/lib/music-request';
import { checkRateLimit } from '~/lib/rate-limit';

export const prerender = false;
const inputSchema = z.object({ email: z.string().max(320), code: z.string().regex(/^\d{8}$/) });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env?.MUSIC_DB || !env.RATE_LIMIT || !env.AUDIO_CLIENT_CODE_KEY) {
    return Response.json({ ok: false, error: 'Studio sign-in is temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 4096);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  const email = parsed.success ? normalizeClientEmail(parsed.data.email) : null;
  if (!parsed.success || !email) return Response.json({ ok: false, error: 'Check the email and eight-digit code.' }, { status: 400 });
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    const emailKey = await hashValue(email);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(env.RATE_LIMIT, ip, 'rl:studio-session-ip:', 20),
      checkRateLimit(env.RATE_LIMIT, emailKey, 'rl:studio-session-email:', 10),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) return Response.json({ ok: false, error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
    const token = await completeClientCode(env.MUSIC_DB, email, parsed.data.code, env.AUDIO_CLIENT_CODE_KEY);
    if (!token) return Response.json({ ok: false, error: 'That code is invalid or expired. Request a new one if needed.' }, { status: 401 });
    return Response.json({ ok: true }, { headers: { 'set-cookie': studioSessionCookie(token, new URL(request.url).protocol === 'https:') } });
  } catch {
    return Response.json({ ok: false, error: 'Studio sign-in is temporarily unavailable.' }, { status: 503 });
  }
};
