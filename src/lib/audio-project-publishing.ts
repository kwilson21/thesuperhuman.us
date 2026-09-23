import { privateProjectObjectKey, type ProjectFile } from './audio-project-files';

type DraftFile = Pick<ProjectFile, 'id' | 'request_id' | 'version' | 'object_key' | 'media_type' | 'byte_size'> & { status: string };

export async function publishProjectFile(db: D1Database, bucket: R2Bucket, requestId: string, fileId: string,
  actor: string, note: string, reviewDownload: boolean, now = new Date()): Promise<number | null> {
  const body = note.trim();
  if (!body || body.length > 1000 || !actor.trim()) return null;
  const file = await db.prepare(`SELECT id,request_id,version,object_key,media_type,byte_size,status
    FROM audio_project_files WHERE id=? AND request_id=?`).bind(fileId, requestId).first<DraftFile>();
  if (!file || file.status !== 'uploaded' || file.object_key !== privateProjectObjectKey(requestId, file.id, file.media_type)) return null;
  const object = await bucket.head(file.object_key);
  if (!object || object.size !== file.byte_size) return null;

  const at = now.toISOString();
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  const publicationId = crypto.randomUUID();
  const targetStage = file.version === 'review' ? 'review_ready' : 'final_files_ready';
  const [changed, , , update] = await db.batch([
    db.prepare(`UPDATE audio_project_files SET status='published',downloadable=?,published_at=?,expires_at=?,publication_id=?
      WHERE id=? AND request_id=? AND status='uploaded'
        AND EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
          JOIN audio_payments pay ON pay.request_id=p.request_id
          WHERE p.request_id=audio_project_files.request_id AND p.revoked_at IS NULL AND r.status<>'withdrawn'
            AND pay.booking_status='paid' AND
            ((audio_project_files.version='review' AND p.stage IN ('in_progress','review_ready','revision_in_progress')) OR
              (audio_project_files.version='final' AND p.stage IN ('in_progress','review_ready','revision_in_progress','final_files_ready')
                AND pay.balance_status='paid')))
      RETURNING id`).bind(file.version === 'final' || reviewDownload ? 1 : 0, at,
        file.version === 'final' ? expiry.toISOString() : null, publicationId, fileId, requestId),
    db.prepare(`UPDATE audio_project_files SET status='revoked',revoked_at=?
      WHERE request_id=? AND version='review' AND status='published' AND id<>?
        AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND publication_id=?)`)
      .bind(at, requestId, fileId, fileId, publicationId),
    db.prepare(`UPDATE audio_projects SET stage=?,updated_at=? WHERE request_id=?
      AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=? AND publication_id=?)`)
      .bind(targetStage, at, requestId, fileId, publicationId),
    db.prepare(`INSERT INTO audio_project_updates(request_id,kind,body,actor,created_at,file_id)
      SELECT request_id,'progress',?,?,?,id FROM audio_project_files
      WHERE id=? AND publication_id=? AND status='published' RETURNING id`)
      .bind(body, actor, at, fileId, publicationId),
  ]);
  return changed.results.length ? Number((update.results[0] as { id: number }).id) : null;
}
