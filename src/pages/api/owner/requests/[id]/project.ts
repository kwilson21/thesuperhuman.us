import { agreementEvent } from '~/lib/agreement-events';
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { abandonUnsignedAgreementReviews, executedOfferAgreement, offerAgreements } from '~/lib/software-agreements';
import { validProjectDate } from '~/lib/audio-project-updates';
import { musicRequest } from '~/lib/music-request';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { getSoftwareProject, projectTerms, projectDate, softwareAudit, softwareGuard, openSoftwareGuard, deliverSoftwareNotice, queueSoftwareNotice, softwareAccessRevocation, recordMilestonePayment, acceptedDeliveryGuard, priorMilestonePaymentGuard, milestoneDepositGuard } from '~/lib/software-projects';
import { manualSoftwarePaymentGuard, manualPaymentReminder, payableSoftwareInvoice, listSoftwareInvoices } from '~/lib/software-invoices';
export const prerender = false;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), offer_id: z.string().min(1), offer_version: z.number().int().positive(), expectedRequestUpdatedAt: z.string().min(1), signature_source: z.enum(['website','external']), external_signed_on: z.string().optional(), external_parties: z.string().trim().max(500).optional(), external_copy_reference: z.string().trim().max(200).optional(), external_kept_copy: z.boolean().optional(), inputs_ready: z.literal(true), po_number: z.string().trim().max(100).optional(), earlier_start_on: z.string().optional(), earlier_start_agreement: z.string().trim().max(500).optional(), signatures: z.boolean(), payment: z.literal(true), deposit_invoice_id: z.string().optional(), next_update_on: projectDate }),
  z.object({ action: z.literal('state'), state: z.enum(['preparing','building','waiting_for_input','ready_for_review','complete']), waiting_for: z.string().trim().max(200), milestone_index: z.number().int().min(0).max(2), step: z.enum(['direction','build','review','handoff']), next_update_on: projectDate, expectedUpdatedAt: z.string() }),
  z.object({ action: z.literal('revoke'), confirmed: z.literal(true) }),
  z.object({ action: z.literal('notice'), updateId: z.string().optional(), confirmedNotSent: z.boolean().default(false) }),
  z.object({ action: z.literal('deposit'), milestone_index: z.number().int().min(1).max(2), confirmed: z.literal(true) }),
  z.object({ action: z.literal('payment'), milestone_index: z.number().int().min(0).max(2), confirmed: z.literal(true) }),
  z.object({ action: z.literal('complete'), confirmed: z.literal(true) }),
]);
export const POST: APIRoute = async ({ params, request, locals }) => {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
  if (!locals.owner) return json({ ok: false }, 403);
  const env = locals.runtime.env, db = env.MUSIC_DB, id = params.id;
  if (!clientPortalEnabled(env)) return json({ ok: false }, 404);
  if (!db || !id) return json({ ok: false }, 503);
  const input = await musicRequest(request); if (input instanceof Response) return input;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return json({ ok: false, error: 'Check both confirmations and the project fields.' }, 400);
  const command = parsed.data, actor = locals.owner.email;
  let at = new Date().toISOString();
  try {
    if (command.action === 'start') {
      if(command.signature_source==='external'&&(await offerAgreements(db,command.offer_id)).some(a=>a.status==='client_signed'||a.status==='executed'))return json({ok:false,error:'Finish the website signatures and retained copies before starting.'},409);
      const executed=command.signature_source==='website'?await executedOfferAgreement(db,command.offer_id):null;
      if(command.signature_source==='website'&&!executed)return json({ok:false,error:'Both signatures, the PDF and both delivered copies are required.'},409);
      if(command.signature_source==='external'&&(!command.signatures||!command.external_signed_on||!validProjectDate(command.external_signed_on)||!command.external_parties||!command.external_kept_copy||!command.external_copy_reference))return json({ok:false,error:'Record the signed date, parties and complete kept copy.'},400);
      const offerDetails=await db.prepare('SELECT agreement_details_json FROM software_offers WHERE id=?').bind(command.offer_id).first<{agreement_details_json:string|null}>();
      const details=offerDetails?.agreement_details_json?JSON.parse(offerDetails.agreement_details_json):null;
      if(details?.po_requirement==='before_start'&&!command.po_number)return json({ok:false,error:'Record the required purchase order before starting.'},400);
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if(details?.planned_start>today&&(!command.earlier_start_agreement||!command.earlier_start_on||!validProjectDate(command.earlier_start_on)||command.earlier_start_on>today))return json({ok:false,error:'Wait for the planned start or record the dated client agreement to start earlier.'},409);
      const external=command.signature_source==='external'?JSON.stringify({signed_on:command.external_signed_on,parties:command.external_parties,kept_copy:true,copy_reference:command.external_copy_reference}):null;
      await db.batch([
        ...(command.signature_source==='external'?[softwareGuard(db,"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements WHERE offer_id=? AND status IN ('client_signed','executed'))",[command.offer_id])]:[]),
        ...(executed?[softwareGuard(db,`SELECT 1 FROM software_agreements a JOIN software_agreement_artifacts f ON f.agreement_id=a.id WHERE a.id=? AND a.offer_id=? AND a.status='executed' AND a.ended_at IS NULL AND a.archive_closed_at IS NULL AND f.status='ready' AND (SELECT count(*) FROM software_agreement_deliveries d WHERE d.agreement_id=a.id AND (d.status='sent' OR d.alternate_delivered_at IS NOT NULL))=2`,[executed.id,command.offer_id])]:[]),
        softwareGuard(db, 'SELECT 1 FROM owner_requests WHERE id=? AND updated_at=?', [id, command.expectedRequestUpdatedAt]),
        softwareGuard(db, `SELECT 1 FROM owner_requests r JOIN software_offers o ON o.request_id=r.id
          WHERE r.id=? AND r.kind='software' AND r.status NOT IN ('withdrawn','resolved') AND r.email<>'' AND o.status='sent' AND o.id=? AND o.version=?
          AND NOT EXISTS(SELECT 1 FROM software_projects WHERE request_id=r.id)`, [id, command.offer_id, command.offer_version]),
        ...(command.deposit_invoice_id ? [softwareGuard(db,`SELECT 1 FROM software_invoices WHERE id=? AND request_id=? AND offer_id=? AND milestone_index=0 AND kind='deposit' AND status='paid' AND refunded_at IS NULL`,[command.deposit_invoice_id,id,command.offer_id])] : [manualSoftwarePaymentGuard(db,id,command.offer_id,0,true)]),
        ...(command.signature_source==='external'?[
          abandonUnsignedAgreementReviews(db,id,at),
          db.prepare('UPDATE software_agreement_sessions SET revoked_at=? WHERE offer_id=? AND revoked_at IS NULL').bind(at,command.offer_id),
          db.prepare('UPDATE software_agreement_challenges SET used_at=? WHERE offer_id=? AND used_at IS NULL').bind(at,command.offer_id),
          db.prepare('UPDATE software_offer_links SET revoked_at=? WHERE request_id=? AND revoked_at IS NULL').bind(at,id),
        ]:[]),
        db.prepare(`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,next_update_on,created_at,updated_at)
          SELECT request_id,id,terms_json,json_extract(terms_json,'$.paymentMode'),?,?,?,?,?,?,? FROM software_offers WHERE request_id=? AND status='sent' AND id=? AND version=?`)
          .bind(executed?.executed_at??`${command.external_signed_on}T12:00:00Z`, at, at, actor, command.next_update_on || null, at, at, id, command.offer_id, command.offer_version),
        db.prepare(`INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
          SELECT id,'reviewed',?,'',? FROM owner_requests WHERE id=? AND status='new'`).bind(actor.trim().toLowerCase(),at,id),
        db.prepare("UPDATE owner_requests SET status='reviewed',updated_at=? WHERE id=? AND status='new'").bind(at,id),
        db.prepare('UPDATE software_projects SET agreement_id=?,signature_source=?,external_signature_details_json=?,start_details_json=? WHERE request_id=?').bind(executed?.id??null,command.signature_source,external,JSON.stringify({inputs_ready:true,po_number:command.po_number??null,earlier_start_on:command.earlier_start_on??null,earlier_start_agreement:command.earlier_start_agreement??null,recorded_at:at,recorded_by:actor}),id),
        ...(command.signature_source==='external'?[agreementEvent(db,'external-signature-recorded',actor,at,null,command.offer_id)]:[]),
        softwareAudit(db, id, 'started', actor, at),
      ]);
      try { await deliverSoftwareNotice(db, id, env); } catch { return json({ ok: true, noticeUnchecked: true }); }
      return json({ ok: true });
    }
    const project = await getSoftwareProject(db, id); if (!project) return json({ ok: false }, 404);
    if (command.action === 'notice') {
      if (!await queueSoftwareNotice(db, id, command.confirmedNotSent, command.updateId)) return json({ ok: false, error: 'Check Resend before retrying an unconfirmed notice.' }, 409);
      await deliverSoftwareNotice(db, id, env, command.updateId); return json({ ok: true });
    }
    if (command.action === 'revoke') {
      await db.batch([openSoftwareGuard(db, id), ...softwareAccessRevocation(db, id, actor, at)]);
      return json({ ok: true });
    }
    if (command.action === 'deposit') {
      if (project.payment_mode !== 'standard' || command.milestone_index <= project.milestone_index || command.milestone_index >= projectTerms(project).milestones.length || project.completed_at) return json({ok:false},400);
      await db.batch([openSoftwareGuard(db,id), softwareGuard(db,'SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=?',[id,project.updated_at]),
        manualSoftwarePaymentGuard(db,id,project.offer_id,command.milestone_index,true),
        db.prepare(`INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note)
          SELECT ?,'deposit-paid',?,?,? WHERE NOT EXISTS(SELECT 1 FROM software_milestone_deposits WHERE request_id=? AND milestone_index=?)`)
          .bind(id,actor,at,`Deposit received outside Stripe · milestone ${command.milestone_index+1}`,id,command.milestone_index),
        db.prepare('INSERT OR IGNORE INTO software_milestone_deposits VALUES (?,?,?,?)').bind(id,command.milestone_index,at,actor)]);
      return json({ok:true});
    }
    if (command.action === 'payment') {
      if (command.milestone_index >= projectTerms(project).milestones.length) return json({ok:false},400);
      await db.batch([openSoftwareGuard(db,id), ...recordMilestonePayment(db,id,command.milestone_index,actor,at)]);
      return json({ok:true});
    }
    const completing = command.action === 'complete' || command.state === 'complete';
    if (completing) {
      const last = projectTerms(project).milestones.length-1;
      await db.batch([openSoftwareGuard(db,id), softwareGuard(db,"SELECT 1 FROM software_projects WHERE request_id=? AND completed_at IS NULL",[id]),
        ...(command.action==='state' ? [softwareGuard(db,'SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=?',[id,command.expectedUpdatedAt])] : []),
        acceptedDeliveryGuard(db,id,last),
        softwareGuard(db,`SELECT 1 FROM software_project_updates h JOIN software_project_updates u ON u.request_id=h.request_id AND u.milestone_index=h.milestone_index
          JOIN software_project_messages m ON m.update_id=u.id WHERE h.request_id=? AND h.milestone_index=? AND h.kind='handoff' AND h.status='shared'
          AND u.kind='delivery_review' AND u.status='shared' AND m.decision='milestone_accepted' AND h.shared_at>=m.created_at`,[id,last]),
        db.prepare("UPDATE software_projects SET state='complete',next_update_on=NULL,waiting_for='',completed_at=?,updated_at=? WHERE request_id=?").bind(at,at,id),
        softwareAudit(db,id,'completed',actor,at,'Project completed after final milestone handoff')]);
      return json({ok:true});
    }
    if (command.action !== 'state' || project.completed_at) return json({ok:false,error:'This project is complete.'},409);
    if (command.milestone_index >= projectTerms(project).milestones.length || (command.state === 'waiting_for_input' && !command.waiting_for))
      return json({ ok: false, error: 'Choose a milestone and name the one thing you need.' }, 400);
    if(project.payment_mode==='invoice' && command.milestone_index>project.milestone_index) {
      const prior=await db.prepare('SELECT count(*) AS n FROM software_milestone_payments WHERE request_id=? AND milestone_index<?').bind(id,command.milestone_index).first<{n:number}>();
      if(prior?.n!==command.milestone_index)return json({ok:false,error:'The previous milestones must be paid before the next one starts.'},409);
    }
    at = new Date(Math.max(Date.now(), Date.parse(project.updated_at) + 1)).toISOString();
    await db.batch([openSoftwareGuard(db, id), softwareGuard(db, 'SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=?', [id, command.expectedUpdatedAt]),
      ...(project.payment_mode==='standard' && command.milestone_index>project.milestone_index ? [milestoneDepositGuard(db,id,command.milestone_index)] : []),
      ...(project.payment_mode==='invoice' && command.milestone_index>project.milestone_index ? [priorMilestonePaymentGuard(db,id,command.milestone_index)] : []),
      db.prepare(`UPDATE software_projects SET state=?,waiting_for=?,milestone_index=?,step=?,next_update_on=?,completed_at=?,updated_at=? WHERE request_id=?`)
        .bind(command.state, command.waiting_for, command.milestone_index, command.step, command.next_update_on || null, command.state === 'complete' ? project.completed_at ?? at : null, at, id),
      softwareAudit(db, id, 'state-changed', actor, at)]);
    return json({ ok: true });
  } catch {
    const offerId = command.action === 'start' ? command.offer_id : (await getSoftwareProject(db,id))?.offer_id;
    if (offerId && (command.action === 'start' || command.action === 'payment' || command.action === 'deposit') && payableSoftwareInvoice(await listSoftwareInvoices(db,id,offerId), command.action === 'start' ? 0 : command.milestone_index, command.action === 'start' || command.action === 'deposit' ? ['deposit'] : ['balance','milestone'])) return json({ok:false,error:manualPaymentReminder},409);
    if (command.action === 'start' && !await db.prepare('SELECT 1 FROM owner_requests WHERE id=? AND updated_at=?').bind(id, command.expectedRequestUpdatedAt).first()) return json({ ok: false, error: 'The request changed since this page loaded. Reload and try again.' }, 409);
    return json({ ok: false, error: command.action === 'start' ? 'The offer changed since this page loaded. Reload to see the current offer.' : 'The project changed or could not be saved. Reload and try again.' }, 409); }
};
