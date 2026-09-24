import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { deliverProjectInvitation, queueProjectInvitation } from '~/lib/audio-project-invitations';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const inputSchema = z.object({ action: z.literal('send'), confirmedNotSent: z.boolean().optional() });

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !params.id || !locals.runtime.ctx) {
    return Response.json({ ok: false, error: 'Project invitations are temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 1024);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Check the invitation and try again.' }, { status: 400 });
  }
  try {
    if (!await queueProjectInvitation(env.MUSIC_DB, params.id, parsed.data.confirmedNotSent)) {
      return Response.json({ ok: false, error: 'This invitation cannot be sent again here.' }, { status: 409 });
    }
    locals.runtime.ctx.waitUntil(deliverProjectInvitation(env.MUSIC_DB, params.id, env)
      .catch(() => console.error('Studio invitation email state is uncertain.')));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'The invitation could not be queued. Please try again.' }, { status: 503 });
  }
};
