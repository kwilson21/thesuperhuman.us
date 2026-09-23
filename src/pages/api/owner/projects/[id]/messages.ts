import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { markProjectMessagesRead, postOwnerProjectMessage, validateProjectMessage } from '~/lib/audio-project-messages';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.unknown() }),
  z.object({ action: z.literal('read'), messageId: z.number().int().positive() }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.owner) return Response.json({ ok: false }, { status: 403 });
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB) return Response.json({ ok: false, error: 'Project messages are temporarily unavailable.' }, { status: 503 });
  if (!params.id) return Response.json({ ok: false }, { status: 404 });
  const body = await musicRequest(request, 8192);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Check your message and try again.' }, { status: 400 });
  try {
    const project = await env.MUSIC_DB.prepare('SELECT request_id FROM audio_projects WHERE request_id=?').bind(params.id).first();
    if (!project) return Response.json({ ok: false }, { status: 404 });
    if (parsed.data.action === 'read') {
      await markProjectMessagesRead(env.MUSIC_DB, params.id, 'owner', parsed.data.messageId);
      return Response.json({ ok: true });
    }
    const message = validateProjectMessage(parsed.data.body);
    if (!message) return Response.json({ ok: false, error: 'Write up to 4,000 characters. Shared links must start with https://.' }, { status: 400 });
    const saved = await postOwnerProjectMessage(env.MUSIC_DB, params.id, locals.owner.email, message);
    if (!saved) return Response.json({ ok: false }, { status: 409 });
    return Response.json({ ok: true, message: saved });
  } catch {
    return Response.json({ ok: false, error: 'Your message could not be saved. Please try again.' }, { status: 503 });
  }
};
