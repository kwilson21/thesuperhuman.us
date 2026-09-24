export async function revokeProjectAccess(db: D1Database, requestId: string, actor: string,
  now = new Date()): Promise<boolean> {
  if (!actor.trim()) return false;
  const at = now.toISOString();
  const revocationId = crypto.randomUUID();
  const [changed] = await db.batch([
    db.prepare(`UPDATE audio_projects SET revoked_at=?,updated_at=?,access_revocation_id=?
      WHERE request_id=? AND revoked_at IS NULL RETURNING request_id`)
      .bind(at, at, revocationId, requestId),
    db.prepare(`UPDATE audio_client_sessions SET revoked_at=? WHERE revoked_at IS NULL AND email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`).bind(at, requestId, revocationId),
    db.prepare(`DELETE FROM audio_client_codes WHERE email=(
      SELECT r.email FROM owner_requests r JOIN audio_projects p ON p.request_id=r.id
      WHERE p.request_id=? AND p.access_revocation_id=?)`).bind(requestId, revocationId),
    db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'revoked',?,? FROM audio_projects WHERE request_id=? AND access_revocation_id=?`)
      .bind(actor, at, requestId, revocationId),
  ]);
  return changed.results.length > 0;
}

export async function revokeProjectFile(db: D1Database, requestId: string, fileId: string, actor: string,
  note: string, now = new Date()): Promise<{ updateId: number | null } | null> {
  if (!actor.trim()) return null;
  const file = await db.prepare(`SELECT version,status FROM audio_project_files WHERE request_id=? AND id=?`)
    .bind(requestId, fileId).first<{ version: 'review' | 'final'; status: string }>();
  if (!file || !['uploaded', 'published'].includes(file.status)) return null;
  const body = note.trim();
  if (file.status === 'published' && (body.length < 1 || body.length > 1000)) return null;
  const at = now.toISOString();
  const revocationId = crypto.randomUUID();
  const statements = [
    db.prepare(`UPDATE audio_project_files SET status='revoked',revoked_at=?,revoked_by=?,revocation_id=?
      WHERE request_id=? AND id=? AND status=?
        AND EXISTS(SELECT 1 FROM audio_projects WHERE request_id=? AND revoked_at IS NULL)
      RETURNING id`).bind(at, actor, revocationId, requestId, fileId, file.status, requestId),
    // Without a published file of its version, the project returns to In progress so a replacement
    // can be uploaded and published. That includes a completed project losing its only final;
    // the earlier completion stays in the audit history.
    db.prepare(`UPDATE audio_projects SET stage='in_progress',completed_at=NULL,updated_at=? WHERE request_id=?
      AND stage IN (?,?) AND NOT EXISTS(SELECT 1 FROM audio_project_files
        WHERE request_id=? AND version=? AND status='published')
      AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND revocation_id=?)`)
      .bind(at, requestId, ...(file.version === 'review' ? ['review_ready', 'review_ready'] : ['final_files_ready', 'complete']),
        requestId, file.version, fileId, revocationId),
    db.prepare(`INSERT INTO audio_project_audit(request_id,action,actor,occurred_at)
      SELECT request_id,'stage-changed',?,? FROM audio_projects
      WHERE request_id=? AND stage='in_progress' AND updated_at=? AND changes()=1`)
      .bind(actor, at, requestId, at),
  ];
  if (file.status === 'published') statements.push(db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at)
    SELECT request_id,'progress',?,?,? FROM audio_project_files WHERE id=? AND revocation_id=?
    RETURNING id`).bind(body, actor, at, fileId, revocationId));
  const results = await db.batch(statements);
  if (!results[0].results.length) return null;
  const update = file.status === 'published' ? results[3].results[0] as { id: number } : null;
  return { updateId: update?.id ?? null };
}
