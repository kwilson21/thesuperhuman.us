import type { APIRoute } from 'astro';
import { clearStudioSessionCookie, clientPortalEnabled, revokeClientSession, studioSessionFromRequest } from '~/lib/audio-client-access';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  const secure = new URL(request.url).protocol === 'https:';
  const headers = { 'set-cookie': clearStudioSessionCookie(secure) };
  if (!env?.MUSIC_DB) return Response.json({ ok: false, localSignedOut: true }, { status: 503, headers });
  const token = studioSessionFromRequest(request);
  try {
    if (token) await revokeClientSession(env.MUSIC_DB, token);
    return Response.json({ ok: true }, { headers });
  } catch {
    console.error('Studio session revocation failed.');
    return Response.json({ ok: false, localSignedOut: true }, { status: 503, headers });
  }
};
