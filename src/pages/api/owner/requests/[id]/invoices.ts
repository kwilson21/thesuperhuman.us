import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { musicRequest } from '~/lib/music-request';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { stripeAvailable } from '~/lib/stripe-invoicing';
import { reserveSoftwareInvoice, createSoftwareInvoice, recordSoftwareInvoice } from '~/lib/software-invoices';
import { projectTerms } from '~/lib/software-projects';
export const prerender=false;
const schema=z.object({offer_id:z.string().min(1),milestone_index:z.number().int().min(0).max(2),kind:z.enum(['deposit','balance','milestone']),allow_card:z.boolean(),retry_id:z.string().optional(),replace_id:z.string().optional()})
  .refine(value=>!(value.retry_id && value.replace_id));
export const POST: APIRoute=async({params,request,locals})=>{
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
  if(!locals.owner) return json({ok:false},403);
  const env=locals.runtime.env,db=env.MUSIC_DB,id=params.id;
  if(!clientPortalEnabled(env)) return json({ok:false},404);
  if(!db || !id || !stripeAvailable(env)) return json({ok:false,error:'Stripe invoice creation is unavailable.'},503);
  const body=await musicRequest(request);if(body instanceof Response)return body;
  const parsed=schema.safeParse(body);if(!parsed.success)return json({ok:false},400);
  let reserved=false;
  try {
    const command=parsed.data;
    const invoice=await reserveSoftwareInvoice(db,{requestId:id,offerId:command.offer_id,milestone:command.milestone_index,kind:command.kind,allowCard:command.allow_card,actor:locals.owner.email,retryId:command.retry_id,replaceId:command.replace_id});
    reserved=true;
    const recipient=await db.prepare('SELECT name,email FROM owner_requests WHERE id=?').bind(id).first<{name:string;email:string}>();
    const offer=await db.prepare('SELECT terms_json FROM software_offers WHERE id=? AND request_id=?').bind(invoice.offer_id,id).first<{terms_json:string}>();
    if(!recipient?.email || !offer)throw new Error('Invoice recovery is pending.');
    const result=await createSoftwareInvoice(env,recipient,projectTerms(offer),invoice);
    await recordSoftwareInvoice(db,invoice,result);
    return json({ok:true});
  } catch(error) {
    return json({ok:false,error:reserved ? 'Invoice creation is unconfirmed. Reload, check Stripe, then retry the same attempt.' : error instanceof Error ? error.message : 'Could not reserve invoice.'},reserved ? 502 : 409);
  }
};
