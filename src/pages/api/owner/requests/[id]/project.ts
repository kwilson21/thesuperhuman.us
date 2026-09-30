import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { musicRequest } from '~/lib/music-request';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { getSoftwareProject, projectTerms, projectDate, softwareAudit, softwareGuard, openSoftwareGuard, deliverSoftwareNotice, queueSoftwareNotice, softwareAccessRevocation, recordMilestonePayment, acceptedDeliveryGuard } from '~/lib/software-projects';
export const prerender = false;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), offer_id: z.string().min(1), offer_version: z.number().int().positive(), expectedRequestUpdatedAt: z.string().min(1), signatures: z.literal(true), payment: z.literal(true), next_update_on: projectDate }),
  z.object({ action: z.literal('state'), state: z.enum(['preparing','building','waiting_for_input','ready_for_review','complete']), waiting_for: z.string().trim().max(200), milestone_index: z.number().int().min(0).max(2), step: z.enum(['direction','build','review','handoff']), next_update_on: projectDate, expectedUpdatedAt: z.string() }),
  z.object({ action: z.literal('revoke'), confirmed: z.literal(true) }),
  z.object({ action: z.literal('notice'), updateId: z.string().optional(), confirmedNotSent: z.boolean().default(false) }),
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
      await db.batch([
        softwareGuard(db, 'SELECT 1 FROM owner_requests WHERE id=? AND updated_at=?', [id, command.expectedRequestUpdatedAt]),
        softwareGuard(db, `SELECT 1 FROM owner_requests r JOIN software_offers o ON o.request_id=r.id
          WHERE r.id=? AND r.kind='software' AND r.status NOT IN ('withdrawn','resolved') AND r.email<>'' AND o.status='sent' AND o.id=? AND o.version=?
          AND NOT EXISTS(SELECT 1 FROM software_projects WHERE request_id=r.id)`, [id, command.offer_id, command.offer_version]),
        db.prepare(`INSERT INTO software_projects(request_id,offer_id,terms_json,payment_mode,signatures_recorded_at,first_payment_recorded_at,started_at,started_by,next_update_on,created_at,updated_at)
          SELECT request_id,id,terms_json,json_extract(terms_json,'$.paymentMode'),?,?,?,?,?,?,? FROM software_offers WHERE request_id=? AND status='sent' AND id=? AND version=?`)
          .bind(at, at, at, actor, command.next_update_on || null, at, at, id, command.offer_id, command.offer_version),
        db.prepare(`INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
          SELECT id,'reviewed',?,'',? FROM owner_requests WHERE id=? AND status='new'`).bind(actor.trim().toLowerCase(),at,id),
        db.prepare("UPDATE owner_requests SET status='reviewed',updated_at=? WHERE id=? AND status='new'").bind(at,id),
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
    at = new Date(Math.max(Date.now(), Date.parse(project.updated_at) + 1)).toISOString();
    await db.batch([openSoftwareGuard(db, id), softwareGuard(db, 'SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=?', [id, command.expectedUpdatedAt]),
      db.prepare(`UPDATE software_projects SET state=?,waiting_for=?,milestone_index=?,step=?,next_update_on=?,completed_at=?,updated_at=? WHERE request_id=?`)
        .bind(command.state, command.waiting_for, command.milestone_index, command.step, command.next_update_on || null, command.state === 'complete' ? project.completed_at ?? at : null, at, id),
      softwareAudit(db, id, 'state-changed', actor, at)]);
    return json({ ok: true });
  } catch {
    if (command.action === 'start' && !await db.prepare('SELECT 1 FROM owner_requests WHERE id=? AND updated_at=?').bind(id, command.expectedRequestUpdatedAt).first()) return json({ ok: false, error: 'The request changed since this page loaded. Reload and try again.' }, 409);
    return json({ ok: false, error: command.action === 'start' ? 'The offer changed since this page loaded. Reload to see the current offer.' : 'The project changed or could not be saved. Reload and try again.' }, 409); }
};
