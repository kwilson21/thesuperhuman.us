import type { APIRoute } from 'astro';
import { clientPortalEnabled, studioSessionFromRequest } from '~/lib/audio-client-access';
import { clientProjectFile, recordProjectFileAccess, streamClientProjectFile } from '~/lib/audio-project-files';

export const prerender = false;
const hidden = () => new Response('File not found', { status: 404, headers: { 'cache-control': 'private, no-store' } });

const serve: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!clientPortalEnabled(env)) return hidden();
  if (!env.MUSIC_DB || !env.AUDIO) return new Response('Private audio is temporarily unavailable', { status: 503, headers: { 'cache-control': 'private, no-store' } });
  const token = studioSessionFromRequest(request);
  if (!token || !params.id || !params.fileId) return hidden();
  const download = new URL(request.url).searchParams.get('download') === '1';
  try {
    const file = await clientProjectFile(env.MUSIC_DB, params.id, params.fileId, token);
    if (!file || (download && !file.downloadable)) return hidden();
    const response = await streamClientProjectFile(request, env.AUDIO, file, download);
    if (request.method === 'GET' && (response.status === 200 || response.status === 206)) {
      await recordProjectFileAccess(env.MUSIC_DB, file.id, token, download);
    }
    return response;
  } catch {
    return new Response('Private audio is temporarily unavailable', { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
};

export const GET = serve;
export const HEAD = serve;
