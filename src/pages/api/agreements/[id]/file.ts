import type { APIRoute } from 'astro';
import { agreementDownload } from '~/lib/agreement-download';
export const prerender=false;
export const GET:APIRoute=async({locals,request,params})=>agreementDownload(locals.runtime.env,request,params.id!);
