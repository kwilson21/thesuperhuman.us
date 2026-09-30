import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { musicRequest } from '~/lib/music-request';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { updateInput, getSoftwareProject, projectTerms, softwareAudit, softwareGuard, openSoftwareGuard, deliverSoftwareNotice, recordMilestonePayment, acceptedDeliveryGuard, priorMilestonePaymentGuard } from '~/lib/software-projects';
import type { SoftwareUpdate } from '~/lib/software-projects';
export const prerender = false;
export const POST: APIRoute = async ({ params, request, locals }) => {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
  if (!locals.owner) return json({ ok: false }, 403);
  const env = locals.runtime.env, db = env.MUSIC_DB, id = params.id;
  if (!clientPortalEnabled(env)) return json({ ok: false }, 404);
  if (!db || !id) return json({ ok: false }, 503);
  const body = await musicRequest(request, 40000); if (body instanceof Response) return body;
  const parsed = z.object({ action: z.enum(['draft','share']), updateId: z.string().uuid().optional(), expectedUpdatedAt: z.string().nullable(), expectedProjectUpdatedAt: z.string(), confirmed: z.boolean().optional(), update: z.unknown() }).safeParse(body);
  if (!parsed.success) return json({ ok: false, error: 'Choose save or share and reload the current draft.' }, 400);
  const command = parsed.data;
  const input = updateInput.safeParse(command.update, { errorMap: () => ({ message: 'Check the required fields and choose a listed option.' }) });
  if (!input.success) return json({ ok: false, error: 'Check the fields, links and their limits.', errors: input.error.issues.map(issue => issue.message) }, 400);
  const value = input.data, actor = locals.owner.email;
  try {
    const project = await getSoftwareProject(db, id);
    if (!project || project.revoked_at || project.content_deleted_at) return json({ ok: false }, 404);
    if (project.state === 'complete') return json({ ok: false, error: 'This project is complete.' }, 409);
    if (value.milestone_index >= projectTerms(project).milestones.length) return json({ ok: false, error: 'Choose a milestone from this project.' }, 400);
    const columns = ['kind','milestone_index','title','artifact_version','evidence_type','visual_alt','preview_url','what_changed','checks_limitations','next_step','client_request','next_update_on','email_client','criteria_json','links_json','review_window_days'];
    const review = value.kind.endsWith('_review');
    const stored = { ...value, evidence_type: value.kind === 'handoff' ? 'handoff' : value.evidence_type, email_client: Number(value.email_client), criteria_json: JSON.stringify(value.criteria), links_json: JSON.stringify(value.links), review_window_days: review ? value.review_window_days : null };
    const values = columns.map(key => (key === 'next_update_on' || key === 'preview_url') ? stored[key] || null : stored[key as keyof typeof stored]);
    async function sharedRetry() {
      if (!command.updateId || command.action !== 'share' || !command.confirmed) return null;
      const row = await db!.prepare("SELECT * FROM software_project_updates WHERE id=? AND request_id=? AND status='shared'").bind(command.updateId,id).first<SoftwareUpdate>();
      return row && columns.every((key,index) => row[key as keyof SoftwareUpdate] === values[index])
        ? json({ok:true,id:row.id,updatedAt:row.updated_at,projectUpdatedAt:row.updated_at,shared:true}) : null;
    }
    const retry = await sharedRetry(); if (retry) return retry;
    const draft = await db.prepare("SELECT * FROM software_project_updates WHERE request_id=? AND status='draft'").bind(id).first<SoftwareUpdate>();
    const staleProject = () => json({ ok: false, error: 'Another update was saved since this page loaded. Reload to continue.' }, 409);
    if (project.updated_at !== command.expectedProjectUpdatedAt) return staleProject();
    if ((draft?.updated_at ?? null) !== command.expectedUpdatedAt) return json({ ok: false, error: 'The draft changed. Reload before saving.' }, 409);
    if (draft?.visual_key && !value.visual_alt) return json({ ok: false, error: 'Describe the visual for the client.' }, 400);
    const share = command.action === 'share';
    if (share && (!command.confirmed || !value.title || !value.what_changed)) return json({ ok: false, error: 'Add a title and what changed, then confirm sharing.' }, 400);
    if (share && review && !value.artifact_version) return json({ ok: false, error: 'Name the version before sharing.' }, 400);
    const checks = projectTerms(project).milestones[value.milestone_index].acceptance;
    if (share && value.kind === 'delivery_review' && (value.criteria.length !== checks.length || value.criteria.some(evidence => !evidence)))
      return json({ ok: false, error: 'Add evidence for every acceptance check before sharing.' }, 400);
    if (share && value.kind === 'handoff' && (!value.paid_confirmed || !value.links.length || !value.next_step || !value.checks_limitations))
      return json({ ok: false, error: 'Confirm full payment and add delivered links, limitations and the support boundary.' }, 400);
    const updateId = draft?.id ?? command.updateId ?? crypto.randomUUID();
    if (draft && command.updateId && command.updateId !== draft.id) return json({ok:false,error:'The draft changed. Reload before saving.'},409);
    const at = new Date(Math.max(Date.now(), Date.parse(project.updated_at) + 1, draft ? Date.parse(draft.updated_at) + 1 : 0)).toISOString();
    const status = share ? 'shared' : 'draft', notice = share && value.email_client ? 'pending' : 'not_requested';
    try { await db.batch([openSoftwareGuard(db, id),
      softwareGuard(db,"SELECT 1 FROM software_projects WHERE request_id=? AND state<>'complete'",[id]),
      ...(share && review && project.payment_mode==='invoice' && value.milestone_index>project.milestone_index ? [priorMilestonePaymentGuard(db,id,value.milestone_index)] : []),
      ...(share && value.kind === 'handoff' ? [acceptedDeliveryGuard(db,id,value.milestone_index), ...recordMilestonePayment(db,id,value.milestone_index,actor,at)] : []),
      ...(share && value.kind !== 'progress' ? [db.prepare("UPDATE software_project_updates SET status='superseded',updated_at=? WHERE request_id=? AND milestone_index=? AND kind=? AND status='shared'").bind(at,id,value.milestone_index,value.kind)] : []),
      softwareGuard(db, "SELECT 1 FROM software_projects WHERE request_id=? AND updated_at=?", [id, command.expectedProjectUpdatedAt]),
      ...(draft ? [softwareGuard(db, "SELECT 1 FROM software_project_updates WHERE id=? AND status='draft' AND updated_at=?", [draft.id, command.expectedUpdatedAt!])] : []),
      draft ? db.prepare(`UPDATE software_project_updates SET ${columns.map(key => `${key}=?`).join(',')},status=?,notification_status=?,shared_at=?,shared_by=?,updated_at=? WHERE id=?`)
        .bind(...values, status, notice, share ? at : null, share ? actor : null, at, updateId)
        : db.prepare(`INSERT INTO software_project_updates(id,request_id,${columns.join(',')},status,notification_status,shared_at,shared_by,created_by,created_at,updated_at) VALUES (${Array(columns.length+9).fill('?').join(',')})`)
          .bind(updateId, id, ...values, status, notice, share ? at : null, share ? actor : null, actor, at, at),
      share ? db.prepare('UPDATE software_projects SET next_update_on=?,updated_at=? WHERE request_id=?').bind(value.next_update_on || null, at, id)
        : db.prepare('UPDATE software_projects SET updated_at=? WHERE request_id=?').bind(at, id),
      ...(share && review ? [db.prepare("UPDATE software_projects SET state='ready_for_review',step=?,milestone_index=?,waiting_for='' WHERE request_id=?")
        .bind(value.kind==='direction_review' ? 'direction' : 'review',value.milestone_index,id), softwareAudit(db,id,'state-changed',actor,at)] : []),
      softwareAudit(db, id, share ? 'update-shared' : 'update-draft-saved', actor, at),
      ...(share && value.kind === 'handoff' ? [softwareAudit(db,id,'handoff-shared',actor,at,`Handoff shared · milestone ${value.milestone_index+1}`)] : [])]); } catch (error) { const retry = await sharedRetry(); if (retry) return retry; if ((await getSoftwareProject(db!, id!))?.updated_at !== command.expectedProjectUpdatedAt) return staleProject(); throw error; }
    if (share && value.email_client) {
      try { await deliverSoftwareNotice(db, id, env, updateId); } catch { return json({ ok: true, id: updateId, updatedAt: at, projectUpdatedAt: at, shared: true, noticeUnchecked: true }); }
    }
    return json({ ok: true, id: updateId, updatedAt: at, projectUpdatedAt: at, shared: share });
  } catch { return json({ ok: false, error: 'The draft changed or could not be saved. Reload and try again.' }, 409); }
};
