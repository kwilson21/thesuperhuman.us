import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { musicRequest } from '~/lib/music-request';
import { clientPortalEnabled } from '~/lib/audio-client-access';
import { updateInput, getSoftwareProject, projectTerms, softwareAudit, softwareGuard, openSoftwareGuard, deliverSoftwareNotice } from '~/lib/software-projects';
import type { SoftwareUpdate } from '~/lib/software-projects';
export const prerender = false;
export const POST: APIRoute = async ({ params, request, locals }) => {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
  if (!locals.owner) return json({ ok: false }, 403);
  const env = locals.runtime.env, db = env.MUSIC_DB, id = params.id;
  if (!clientPortalEnabled(env)) return json({ ok: false }, 404);
  if (!db || !id) return json({ ok: false }, 503);
  const body = await musicRequest(request, 16000); if (body instanceof Response) return body;
  const parsed = z.object({ action: z.enum(['draft','share']), expectedUpdatedAt: z.string().nullable(), confirmed: z.boolean().optional(), update: z.unknown() }).safeParse(body);
  if (!parsed.success) return json({ ok: false, error: 'Choose save or share and reload the current draft.' }, 400);
  const command = parsed.data;
  const input = updateInput.safeParse(command.update, { errorMap: () => ({ message: 'Check the required fields and choose a listed option.' }) });
  if (!input.success) return json({ ok: false, error: 'Check the fields, links and their limits.', errors: input.error.issues.map(issue => issue.message) }, 400);
  const value = input.data, actor = locals.owner.email;
  try {
    const project = await getSoftwareProject(db, id);
    if (!project || project.revoked_at) return json({ ok: false }, 404);
    if (value.milestone_index >= projectTerms(project).milestones.length) return json({ ok: false, error: 'Choose a milestone from this project.' }, 400);
    const draft = await db.prepare("SELECT * FROM software_project_updates WHERE request_id=? AND status='draft'").bind(id).first<SoftwareUpdate>();
    if ((draft?.updated_at ?? null) !== command.expectedUpdatedAt) return json({ ok: false, error: 'The draft changed. Reload before saving.' }, 409);
    if (draft?.visual_key && !value.visual_alt) return json({ ok: false, error: 'Describe the visual for the client.' }, 400);
    const share = command.action === 'share';
    if (share && (!command.confirmed || !value.title || !value.what_changed)) return json({ ok: false, error: 'Add a title and what changed, then confirm sharing.' }, 400);
    const updateId = draft?.id ?? crypto.randomUUID();
    const at = new Date(Math.max(Date.now(), draft ? Date.parse(draft.updated_at) + 1 : 0)).toISOString();
    const columns = ['kind','milestone_index','title','artifact_version','evidence_type','visual_alt','preview_url','what_changed','checks_limitations','next_step','client_request','next_update_on','email_client'];
    const values = columns.map(key => key === 'email_client' ? Number(value.email_client) : (key === 'next_update_on' || key === 'preview_url') ? value[key] || null : value[key as keyof typeof value]);
    const status = share ? 'shared' : 'draft', notice = share && value.email_client ? 'pending' : 'not_requested';
    await db.batch([openSoftwareGuard(db, id),
      ...(draft ? [softwareGuard(db, "SELECT 1 FROM software_project_updates WHERE id=? AND status='draft' AND updated_at=?", [draft.id, command.expectedUpdatedAt!])] : []),
      draft ? db.prepare(`UPDATE software_project_updates SET ${columns.map(key => `${key}=?`).join(',')},status=?,notification_status=?,shared_at=?,shared_by=?,updated_at=? WHERE id=?`)
        .bind(...values, status, notice, share ? at : null, share ? actor : null, at, updateId)
        : db.prepare(`INSERT INTO software_project_updates(id,request_id,${columns.join(',')},status,notification_status,shared_at,shared_by,created_by,created_at,updated_at) VALUES (${Array(22).fill('?').join(',')})`)
          .bind(updateId, id, ...values, status, notice, share ? at : null, share ? actor : null, actor, at, at),
      ...(share ? [db.prepare('UPDATE software_projects SET next_update_on=?,updated_at=? WHERE request_id=?').bind(value.next_update_on || null, at, id)] : []),
      softwareAudit(db, id, share ? 'update-shared' : 'update-draft-saved', actor, at)]);
    if (share && value.email_client) {
      try { await deliverSoftwareNotice(db, id, env, updateId); } catch { return json({ ok: true, id: updateId, updatedAt: at, shared: true, noticeUnchecked: true }); }
    }
    return json({ ok: true, id: updateId, updatedAt: at, shared: share });
  } catch { return json({ ok: false, error: 'The draft changed or could not be saved. Reload and try again.' }, 409); }
};
