import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { agreementSession, agreementJson, signingEnabled } from '~/lib/agreement-access';
import { agreementRequest, nativeAgreementResponse } from '~/lib/agreement-request';
import { getLinkedOffer } from '~/lib/software-offers';
import { reviewAgreements, offerAgreements } from '~/lib/software-agreements';
export const prerender=false;
export const GET:APIRoute=async({request,locals,params,url})=>{
 const db=locals.runtime.env.MUSIC_DB,offer=db&&params.token?await getLinkedOffer(db,params.token):null;
 const session=db&&offer?await agreementSession(db,request,'agreement',offer.id):null;
 if(!db||!offer||!session||!await signingEnabled(db))return agreementJson({ok:false},401);
 const document=(await offerAgreements(db,offer.id)).find(d=>d.id===url.searchParams.get('document')&&d.review_session_hash===session.token_hash);
 if(!document)return agreementJson({ok:false},404);
 return new Response(document.canonical_text,{headers:{'content-type':'text/plain; charset=utf-8','content-disposition':`attachment; filename="${document.kind}-review.txt"`,'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
};
export const POST:APIRoute=async({request,locals,params})=>{
 const db=locals.runtime.env.MUSIC_DB;if(!db)return agreementJson({ok:false},503);
 const body=await agreementRequest(request);if(body instanceof Response)return body;
 const input=z.object({csrf_nonce:z.string().min(1),values:z.unknown()}).safeParse(body);
 const offer=params.token?await getLinkedOffer(db,params.token):null,session=offer?await agreementSession(db,request,'agreement',offer.id):null;
 if(!await signingEnabled(db)||!session)return agreementJson({ok:false,error:'Request a fresh code, then review the agreement again.'},401);
 if(!input.success || input.data.csrf_nonce!==session.csrf_nonce)return agreementJson({ok:false,error:'Reload and try again.'},403);
 try{return nativeAgreementResponse(request,agreementJson({ok:true,...await reviewAgreements(db,offer!,session,input.data.values)}),`/offer/${params.token}/sign?review=1`);}catch(error){return agreementJson({ok:false,error:error instanceof Error?error.message:'The agreement could not be reviewed.'},409);}
};
