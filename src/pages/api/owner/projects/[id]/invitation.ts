import type { APIRoute } from 'astro';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { deliverProjectInvitation, queueProjectInvitation } from '~/lib/audio-project-invitations';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !params.id || !locals.runtime.ctx) {
    return Response.json({ ok: false, error: 'Project invitations are temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 1024);
  if (body instanceof Response) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('action' in body) || body.action !== 'send') {
    return Response.json({ ok: false, error: 'Check the invitation and try again.' }, { status: 400 });
  }
  try {
    if (!await queueProjectInvitation(env.MUSIC_DB, params.id)) {
      return Response.json({ ok: false, error: 'This invitation cannot be sent again here.' }, { status: 409 });
    }
    locals.runtime.ctx.waitUntil(deliverProjectInvitation(env.MUSIC_DB, params.id, env)
      .catch(() => console.error('Studio invitation email state is uncertain.')));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'The invitation could not be queued. Please try again.' }, { status: 503 });
  }
};
