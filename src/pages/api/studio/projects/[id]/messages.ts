import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled, clientProjectForSession, studioSessionFromRequest } from '~/lib/audio-client-access';
import { clientMessageRateLimited, markProjectMessagesRead, postClientProjectMessage, postClientReviewDecision, validateProjectMessage } from '~/lib/audio-project-messages';
import { musicRequest } from '~/lib/music-request';

export const prerender = false;
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.unknown() }),
  z.object({ action: z.literal('read'), messageId: z.number().int().positive() }),
  // Approval needs no notes; a change request does.
  z.object({ action: z.literal('respond'), decision: z.enum(['approved', 'changes']), body: z.unknown() }),
]);
const approvalText = 'I approve this mix.';

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
    if (parsed.data.action === 'respond') {
      const { decision } = parsed.data;
      const notes = typeof parsed.data.body === 'string' && parsed.data.body.trim() ? validateProjectMessage(parsed.data.body) : null;
      if (decision === 'changes' && !notes) return Response.json({ ok: false, error: 'Write the changes you would like, up to 4,000 characters.' }, { status: 400 });
      if (typeof parsed.data.body === 'string' && parsed.data.body.trim() && !notes) return Response.json({ ok: false, error: 'Write up to 4,000 characters. Shared links must start with https://.' }, { status: 400 });
      const saved = await postClientReviewDecision(env.MUSIC_DB, params.id, token, decision, notes ?? approvalText);
      if (!saved) {
        if (await clientMessageRateLimited(env.MUSIC_DB, params.id)) {
          return Response.json({ ok: false, error: 'Please wait a few minutes before sending another message.' }, { status: 429 });
        }
        return Response.json({ ok: false, error: 'This review already has your answer. Send a message if anything changed.' }, { status: 409 });
      }
      return Response.json({ ok: true, message: saved });
    }
    const message = validateProjectMessage(parsed.data.body);
    if (!message) return Response.json({ ok: false, error: 'Write up to 4,000 characters. Shared links must start with https://.' }, { status: 400 });
    const saved = await postClientProjectMessage(env.MUSIC_DB, params.id, token, message);
    if (!saved) {
      if (await clientMessageRateLimited(env.MUSIC_DB, params.id)) {
        return Response.json({ ok: false, error: 'Please wait a few minutes before sending another message.' }, { status: 429 });
      }
      return Response.json({ ok: false }, { status: 409 });
    }
    return Response.json({ ok: true, message: saved });
  } catch {
    return Response.json({ ok: false, error: 'Your message could not be saved. Please try again.' }, { status: 503 });
  }
};
