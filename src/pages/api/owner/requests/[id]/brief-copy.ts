import type { APIRoute } from 'astro';
import { z } from 'zod';
import { musicRequest } from '~/lib/music-request';
import { getOwnerRequest } from '~/lib/owner-requests';
import { deliverSoftwareBriefCopy } from '~/lib/software-brief-copy';

export const prerender = false;
const schema = z.object({ action: z.literal('send'), confirmedNotSent: z.boolean().optional() });
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!env?.MUSIC_DB || !params.id) return Response.json({ ok: false }, { status: 503 });
  const body = await musicRequest(request, 1024);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  try {
    const saved = await getOwnerRequest(env.MUSIC_DB, params.id);
    if (!saved || saved.kind !== 'software') return Response.json({ ok: false }, { status: 404 });
    const status = await deliverSoftwareBriefCopy(env.MUSIC_DB, saved, env, true, parsed.data.confirmedNotSent);
    if (status === 'failed') return Response.json({ ok: false, error: 'The brief copy could not be sent. Please try again.' }, { status: 503 });
    return status ? Response.json({ ok: true }) : Response.json({ ok: false, error: 'This brief copy cannot be sent again here.' }, { status: 409 });
  } catch {
    return Response.json({ ok: false, error: 'The brief copy could not be sent. Please try again.' }, { status: 503 });
  }
};
