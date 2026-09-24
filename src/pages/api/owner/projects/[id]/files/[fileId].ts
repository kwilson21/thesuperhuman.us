import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { deliverProjectUpdateNotice } from '~/lib/audio-project-updates';
import { publishProjectFile } from '~/lib/audio-project-publishing';
import { revokeProjectFile } from '~/lib/audio-project-revocation';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), note: z.string().trim().min(1).max(1000), downloadable: z.boolean() }),
  z.object({ action: z.literal('revoke'), note: z.string().trim().max(1000) }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !locals.runtime.ctx || !params.id || !params.fileId) {
    return Response.json({ ok: false, error: 'File publication is temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 8192);
  if (body instanceof Response) return body;
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Check the file action and try again.' }, { status: 400 });
  try {
    if (parsed.data.action === 'revoke') {
      const revoked = await revokeProjectFile(env.MUSIC_DB, params.id, params.fileId, locals.owner.email, parsed.data.note);
      if (!revoked) return Response.json({ ok: false, error: 'This file cannot be revoked here. A shared file needs a short note to the client.' }, { status: 409 });
      if (revoked.updateId) locals.runtime.ctx.waitUntil(deliverProjectUpdateNotice(env.MUSIC_DB, revoked.updateId, env)
        .catch(() => console.error('Studio file revocation notice state is uncertain.')));
      return Response.json({ ok: true });
    }
    if (!env.AUDIO) return Response.json({ ok: false, error: 'File publication is temporarily unavailable.' }, { status: 503 });
    const updateId = await publishProjectFile(env.MUSIC_DB, env.AUDIO, params.id, params.fileId,
      locals.owner.email, parsed.data.note, parsed.data.downloadable);
    if (!updateId) return Response.json({ ok: false, error: 'This file cannot be published yet. Check the project and payment state.' }, { status: 409 });
    locals.runtime.ctx.waitUntil(deliverProjectUpdateNotice(env.MUSIC_DB, updateId, env)
      .catch(() => console.error('Studio file notice state is uncertain.')));
    return Response.json({ ok: true, updateId });
  } catch {
    return Response.json({ ok: false, error: 'The file could not be published. Please try again.' }, { status: 503 });
  }
};
