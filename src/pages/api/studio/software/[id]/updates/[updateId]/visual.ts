import type { APIRoute } from 'astro';
import { clientPortalEnabled, clientSoftwareProjectForSession, studioSessionFromRequest } from '~/lib/audio-client-access';
import { softwareVisualKey, softwareVisualHeaders as headers } from '~/lib/software-visuals';
export const prerender = false;
export const GET: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime.env, token = studioSessionFromRequest(request);
  if (!clientPortalEnabled(env)) return new Response(null, { status: 404, headers });
  if (!env.MUSIC_DB || !env.AUDIO) return new Response(null, { status: 503, headers });
  if (!token || !params.id || !await clientSoftwareProjectForSession(env.MUSIC_DB, token, params.id)) return new Response(null, { status: 404, headers });
  const row = await env.MUSIC_DB.prepare("SELECT visual_key,visual_media_type FROM software_project_updates WHERE id=? AND request_id=? AND status='shared'").bind(params.updateId, params.id).first<{ visual_key: string | null; visual_media_type: string }>();
  if (!row?.visual_key || !softwareVisualKey(row.visual_key, params.id, params.updateId!)) return new Response(null, { status: 404, headers });
  const object = await env.AUDIO.get(row.visual_key);
  return object ? new Response(object.body, { headers: { ...headers, 'content-type': row.visual_media_type } }) : new Response(null, { status: 404, headers });
};
