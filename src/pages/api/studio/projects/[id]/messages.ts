import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clientPortalEnabled, clientProjectForSession, hashValue, studioSessionFromRequest } from '~/lib/audio-client-access';
import { markProjectMessagesRead, postClientProjectMessage, validateProjectMessage } from '~/lib/audio-project-messages';
import { musicRequest } from '~/lib/music-request';
import { checkRateLimit } from '~/lib/rate-limit';

export const prerender = false;
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), body: z.unknown() }),
  z.object({ action: z.literal('read'), messageId: z.number().int().positive() }),
]);

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return new Response('Not found', { status: 404 });
  if (!env.MUSIC_DB || !env.RATE_LIMIT) return Response.json({ ok: false, error: 'Studio messages are temporarily unavailable.' }, { status: 503 });
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
    const key = await hashValue(token);
    const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
    const [sessionLimit, ipLimit] = await Promise.all([
      checkRateLimit(env.RATE_LIMIT, key, 'rl:studio-message-session:', 12, { consume: false }),
      checkRateLimit(env.RATE_LIMIT, ip, 'rl:studio-message-ip:', 30, { consume: false }),
    ]);
    if (!sessionLimit.allowed || !ipLimit.allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending another message.' }, { status: 429 });
    const saved = await postClientProjectMessage(env.MUSIC_DB, params.id, token, message);
    if (!saved) return Response.json({ ok: false }, { status: 409 });
    const counted = await Promise.allSettled([
      checkRateLimit(env.RATE_LIMIT, key, 'rl:studio-message-session:', 12),
      checkRateLimit(env.RATE_LIMIT, ip, 'rl:studio-message-ip:', 30),
    ]);
    if (counted.some(result => result.status === 'rejected')) console.error('Studio message rate-limit update failed.');
    return Response.json({ ok: true, message: saved });
  } catch {
    return Response.json({ ok: false, error: 'Your message could not be saved. Please try again.' }, { status: 503 });
  }
};
