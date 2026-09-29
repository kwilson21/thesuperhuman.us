import type { APIRoute } from 'astro';
import { clientPortalEnabled, clientSoftwareProjectForSession, studioSessionFromRequest } from '~/lib/audio-client-access';
import { softwareDecisionInput, postSoftwareReviewDecision } from '~/lib/software-project-messages';
import { musicRequest } from '~/lib/music-request';
export const prerender = false;
export const POST: APIRoute = async ({params,request,locals}) => {
  const json = (body:unknown,status=200) => Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
  const env = locals.runtime.env;
  if (!clientPortalEnabled(env)) return json({ok:false},404);
  if (!env.MUSIC_DB) return json({ok:false},503);
  const token = studioSessionFromRequest(request);
  if (!token) return json({ok:false},401);
  if (!params.id || !params.updateId || !await clientSoftwareProjectForSession(env.MUSIC_DB,token,params.id)) return json({ok:false},404);
  const body = await musicRequest(request,16000); if (body instanceof Response) return body;
  const parsed = softwareDecisionInput.safeParse(body);
  if (!parsed.success) return json({ok:false,error:'Check the decision, named checks and notes (up to 2,000 characters).'},400);
  try {
    const result = await postSoftwareReviewDecision(env.MUSIC_DB,params.id,token,params.updateId,parsed.data);
    return json(result,result.status);
  } catch { return json({ok:false,error:'This review changed or already has a decision. Reload before trying again.'},409); }
};
