import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { completeAgreementCode, agreementJson } from '~/lib/agreement-access';
import { agreementRequest, nativeAgreementResponse } from '~/lib/agreement-request';
export const prerender=false;
export const POST:APIRoute=async({request,locals})=>{
 const body=await agreementRequest(request,4096);if(body instanceof Response)return body;
 const input=z.object({challenge_id:z.string().uuid(),code:z.string().regex(/^\d{8}$/)}).safeParse(body);
 if(!input.success)return agreementJson({ok:false,error:'Enter the eight-digit code.'},400);
 try{return nativeAgreementResponse(request,await completeAgreementCode(locals.runtime.env,request,input.data),'/agreements');}catch{return agreementJson({ok:false,error:'Agreement sign-in is temporarily unavailable.'},503);}
};
