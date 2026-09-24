import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled, completeClientCode, normalizeClientEmail, studioSessionCookie, takeStudioAllowance } from '~/lib/audio-client-access';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const inputSchema = z.object({ email: z.string().max(320), code: z.string().regex(/^\d{8}$/) });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env?.MUSIC_DB || !env.AUDIO_CLIENT_CODE_KEY) {
    return Response.json({ ok: false, error: 'Studio sign-in is temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 4096);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  const email = parsed.success ? normalizeClientEmail(parsed.data.email) : null;
  if (!parsed.success || !email) return Response.json({ ok: false, error: 'Check the email and eight-digit code.' }, { status: 400 });
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    const allowed = await takeStudioAllowance(env.MUSIC_DB, 'session-ip', ip, 20, env.AUDIO_CLIENT_CODE_KEY)
      && await takeStudioAllowance(env.MUSIC_DB, 'session-email', email, 10, env.AUDIO_CLIENT_CODE_KEY);
    if (!allowed) return Response.json({ ok: false, error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
    const token = await completeClientCode(env.MUSIC_DB, email, parsed.data.code, env.AUDIO_CLIENT_CODE_KEY);
    if (!token) return Response.json({ ok: false, error: 'That code is invalid or expired. Request a new one if needed.' }, { status: 401 });
    return Response.json({ ok: true }, { headers: { 'set-cookie': studioSessionCookie(token, new URL(request.url).protocol === 'https:') } });
  } catch {
    return Response.json({ ok: false, error: 'Studio sign-in is temporarily unavailable.' }, { status: 503 });
  }
};
