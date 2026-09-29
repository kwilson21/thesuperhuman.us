import type { APIRoute } from 'astro';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { readBodyWithin } from '~/lib/audio-project-uploads';
import { softwareAudit, softwareGuard, openSoftwareGuard } from '~/lib/software-projects';
import { softwareVisualLimit, softwareVisualTypes, softwareVisualMatches, softwareVisualKey, softwareVisualHeaders as headers } from '~/lib/software-visuals';
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.owner) return new Response(null, { status: 403, headers });
  const env = locals.runtime.env;
  if (!clientPortalEnabled(env)) return new Response(null, { status: 404, headers });
  if (!env.MUSIC_DB || !env.AUDIO) return new Response(null, { status: 503, headers });
  const row = await env.MUSIC_DB.prepare('SELECT visual_key,visual_media_type FROM software_project_updates WHERE id=? AND request_id=?').bind(params.updateId, params.id).first<{ visual_key: string | null; visual_media_type: string }>();
  if (!row?.visual_key || !softwareVisualKey(row.visual_key, params.id!, params.updateId!)) return new Response(null, { status: 404, headers });
  const object = await env.AUDIO.get(row.visual_key);
  return object ? new Response(object.body, { headers: { ...headers, 'content-type': row.visual_media_type } }) : new Response(null, { status: 404, headers });
};
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  if (!locals.owner) return json({ ok: false }, 403);
  const env = locals.runtime.env, db = env.MUSIC_DB, bucket = env.AUDIO, id = params.id, updateId = params.updateId;
  if (!clientPortalEnabled(env)) return json({ ok: false }, 404);
  if (!db || !bucket || !id || !updateId) return json({ ok: false }, 503);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ ok: false }, 403);
  const type = request.headers.get('content-type') ?? '', ext = softwareVisualTypes[type as keyof typeof softwareVisualTypes];
  if (!ext) return json({ ok: false, error: 'Choose a PNG, JPEG or WebP image.' }, 415);
  if (!request.body || Number(request.headers.get('content-length')) > softwareVisualLimit) return json({ ok: false, error: 'Use an image of 5 MB or less.' }, 413);
  const bytes = await readBodyWithin(request.body, softwareVisualLimit);
  if (!bytes) return json({ ok: false, error: 'Use an image of 5 MB or less.' }, 413);
  if (!softwareVisualMatches(bytes, type)) return json({ ok: false, error: 'The image does not match its file type.' }, 400);
  const draft = await db.prepare("SELECT visual_key,visual_alt,updated_at FROM software_project_updates WHERE id=? AND request_id=? AND status='draft'").bind(updateId, id).first<{ visual_key: string | null; visual_alt: string; updated_at: string }>();
  if (!draft) return json({ ok: false }, 404);
  if (!draft.visual_alt) return json({ ok: false, error: 'Save an image description before uploading.' }, 400);
  if (request.headers.get('if-unmodified-since') !== draft.updated_at) return json({ ok: false, error: 'The draft changed. Reload before uploading.' }, 409);
  const key = `software/${id}/${updateId}/${crypto.randomUUID()}.${ext}`;
  const at = new Date(Math.max(Date.now(), Date.parse(draft.updated_at) + 1)).toISOString();
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
      await db.batch([openSoftwareGuard(db, id), softwareGuard(db, "SELECT 1 FROM software_project_updates WHERE id=? AND request_id=? AND status='draft' AND updated_at=?", [updateId, id, draft.updated_at]),
        db.prepare('UPDATE software_project_updates SET visual_key=?,visual_media_type=?,updated_at=? WHERE id=?').bind(key, type, at, updateId),
        softwareAudit(db, id, 'visual-replaced', locals.owner.email, at)]);
    } catch { await bucket.delete(key); return json({ ok: false, error: 'The draft changed. The visual was not replaced.' }, 409); }
    if (draft.visual_key && softwareVisualKey(draft.visual_key, id, updateId)) {
      try { await bucket.delete(draft.visual_key); } catch { return json({ ok: true, updatedAt: at, cleanupPending: true, error: 'Visual saved. The old object needs manual cleanup.' }); }
    }
    return json({ ok: true, updatedAt: at });
  } catch { return json({ ok: false, error: 'The visual could not be stored. Please try again.' }, 503); }
};
