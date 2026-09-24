import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { deliverProjectUpdateNotice, queueProjectNoticeForDelivery, saveProjectUpdate, validProjectDate } from '~/lib/audio-project-updates';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const note = z.string().trim().min(1).max(1000);
const date = z.string().refine(validProjectDate);
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), dueDate: date, body: note }),
  z.object({ action: z.literal('progress'), body: note }),
  z.object({ action: z.literal('start_work'), body: note }),
  z.object({ action: z.literal('revise_date'), dueDate: date,
    reason: z.enum(['protect_song', 'client_clarification', 'schedule_conflict']), body: note }),
  z.object({ action: z.literal('retry_email'), updateId: z.number().int().positive(), confirmedNotSent: z.boolean().optional() }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !locals.runtime.ctx || !params.id) {
    return Response.json({ ok: false, error: 'Project updates are temporarily unavailable.' }, { status: 503 });
  }
  const body = await musicRequest(request, 8192);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Check the update and try again.' }, { status: 400 });
  try {
    if (parsed.data.action === 'retry_email') {
      const requeued = await queueProjectNoticeForDelivery(env.MUSIC_DB, params.id, parsed.data.updateId, parsed.data.confirmedNotSent);
      if (!requeued) return Response.json({ ok: false, error: 'This email cannot be retried here.' }, { status: 409 });
      locals.runtime.ctx.waitUntil(deliverProjectUpdateNotice(env.MUSIC_DB, parsed.data.updateId, env)
        .catch(() => console.error('Studio update email state is uncertain.')));
      return Response.json({ ok: true });
    }
    const update = await saveProjectUpdate(env.MUSIC_DB, params.id, locals.owner.email, parsed.data);
    if (!update) return Response.json({ ok: false, error: 'This project cannot take that update right now.' }, { status: 409 });
    locals.runtime.ctx.waitUntil(deliverProjectUpdateNotice(env.MUSIC_DB, update.id, env)
      .catch(() => console.error('Studio update email state is uncertain.')));
    return Response.json({ ok: true, update });
  } catch {
    return Response.json({ ok: false, error: 'The project update could not be saved. Please try again.' }, { status: 503 });
  }
};
