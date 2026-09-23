import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled, clientProjectForSession, studioSessionFromRequest } from '~/lib/audio-client-access';
import { clientMessageRateLimited, markProjectMessagesRead, postClientProjectMessage, validateProjectMessage } from '~/lib/audio-project-messages';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.unknown() }),
  z.object({ action: z.literal('read'), messageId: z.number().int().positive() }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB) return Response.json({ ok: false, error: 'Studio messages are temporarily unavailable.' }, { status: 503 });
  const token = studioSessionFromRequest(request);
  if (!token || !params.id) return Response.json({ ok: false }, { status: 401 });
  const body = await musicRequest(request, 8192);
  if (body instanceof Response) return body;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Check your message and try again.' }, { status: 400 });
  try {
    const project = await clientProjectForSession(env.MUSIC_DB, token, params.id);
    if (!project) return Response.json({ ok: false }, { status: 404 });
    if (parsed.data.action === 'read') {
      await markProjectMessagesRead(env.MUSIC_DB, params.id, 'client', parsed.data.messageId, token);
      return Response.json({ ok: true });
    }
    const message = validateProjectMessage(parsed.data.body);
    if (!message) return Response.json({ ok: false, error: 'Write up to 4,000 characters. Shared links must start with https://.' }, { status: 400 });
    const saved = await postClientProjectMessage(env.MUSIC_DB, params.id, token, message);
    if (!saved) {
      if (await clientMessageRateLimited(env.MUSIC_DB, token)) {
        return Response.json({ ok: false, error: 'Please wait a few minutes before sending another message.' }, { status: 429 });
      }
      return Response.json({ ok: false }, { status: 409 });
    }
    return Response.json({ ok: true, message: saved });
  } catch {
    return Response.json({ ok: false, error: 'Your message could not be saved. Please try again.' }, { status: 503 });
  }
};
