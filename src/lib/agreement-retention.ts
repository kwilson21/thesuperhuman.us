import { canonicalJson,hashBytes } from './agreement-artifacts';
import { hashOfferToken } from './software-offers';
import { softwareGuard } from './software-projects';
export type RetentionManifest={version:1;created_at:string;binding:string;agreements:{id:string;sha256:string;row_hash:string;objects:{key:string;sha256:string}[]}[]};
// A referenced record stays retained. Later owner reviews can include it once every dependent record is retired.
const eligible=`a.status IN ('executed','abandoned') AND a.ended_at IS NOT NULL AND a.retain_until IS NOT NULL AND a.retain_until<=? AND a.legal_hold=0
 AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.agreement_id=a.id AND p.content_deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM software_offers o WHERE o.reused_msa_id=a.id AND (EXISTS(SELECT 1 FROM software_agreements sow WHERE sow.offer_id=o.id) OR (o.status IN ('sent','draft') AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.offer_id=o.id AND p.content_deleted_at IS NOT NULL))))
 AND NOT EXISTS(SELECT 1 FROM software_agreements s WHERE s.msa_id=a.id)
 AND (a.kind='sow' OR a.terminated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM software_agreement_signatures sig WHERE sig.agreement_id=a.id))`;
export async function previewAgreementRetention(db:D1Database,bucket:R2Bucket,binding:string,now=new Date()):Promise<RetentionManifest> {
 const rows=(await db.prepare(`SELECT a.* FROM software_agreements a WHERE ${eligible} ORDER BY a.id LIMIT 20`).bind(now.toISOString()).all<Record<string,unknown>&{id:string;text_sha256:string;attachment_manifest_json:string}>()).results;
 const agreements:RetentionManifest['agreements']=[];
 for(const row of rows) {
  const objects:{key:string;sha256:string}[]=[];
  let cursor:string|undefined;
  do {const listed=await bucket.list({prefix:`agreements/${row.id}/`,cursor});for(const object of listed.objects){const value=await bucket.get(object.key);if(!value)throw new Error('Archive changed.');objects.push({key:object.key,sha256:await hashBytes(await value.arrayBuffer())});}cursor=listed.truncated?listed.cursor:undefined;}while(cursor);
  for(const attachment of JSON.parse(row.attachment_manifest_json) as {key:string;sha256:string}[]) {
   const shared=await db.prepare("SELECT 1 FROM software_agreements other,json_each(other.attachment_manifest_json) attachment WHERE other.id<>? AND json_extract(attachment.value,'$.key')=?").bind(row.id,attachment.key).first();
   if(!shared)objects.push({key:attachment.key,sha256:attachment.sha256});
  }
  agreements.push({id:row.id,sha256:row.text_sha256,row_hash:await hashOfferToken(canonicalJson(row)),objects:objects.sort((a,b)=>a.key.localeCompare(b.key))});
 }
 return {version:1,created_at:now.toISOString(),binding,agreements};
}
export async function applyAgreementRetention(db:D1Database,bucket:R2Bucket,binding:string,manifest:RetentionManifest,now=new Date()) {
 const age=now.getTime()-Date.parse(manifest.created_at);
 if(manifest.version!==1||manifest.binding!==binding||!Number.isFinite(age)||age<0||age>86400000||manifest.agreements.length>20)throw new Error('Review is stale or belongs to different storage.');
 const fresh=await previewAgreementRetention(db,bucket,binding,now);
 if(canonicalJson(fresh.agreements)!==canonicalJson(manifest.agreements))throw new Error('Archive changed. Preview again.');
 const manifestHash=await hashOfferToken(canonicalJson(manifest));
 for(const item of manifest.agreements) {
  await db.batch([softwareGuard(db,`SELECT 1 FROM software_agreements a WHERE a.id=? AND a.text_sha256=? AND ${eligible}`,[item.id,item.sha256,now.toISOString()]),db.prepare('UPDATE software_agreements SET archive_closed_at=? WHERE id=?').bind(now.toISOString(),item.id)]);
  // Fail closed. An interrupted delete leaves the retained record and receipt available to the owner for recovery.
  for(const object of item.objects){const stored=await bucket.get(object.key);if(stored&&await hashBytes(await stored.arrayBuffer())!==object.sha256)throw new Error('Object changed.');await bucket.delete(object.key);}
  await db.batch([
   softwareGuard(db,`SELECT 1 FROM software_agreements a WHERE a.id=? AND a.text_sha256=? AND ${eligible}`,[item.id,item.sha256,now.toISOString()]),
   db.prepare('INSERT INTO software_agreement_retention_receipts VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),item.id,item.sha256,now.toISOString(),manifestHash),
   db.prepare('DELETE FROM software_agreement_notices WHERE agreement_id=?').bind(item.id),
   db.prepare('DELETE FROM software_agreement_notifications WHERE agreement_id=?').bind(item.id),
   db.prepare('DELETE FROM software_agreement_deliveries WHERE agreement_id=?').bind(item.id),db.prepare('DELETE FROM software_agreement_events WHERE agreement_id=?').bind(item.id),db.prepare('DELETE FROM software_agreement_artifacts WHERE agreement_id=?').bind(item.id),db.prepare('DELETE FROM software_agreement_signatures WHERE agreement_id=?').bind(item.id),db.prepare('UPDATE software_projects SET agreement_id=NULL WHERE agreement_id=? AND content_deleted_at IS NOT NULL').bind(item.id),db.prepare('UPDATE software_offers SET reused_msa_id=NULL WHERE reused_msa_id=?').bind(item.id),db.prepare('DELETE FROM software_agreements WHERE id=?').bind(item.id),
  ]);
  for(const object of item.objects)await db.prepare("DELETE FROM software_agreement_attachments WHERE object_key=? AND NOT EXISTS(SELECT 1 FROM software_agreements a,json_each(a.attachment_manifest_json) m WHERE json_extract(m.value,'$.key')=software_agreement_attachments.object_key)").bind(object.key).run();
  await db.prepare('DELETE FROM software_agreement_clients WHERE NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.client_id=software_agreement_clients.id)').run();
 }
}
