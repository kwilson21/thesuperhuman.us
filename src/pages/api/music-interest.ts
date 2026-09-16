import type { APIRoute } from 'astro';
import { interestSchema, saveInterest } from '~/lib/music-demand';
import { loadMusicCatalog } from '~/lib/music-content';
import { musicRequest, musicUnavailable } from '~/lib/music-request';
import { verifyTurnstile } from '~/lib/turnstile';
import { checkRateLimit } from '~/lib/rate-limit';
export const prerender = false;
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await musicRequest(request); if (body instanceof Response) return body;
  const parsed = interestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, errors: Object.fromEntries(parsed.error.issues.map(i => [i.path[0] ?? '_form', i.message])) }, { status: 400 });
  const input = parsed.data;
  const catalog = await loadMusicCatalog();
  if (!catalog.releases.some(r => r.id === input.releaseId)) return Response.json({ ok: false }, { status: 404 });
  const env = locals.runtime.env;
  if (!env.MUSIC_DB || !env.TURNSTILE_SECRET_KEY) return musicUnavailable();
  const ip = request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  try {
    if (!(await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip))) return Response.json({ ok: false, error: 'Verification expired. Please try again.' }, { status: 403 });
    if (!(await checkRateLimit(env.RATE_LIMIT, ip, 'rl:music-interest:')).allowed) return Response.json({ ok: false, error: 'Please wait a few minutes before sending another request.' }, { status: 429 });
    try { await saveInterest(env.MUSIC_DB, input); }
    catch (error) { await env.RATE_LIMIT.delete(`rl:music-interest:${ip}`); throw error; }
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch { return musicUnavailable(); }
};
