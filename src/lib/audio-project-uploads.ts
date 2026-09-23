import { privateProjectObjectKey, type ProjectFile } from './audio-project-files';

export const uploadPartSize = 10 * 1024 * 1024;
export const maxProjectFileSize = 1024 * 1024 * 1024;

export type ProjectUpload = {
  id: string;
  request_id: string;
  upload_id: string;
  object_key: string;
  version: 'review' | 'final';
  display_name: string;
  media_type: ProjectFile['media_type'];
  byte_size: number;
  created_at: string;
};

const activeProject = `EXISTS(SELECT 1 FROM audio_projects p JOIN owner_requests r ON r.id=p.request_id
  LEFT JOIN audio_payments pay ON pay.request_id=p.request_id
  WHERE p.request_id=? AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    AND p.stage IN ('in_progress','review_ready','revision_in_progress') AND pay.booking_status='paid')`;

export async function ownerProjectCanUpload(db: D1Database, requestId: string): Promise<boolean> {
  return Boolean(await db.prepare(`SELECT 1 WHERE ${activeProject}`).bind(requestId).first());
}

export async function beginProjectUpload(db: D1Database, bucket: R2Bucket, requestId: string,
  input: { version: ProjectUpload['version']; displayName: string; mediaType: ProjectUpload['media_type']; byteSize: number }, now = new Date()): Promise<ProjectUpload | null> {
  if (!await ownerProjectCanUpload(db, requestId)) return null;
  const id = crypto.randomUUID();
  const key = privateProjectObjectKey(requestId, id, input.mediaType);
  if (!key) return null;
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: input.mediaType } });
  try {
    const row = await db.prepare(`INSERT INTO audio_project_uploads(id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${activeProject}
      RETURNING id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,created_at`)
      .bind(id, requestId, upload.uploadId, key, input.version, input.displayName, input.mediaType, input.byteSize, now.toISOString(), requestId)
      .first<ProjectUpload>();
    if (row) return row;
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
  await upload.abort().catch(() => {});
  return null;
}

export async function getProjectUpload(db: D1Database, requestId: string, id: string): Promise<ProjectUpload | null> {
  return db.prepare(`SELECT id,request_id,upload_id,object_key,version,display_name,media_type,byte_size,created_at
    FROM audio_project_uploads WHERE request_id=? AND id=?`).bind(requestId, id).first<ProjectUpload>();
}

export function expectedPartLength(byteSize: number, partNumber: number): number | null {
  const count = Math.ceil(byteSize / uploadPartSize);
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count) return null;
  return Math.min(uploadPartSize, byteSize - (partNumber - 1) * uploadPartSize);
}

export async function putProjectUploadPart(bucket: R2Bucket, upload: ProjectUpload, partNumber: number,
  body: ReadableStream): Promise<R2UploadedPart> {
  return bucket.resumeMultipartUpload(upload.object_key, upload.upload_id).uploadPart(partNumber, body);
}

export async function finishProjectUpload(db: D1Database, bucket: R2Bucket, upload: ProjectUpload,
  parts: R2UploadedPart[] | null, now = new Date()): Promise<'saved' | 'blocked' | 'size-mismatch'> {
  if (!await ownerProjectCanUpload(db, upload.request_id)) return 'blocked';
  const count = Math.ceil(upload.byte_size / uploadPartSize);
  let object = await bucket.head(upload.object_key);
  if (!object) {
    if (!parts || parts.length !== count || parts.some((part, index) => part.partNumber !== index + 1 || !/^[a-fA-F0-9]{32}$/.test(part.etag))) return 'blocked';
    object = await bucket.resumeMultipartUpload(upload.object_key, upload.upload_id).complete(parts);
  }
  if (object.size !== upload.byte_size) return 'size-mismatch';
  const saved = await db.prepare(`INSERT INTO audio_project_files(id,request_id,version,object_key,display_name,media_type,byte_size,uploaded_at)
    SELECT id,request_id,version,object_key,display_name,media_type,byte_size,?
    FROM audio_project_uploads WHERE id=? AND request_id=? AND ${activeProject}
    ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(now.toISOString(), upload.id, upload.request_id, upload.request_id).first<{ id: string }>();
  const existing = saved || await db.prepare('SELECT id FROM audio_project_files WHERE id=? AND request_id=?')
    .bind(upload.id, upload.request_id).first<{ id: string }>();
  if (!existing) return 'blocked';
  await db.prepare('DELETE FROM audio_project_uploads WHERE id=? AND request_id=?')
    .bind(upload.id, upload.request_id).run();
  return 'saved';
}

export async function abortProjectUpload(db: D1Database, bucket: R2Bucket, upload: ProjectUpload): Promise<void> {
  const removed = await db.prepare(`DELETE FROM audio_project_uploads WHERE id=? AND request_id=?
    AND NOT EXISTS(SELECT 1 FROM audio_project_files WHERE id=?) RETURNING id`)
    .bind(upload.id, upload.request_id, upload.id).first<{ id: string }>();
  if (!removed) {
    await db.prepare('DELETE FROM audio_project_uploads WHERE id=? AND request_id=? AND EXISTS(SELECT 1 FROM audio_project_files WHERE id=?)')
      .bind(upload.id, upload.request_id, upload.id).run();
    return;
  }
  const object = await bucket.head(upload.object_key);
  if (object) await bucket.delete(upload.object_key);
  else await bucket.resumeMultipartUpload(upload.object_key, upload.upload_id).abort().catch(() => {});
}
