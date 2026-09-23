import type { APIRoute } from 'astro';
import { clearStudioSessionCookie, clientPortalEnabled, revokeClientSession, studioSessionFromRequest } from '~/lib/audio-client-access';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env?.MUSIC_DB) return new Response('Studio is temporarily unavailable.', { status: 503 });
  const token = studioSessionFromRequest(request);
  if (token) await revokeClientSession(env.MUSIC_DB, token);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearStudioSessionCookie(secure) } });
};
