import { canonicalJson, hashBytes } from './agreement-artifacts';
import { hashOfferToken } from './software-offers';
import { agreementEvent } from './agreement-events';
import { softwareGuard } from './software-projects';
export type RetentionManifest = {
  version: 1;
  created_at: string;
  binding: string;
  agreements: {
    id: string;
    sha256: string;
    row_hash: string;
    objects: { key: string; sha256: string }[];
  }[];
  unattached_attachments: { id: string; key: string; sha256: string; created_at: string }[];
  orphan_scan_cursor?: string | null;
  orphan_next_cursor?: string | null;
  orphan_attachments: { key: string; sha256: string; uploaded_at: string }[];
};
const orphanCursorKey = 'agreements/retention/attachment-cursor.json';
// A referenced record stays retained. Later owner reviews can include it once every dependent record is retired.
const eligible = `a.status IN ('executed','abandoned') AND a.ended_at IS NOT NULL AND a.retain_until IS NOT NULL AND a.retain_until<=? AND a.legal_hold=0
 AND NOT EXISTS(SELECT 1 FROM software_agreement_artifacts f WHERE f.agreement_id=a.id AND f.status='rendering')
 AND NOT EXISTS(SELECT 1 FROM software_agreement_deliveries d WHERE d.agreement_id=a.id AND d.status='sending')
 AND NOT EXISTS(SELECT 1 FROM software_agreement_notifications n WHERE n.agreement_id=a.id AND n.status='sending')
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.agreement_id=a.id AND p.content_deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=a.offer_id)
 AND NOT EXISTS(SELECT 1 FROM software_offers o WHERE o.reused_msa_id=a.id AND (EXISTS(SELECT 1 FROM software_agreements sow WHERE sow.offer_id=o.id) OR (o.status IN ('sent','draft') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id AND p.content_deleted_at IS NOT NULL))))
 AND NOT EXISTS(SELECT 1 FROM software_agreements s WHERE s.msa_id=a.id)
 AND (a.kind='sow' OR a.terminated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM software_agreement_signatures sig WHERE sig.agreement_id=a.id))`;
