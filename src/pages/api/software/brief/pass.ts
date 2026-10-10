import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { musicRequest } from '~/lib/music-request';
import { verifyTurnstile } from '~/lib/turnstile';
import { createSuggestionPass, suggestionPassCookie } from '~/lib/brief-suggestion-pass';
export const prerender = false;
const schema = z.object({ token: z.string().min(1).max(2048) }).strict();
export const POST: APIRoute = async ({ request, locals }) => {
  const headers = new Headers({ 'cache-control': 'no-store' });
  try {
    const env = locals.runtime?.env;
    const ip = request.headers.get('cf-connecting-ip');
    if (!env?.TURNSTILE_SECRET_KEY || env.SOFTWARE_SUGGESTIONS_ENABLED !== 'true' || !ip) return Response.json({ ok: false }, { headers });
    const parsed = schema.safeParse(await musicRequest(request, 4096));
    if (!parsed.success || !await verifyTurnstile(parsed.data.token, env.TURNSTILE_SECRET_KEY, ip)) return Response.json({ ok: false }, { headers });
    headers.set('set-cookie', `${suggestionPassCookie}=${await createSuggestionPass(env.TURNSTILE_SECRET_KEY, ip)}; Path=/api/software/brief; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`);
    return Response.json({ ok: true }, { headers });
  } catch { return Response.json({ ok: false }, { headers }); }
};
