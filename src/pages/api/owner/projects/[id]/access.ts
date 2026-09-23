import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { revokeProjectAccess } from '~/lib/audio-project-revocation';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const input = z.object({ action: z.literal('revoke') });

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !params.id) return Response.json({ ok: false, error: 'Project access is temporarily unavailable.' }, { status: 503 });
  const body = await musicRequest(request, 1024);
  if (body instanceof Response) return body;
  if (!input.safeParse(body).success) return Response.json({ ok: false }, { status: 400 });
  try {
    if (!await revokeProjectAccess(env.MUSIC_DB, params.id, locals.owner.email)) {
      return Response.json({ ok: false, error: 'Project access is already closed.' }, { status: 409 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Project access could not be closed. Please try again.' }, { status: 503 });
  }
};