// Offers that can still be reviewed pin their uploaded attachments independently of review snapshots.
const activeOfferAttachment = (keyExpression = '?') => `SELECT 1 FROM software_offers o,json_each(json_extract(o.agreement_details_json,'$.attachments')) attachment
 WHERE o.status IN ('draft','sent') AND CASE WHEN json_valid(attachment.value) THEN json_extract(attachment.value,'$.key') END=${keyExpression}
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id)`;
export async function previewAgreementRetention(
  db: D1Database,
  bucket: R2Bucket,
  binding: string,
  now = new Date(),
  scan?: { cursor: string | null },
): Promise<RetentionManifest> {
  const rows = (
    await db
      .prepare(`SELECT a.* FROM software_agreements a WHERE ${eligible} ORDER BY a.id LIMIT 20`)
      .bind(now.toISOString())
      .all<
        Record<string, unknown> & {
          id: string;
          text_sha256: string;
          attachment_manifest_json: string;
        }
      >()
  ).results;
  const retiringIds = JSON.stringify(rows.map(row => row.id));
  // Assign a shared attachment to its last retiring reference, after the earlier rows are removed.
  const attachmentOwners = new Map<string, string>();
  for (const row of rows)
    for (const attachment of JSON.parse(row.attachment_manifest_json) as { key: string }[])
      attachmentOwners.set(attachment.key, row.id);
  const agreements: RetentionManifest['agreements'] = [];
  for (const row of rows) {
    const objects: { key: string; sha256: string }[] = [];
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix: `agreements/${row.id}/`, cursor });
      for (const object of listed.objects) {
        const value = await bucket.get(object.key);
        if (!value) throw new Error('Archive changed.');
        objects.push({ key: object.key, sha256: await hashBytes(await value.arrayBuffer()) });
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    for (const attachment of JSON.parse(row.attachment_manifest_json) as {
      key: string;
      sha256: string;
    }[]) {
      const shared = await db
        .prepare(
          "SELECT 1 FROM software_agreements other,json_each(other.attachment_manifest_json) attachment WHERE other.id NOT IN (SELECT value FROM json_each(?)) AND json_extract(attachment.value,'$.key')=?",
        )
        .bind(retiringIds, attachment.key)
        .first();
      const offered = await db.prepare(activeOfferAttachment()).bind(attachment.key).first();
      if (!shared && !offered && attachmentOwners.get(attachment.key) === row.id)
        objects.push({ key: attachment.key, sha256: attachment.sha256 });
    }
    agreements.push({
      id: row.id,
      sha256: row.text_sha256,
      row_hash: await hashOfferToken(canonicalJson(row)),
      objects: objects.sort((a, b) => a.key.localeCompare(b.key)),
    });
  }
  const unattached_attachments = (await db.prepare(`SELECT attachment.id,attachment.object_key AS key,attachment.sha256,attachment.created_at
    FROM software_agreement_attachments attachment
    WHERE attachment.created_at<=?
      AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
        WHERE json_extract(item.value,'$.key')=attachment.object_key)
      AND NOT EXISTS(${activeOfferAttachment('attachment.object_key')})
    ORDER BY attachment.id LIMIT 100`).bind(new Date(now.getTime()-30*86400000).toISOString()).all<RetentionManifest['unattached_attachments'][number]>()).results;
  // A process can stop after the metadata reservation commits but before the R2
  // delete starts. Keep those old, unindexed private objects visible for a later
  // owner-reviewed pass. Keys referenced by any live metadata, agreement or offer
  // are excluded here and checked again immediately before deletion.
  const orphan_attachments: RetentionManifest['orphan_attachments'] = [];
  const orphanCutoff = new Date(now.getTime() - 30 * 86400000);
  let orphanScanCursor = scan?.cursor ?? null;
  let orphanNextCursor: string | null = null;
  if (!scan) {
    const marker = await bucket.get(orphanCursorKey);
    if (marker) {
      try {
        const saved = JSON.parse(new TextDecoder().decode(await marker.arrayBuffer()));
        if (saved.version === 1 && typeof saved.cursor === 'string' && saved.cursor.length > 0 && saved.cursor.length <= 4096)
          orphanScanCursor = saved.cursor;
      } catch {
        // An unreadable marker restarts the bounded scan.
      }
    }
  }
  {
    let listed: R2Objects;
    try {
      listed = await bucket.list({ prefix: 'agreements/attachments/', limit: 100, cursor: orphanScanCursor ?? undefined });
    } catch (error) {
      if (!orphanScanCursor || scan) throw error;
      // R2 can reject a damaged or expired opaque cursor. Restart at the first page.
      orphanScanCursor = null;
      listed = await bucket.list({ prefix: 'agreements/attachments/', limit: 100 });
    }
    for (const object of listed.objects) {
      if (orphan_attachments.length >= 100) break;
      const uploaded = object.uploaded;
      if (!(uploaded instanceof Date) || uploaded > orphanCutoff) continue;
      const referenced = await db.prepare(`SELECT 1 WHERE
        EXISTS(SELECT 1 FROM software_agreement_attachments WHERE object_key=?)
        OR EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
          WHERE json_extract(item.value,'$.key')=?)
        OR EXISTS(${activeOfferAttachment()})`).bind(object.key, object.key, object.key).first();
      if (referenced) continue;
      const stored = await bucket.get(object.key);
      if (!stored) continue;
      orphan_attachments.push({
        key: object.key,
        sha256: await hashBytes(await stored.arrayBuffer()),
        uploaded_at: uploaded.toISOString(),
      });
    }
    orphanNextCursor = listed.truncated ? listed.cursor : null;
    if (!scan && !orphan_attachments.length)
      await bucket.put(orphanCursorKey, JSON.stringify({ version: 1, cursor: orphanNextCursor }));
  }
  orphan_attachments.sort((a, b) => a.key.localeCompare(b.key));
  return { version: 1, created_at: now.toISOString(), binding, agreements, unattached_attachments, orphan_attachments, orphan_scan_cursor: orphanScanCursor, orphan_next_cursor: orphanNextCursor };
}
export async function applyAgreementRetention(
  db: D1Database,
  bucket: R2Bucket,
  binding: string,
  manifest: RetentionManifest,
  now = new Date(),
) {
  const age = now.getTime() - Date.parse(manifest.created_at);
  if (
    (manifest.orphan_scan_cursor != null && (typeof manifest.orphan_scan_cursor !== 'string' || manifest.orphan_scan_cursor.length === 0 || manifest.orphan_scan_cursor.length > 4096)) ||
    manifest.version !== 1 ||
    manifest.binding !== binding ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 86400000 ||
    manifest.agreements.length > 20 || !Array.isArray(manifest.unattached_attachments) || manifest.unattached_attachments.length > 100 || (manifest.orphan_attachments !== undefined && (!Array.isArray(manifest.orphan_attachments) || manifest.orphan_attachments.length > 100))
  )
    throw new Error('Review is stale or belongs to different storage.');
  const fresh = await previewAgreementRetention(db, bucket, binding, now, { cursor: manifest.orphan_scan_cursor ?? null });
  if (canonicalJson(fresh.agreements) !== canonicalJson(manifest.agreements) || canonicalJson(fresh.unattached_attachments) !== canonicalJson(manifest.unattached_attachments) || canonicalJson(fresh.orphan_attachments) !== canonicalJson(manifest.orphan_attachments ?? []))
    throw new Error('Archive changed. Preview again.');
  const manifestHash = await hashOfferToken(canonicalJson(manifest));
  for (const item of manifest.agreements) {
    await db.batch([
      softwareGuard(
        db,
        `SELECT 1 FROM software_agreements a WHERE a.id=? AND a.text_sha256=? AND ${eligible}`,
        [item.id, item.sha256, now.toISOString()],
      ),
      ...item.objects.map(object => softwareGuard(db,
        `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM software_agreements other,json_each(other.attachment_manifest_json) attachment WHERE other.id<>? AND json_extract(attachment.value,'$.key')=?)
         AND NOT EXISTS(${activeOfferAttachment()})`,
        [item.id, object.key, object.key],
      )),
      db
        .prepare('UPDATE software_agreements SET archive_closed_at=? WHERE id=?')
        .bind(now.toISOString(), item.id),
    ]);
    // Fail closed. An interrupted delete leaves the retained record and receipt available to the owner for recovery.
    for (const object of item.objects) {
      const stored = await bucket.get(object.key);
      if (stored && (await hashBytes(await stored.arrayBuffer())) !== object.sha256)
        throw new Error('Object changed.');
      await bucket.delete(object.key);
    }
    await db.batch([
      softwareGuard(
        db,
        `SELECT 1 FROM software_agreements a WHERE a.id=? AND a.text_sha256=? AND ${eligible}`,
        [item.id, item.sha256, now.toISOString()],
      ),
      db
        .prepare('INSERT INTO software_agreement_retention_receipts VALUES(?,?,?,?,?)')
        .bind(crypto.randomUUID(), item.id, item.sha256, now.toISOString(), manifestHash),
      db.prepare('DELETE FROM software_agreement_notices WHERE agreement_id=?').bind(item.id),
      db.prepare('DELETE FROM software_agreement_notifications WHERE agreement_id=?').bind(item.id),
      db.prepare('DELETE FROM software_agreement_deliveries WHERE agreement_id=?').bind(item.id),
      db.prepare('DELETE FROM software_agreement_events WHERE agreement_id=?').bind(item.id),
      db.prepare('DELETE FROM software_agreement_artifacts WHERE agreement_id=?').bind(item.id),
      db.prepare('DELETE FROM software_agreement_signatures WHERE agreement_id=?').bind(item.id),
      db
        .prepare(
          'UPDATE software_projects SET agreement_id=NULL WHERE agreement_id=? AND content_deleted_at IS NOT NULL',
        )
        .bind(item.id),
      db
        .prepare('UPDATE software_offers SET reused_msa_id=NULL WHERE reused_msa_id=?')
        .bind(item.id),
      db.prepare(`UPDATE software_offers SET recipient_email_snapshot=NULL,agreement_details_json=NULL
        WHERE id=(SELECT offer_id FROM software_agreements WHERE id=?)
          AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=software_offers.id)
          AND NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.offer_id=software_offers.id AND a.id<>?)`).bind(item.id,item.id),
      db.prepare('DELETE FROM software_agreements WHERE id=?').bind(item.id),
      ...item.objects.map(object => db.prepare(
        "DELETE FROM software_agreement_attachments WHERE object_key=? AND NOT EXISTS(SELECT 1 FROM software_agreements a,json_each(a.attachment_manifest_json) m WHERE json_extract(m.value,'$.key')=software_agreement_attachments.object_key)",
      ).bind(object.key)),

      agreementEvent(db,'retention-deleted','system',now.toISOString()),
    ]);
    await db
      .prepare(
        'DELETE FROM software_agreement_clients WHERE NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.client_id=software_agreement_clients.id)',
      )
      .run();
  }
  for (const attachment of manifest.unattached_attachments) {
    const cutoff = new Date(now.getTime()-30*86400000).toISOString();
    const metadata = await db.prepare(`SELECT id,request_id,filename,version,document_date,object_key,sha256,bytes,created_at,created_by
      FROM software_agreement_attachments WHERE id=? AND object_key=? AND sha256=? AND created_at=?`)
      .bind(attachment.id,attachment.key,attachment.sha256,attachment.created_at).first<{
        id:string; request_id:string; filename:string; version:string; document_date:string; object_key:string;
        sha256:string; bytes:number; created_at:string; created_by:string;
      }>();
    if (!metadata) throw new Error('Archive changed. Preview again.');
    const stored=await bucket.get(attachment.key);
    if (stored && (await hashBytes(await stored.arrayBuffer()))!==attachment.sha256) throw new Error('Unattached PDF changed.');
    // Deleting the metadata row in the same transaction as the final reference check reserves
    // the object: offer saves require this row, so they cannot attach it after this point.
    await db.batch([softwareGuard(db, `SELECT 1 FROM software_agreement_attachments attachment
      WHERE attachment.id=? AND attachment.object_key=? AND attachment.sha256=? AND attachment.created_at=? AND attachment.created_at<=?
        AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
          WHERE json_extract(item.value,'$.key')=attachment.object_key)
        AND NOT EXISTS(${activeOfferAttachment()})`,
      [attachment.id,attachment.key,attachment.sha256,attachment.created_at,cutoff,attachment.key]),
      db.prepare(`DELETE FROM software_agreement_attachments WHERE id=? AND object_key=? AND sha256=? AND created_at=? AND created_at<=?
        AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
          WHERE json_extract(item.value,'$.key')=software_agreement_attachments.object_key)
        AND NOT EXISTS(${activeOfferAttachment()})`)
        .bind(attachment.id,attachment.key,attachment.sha256,attachment.created_at,cutoff,attachment.key)]);
    if (stored) {
      try {
        await bucket.delete(attachment.key);
      } catch (error) {
        // Keep a retryable metadata record if storage refuses deletion. A stale
        // record for an already-removed object is safe: the next reviewed pass
        // can reserve and clear it after confirming it is still unreferenced.
        await db.prepare(`INSERT OR IGNORE INTO software_agreement_attachments
          (id,request_id,filename,version,document_date,object_key,sha256,bytes,created_at,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(metadata.id,metadata.request_id,metadata.filename,metadata.version,metadata.document_date,metadata.object_key,metadata.sha256,metadata.bytes,metadata.created_at,metadata.created_by)
          .run();
        throw error;
      }
    }
  }
  for (const orphan of manifest.orphan_attachments ?? []) {
    const uploadedAt = Date.parse(orphan.uploaded_at);
    if (!Number.isFinite(uploadedAt) || uploadedAt > now.getTime() - 30 * 86400000 || !orphan.key.startsWith('agreements/attachments/'))
      throw new Error('Archive changed. Preview again.');
    const stored = await bucket.get(orphan.key);
    if (!stored || (await hashBytes(await stored.arrayBuffer())) !== orphan.sha256)
      throw new Error('Orphan attachment changed.');
    // If the process stops here, the next preview can rediscover this R2 object.
    // Offer saves require metadata; manifests, metadata and offers are checked again
    // immediately before deletion.
    await db.batch([softwareGuard(db, `SELECT 1 WHERE
      NOT EXISTS(SELECT 1 FROM software_agreement_attachments WHERE object_key=?)
      AND NOT EXISTS(SELECT 1 FROM software_agreements agreement,json_each(agreement.attachment_manifest_json) item
        WHERE json_extract(item.value,'$.key')=?)
      AND NOT EXISTS(${activeOfferAttachment()})`, [orphan.key, orphan.key, orphan.key])]);
    await bucket.delete(orphan.key);
  }
  const marker = await bucket.get(orphanCursorKey);
  let savedCursor: string | null = null;
  if (marker) {
    try {
      const saved = JSON.parse(new TextDecoder().decode(await marker.arrayBuffer()));
      if (saved.version === 1 && typeof saved.cursor === 'string') savedCursor = saved.cursor;
    } catch {
      // Match the preview's restart for an unreadable marker.
    }
  }
  if (savedCursor === (manifest.orphan_scan_cursor ?? null))
    await bucket.put(orphanCursorKey, JSON.stringify({ version: 1, cursor: fresh.orphan_next_cursor ?? null }), {
      onlyIf: marker ? { etagMatches: marker.etag } : { etagDoesNotMatch: '*' },
    });
}
