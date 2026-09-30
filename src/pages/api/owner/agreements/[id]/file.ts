import type { APIRoute } from 'astro';
import { agreementDownload } from '~/lib/agreement-download';
export const prerender = false;
export const GET: APIRoute = async ({ locals, request, params }) =>
  locals.owner
    ? agreementDownload(locals.runtime.env, request, params.id!, true)
    : new Response('Owner access required.', { status: 403 });
