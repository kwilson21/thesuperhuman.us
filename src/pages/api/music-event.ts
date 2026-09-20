import type { APIRoute } from 'astro';
import { eventSchema, saveEvent } from '~/lib/music-demand';
import { loadMusicCatalog } from '~/lib/music-content';
import { musicRequest, musicUnavailable } from '~/lib/music-request';
import { checkRateLimit } from '~/lib/rate-limit';
export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request); if (body instanceof Response) return body;
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const input = parsed.data;
  const catalog = await loadMusicCatalog();
  const release = catalog.releases.find(r => r.id === input.releaseId);
  const recording = catalog.recordings.find(r => r.id === input.recordingId);
  if (!release?.tracks.includes(input.recordingId) || !recording || (input.medium === 'video' && !recording.versions.video && !recording.youtubeId)) return Response.json({ ok: false }, { status: 404 });
  const env = locals.runtime.env;
  if (!env.MUSIC_DB) return musicUnavailable();
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    if (!(await checkRateLimit(env.RATE_LIMIT, ip, 'rl:music-event-all:', 240)).allowed) return Response.json({ ok: false }, { status: 429 });
    const prefix = `rl:music-event:${input.releaseId}:${input.recordingId}:${input.medium}:${input.event}:`;
    if (!(await checkRateLimit(env.RATE_LIMIT, ip, prefix, 60)).allowed) return Response.json({ ok: false }, { status: 429 });
    await saveEvent(env.MUSIC_DB, input);
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch { return musicUnavailable(); }
};
