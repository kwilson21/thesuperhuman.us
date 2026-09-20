import type { APIRoute } from 'astro';
import { eventSchema, PlaybackSequenceError, saveEvent } from '~/lib/music-demand';
import { loadMusicCatalog } from '~/lib/music-content';
import { musicRequest, musicUnavailable } from '~/lib/music-request';
import { resolveCampaignTag } from '~/lib/owner-campaigns';
import { checkRateLimit } from '~/lib/rate-limit';
export const prerender = false;

function locationPart(value: unknown) {
  return typeof value === 'string' && value.length <= 80 && !/[\u0000-\u001f]/.test(value) ? value : '';
}

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request); if (body instanceof Response) return body;
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  if (locals.runtime.env.MUSIC_EVENTS_ENABLED === 'false') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
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
    const tag = await resolveCampaignTag(env.MUSIC_DB, input);
    const cf = (request as Request & { cf?: { country?: string; region?: string; city?: string; botManagement?: { verifiedBot?: boolean } } }).cf;
    const automated = cf?.botManagement?.verifiedBot === true || /bot|crawler|spider|slurp|preview/i.test(request.headers.get('user-agent') ?? '');
    await saveEvent(env.MUSIC_DB, { ...input, mediaDurationSeconds: Math.round(recording.duration) }, {
      trafficClass: automated ? 'automated' : 'human',
      ...(tag ?? {}),
      country: locationPart(cf?.country), region: locationPart(cf?.region), city: locationPart(cf?.city),
    });
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof PlaybackSequenceError) return Response.json({ ok: false }, { status: 409 });
    return musicUnavailable();
  }
};
