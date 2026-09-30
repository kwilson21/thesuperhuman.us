import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { agreementRequest, nativeAgreementResponse } from '~/lib/agreement-request';
import { agreementJson, signingEnabled } from '~/lib/agreement-access';
import { countersignAgreements } from '~/lib/software-agreements';
import { cleanText } from '~/lib/agreement-fields';
import { prepareAgreementArtifact, deliverAgreementCopies, deliverAgreementNotifications, recoverAgreementRendering } from '~/lib/agreement-artifacts';
import { softwareGuard } from '~/lib/software-projects';
import type { SoftwareOffer } from '~/lib/software-offers';
export const prerender=false;
const documents=z.array(z.object({id:z.string().uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(2);
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('countersign'),documents,typed_name:cleanText(200).refine(Boolean),consent:z.literal(true),authority:z.literal(true),intent:z.literal(true)}),
 z.object({action:z.literal('abandon'),documents,reason:cleanText(1000).refine(Boolean),confirmed:z.literal(true)}),
 z.object({action:z.enum(['retry-artifact','retry-copy']),agreement_id:z.string().uuid(),confirmedNotSent:z.boolean().default(false),expectedAttempt:z.string().uuid().optional(),confirmedStale:z.boolean().default(false)}),
 z.object({action:z.literal('record-alternate-copy'),agreement_id:z.string().uuid(),role:z.enum(['client','contractor']),method:cleanText(200).refine(Boolean),confirmed:z.literal(true)}),
 z.object({action:z.literal('hold'),agreement_id:z.string().uuid(),held:z.boolean()}),
 z.object({action:z.literal('end'),agreement_id:z.string().uuid(),ended_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),confirmed:z.literal(true)}),
]);
export const POST:APIRoute=async({request,locals,params})=>{
 const db=locals.runtime.env.MUSIC_DB;if(!locals.owner)return agreementJson({ok:false},403);if(!db||!params.id)return agreementJson({ok:false},503);
 const body=await agreementRequest(request);if(body instanceof Response)return body;const parsed=schema.safeParse(body);if(!parsed.success)return agreementJson({ok:false,error:'Complete the required confirmations.'},400);
 const c=parsed.data,at=new Date().toISOString();
 const offer=await db.prepare("SELECT * FROM software_offers WHERE request_id=? AND status='sent'").bind(params.id).first<SoftwareOffer>();
 try {
  if(c.action==='countersign') {
   if(!offer||!await signingEnabled(db))return agreementJson({ok:false,error:'Signing is off or the offer changed.'},409);
   const id=await countersignAgreements(db,offer,c.documents,c.typed_name,locals.owner.email,request);
   try {const {renderAgreementPacket}=await import('~/lib/agreement-pdf');const msa=await db.prepare('SELECT msa_id FROM software_agreements WHERE id=?').bind(id).first<{msa_id:string|null}>();if(msa?.msa_id)await prepareAgreementArtifact(locals.runtime.env,msa.msa_id,renderAgreementPacket);await prepareAgreementArtifact(locals.runtime.env,id,renderAgreementPacket);await deliverAgreementCopies(locals.runtime.env,id);}catch { /* Persisted execution is safe; owner retries copy preparation. */ }
   // Artifact work is explicit and retryable. It never changes the recorded signatures.
   return nativeAgreementResponse(request,agreementJson({ok:true,message:'Signed by both parties. Copy preparation needs attention.'}),`/owner/requests/${params.id}`);
  }
  if(c.action==='abandon') {
   if(!offer)return agreementJson({ok:false},409);
   await db.batch(c.documents.flatMap(d=>[softwareGuard(db,"SELECT 1 FROM software_agreements WHERE id=? AND request_id=? AND text_sha256=? AND status='client_signed'",[d.id,params.id!,d.hash]),db.prepare("UPDATE software_agreements SET status='abandoned',abandoned_at=?,abandoned_reason=? WHERE id=?").bind(at,c.reason,d.id)]));
  }else {
   const agreement=await db.prepare('SELECT status,kind FROM software_agreements WHERE id=? AND request_id=?').bind(c.agreement_id,params.id).first<{status:string;kind:string}>();if(!agreement)return agreementJson({ok:false},404);
   if(c.action==='retry-copy') {await db.prepare("UPDATE software_agreement_deliveries SET status='pending' WHERE agreement_id=? AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))").bind(c.agreement_id,c.confirmedNotSent?1:0,new Date(Date.now()-60000).toISOString()).run();await db.prepare("UPDATE software_agreement_notifications SET status='pending' WHERE agreement_id=? AND (status='failed' OR (status='sending' AND ?=1 AND attempted_at<=?))").bind(c.agreement_id,c.confirmedNotSent?1:0,new Date(Date.now()-60000).toISOString()).run();await deliverAgreementNotifications(locals.runtime.env,c.agreement_id);await deliverAgreementCopies(locals.runtime.env,c.agreement_id);}
   if(c.action==='retry-artifact') {
    if(c.expectedAttempt&&!await recoverAgreementRendering(db,c.agreement_id,c.expectedAttempt,c.confirmedStale))return agreementJson({ok:false,error:'Check the stale preparation attempt before recovery.'},409);
    // Loading the renderer is kept separate from committing legal execution.
    const {renderAgreementPacket}=await import('~/lib/agreement-pdf');
    const msa=await db.prepare('SELECT msa_id FROM software_agreements WHERE id=?').bind(c.agreement_id).first<{msa_id:string|null}>();
    if(msa?.msa_id)await prepareAgreementArtifact(locals.runtime.env,msa.msa_id,renderAgreementPacket);
    await prepareAgreementArtifact(locals.runtime.env,c.agreement_id,renderAgreementPacket);await deliverAgreementCopies(locals.runtime.env,c.agreement_id);
   }
   if(c.action==='record-alternate-copy') await db.prepare('UPDATE software_agreement_deliveries SET alternate_delivered_at=?,alternate_method=? WHERE agreement_id=? AND recipient_role=?').bind(at,c.method,c.agreement_id,c.role).run();
   if(c.action==='hold')await db.prepare('UPDATE software_agreements SET legal_hold=? WHERE id=?').bind(c.held?1:0,c.agreement_id).run();
   if(c.action==='end') {const end=new Date(`${c.ended_on}T12:00:00Z`);if(end.toISOString().slice(0,10)!==c.ended_on)throw new Error('Invalid date.');end.setUTCFullYear(end.getUTCFullYear()+10);await db.prepare("UPDATE software_agreements SET ended_at=?,retain_until=?,terminated_at=CASE WHEN kind='msa' THEN ? ELSE terminated_at END WHERE id=? AND status='executed'").bind(c.ended_on,end.toISOString(),c.ended_on,c.agreement_id).run();}
  }
  return nativeAgreementResponse(request,agreementJson({ok:true}),`/owner/requests/${params.id}`);
 }catch{return agreementJson({ok:false,error:'The agreement changed or the operation failed. Reload before retrying.'},409);}
};
