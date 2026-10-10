import { hashValue } from './audio-client-access';
import type { ProjectMessage } from './audio-project-messages';
import { z } from 'astro/zod';
import { deliveredIndexes, getSoftwareProject, projectTerms, softwareAudit, softwareGuard, softwareClientRevisionBody, softwareVersionLabel, softwareVersionNumber, softwareRevisionHistoryBody } from './software-projects';
import type { SoftwareDecision, SoftwareUpdate } from './software-projects';
export type SoftwareProjectMessage = Omit<ProjectMessage, 'review_decision'> & { review_decision: null; decision: SoftwareDecision | null; update_id: string | null };
const messageColumns = 'id,actor,body,created_at,read_at,NULL AS review_decision,decision,update_id';
export const softwareDecisionInput = z.discriminatedUnion('decision', [
  z.object({decision:z.literal('direction_confirmed')}),
  z.object({decision:z.literal('milestone_accepted'),confirm:z.literal(true)}),
  z.object({decision:z.literal('changes_requested'),criteria:z.array(z.number().int().min(0).max(19)).max(20).default([]),
    missing_deliverables:z.array(z.number().int().min(0).max(19)).max(20).default([]),
    inaccessible_deliverables:z.array(z.number().int().min(0).max(19)).max(20).default([]),
    note:z.string().trim().min(1).max(2000).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]|\p{Cs}/u.test(value))}),
]);
export async function postSoftwareReviewDecision(db: D1Database, id: string, token: string, updateId: string, input: z.infer<typeof softwareDecisionInput>, now = new Date()) {
  const update = await db.prepare("SELECT * FROM software_project_updates WHERE request_id=? AND id=? AND status='shared' AND kind IN ('direction_review','delivery_review')").bind(id,updateId).first<SoftwareUpdate>();
  const project = await getSoftwareProject(db,id);
  if (!update || !project) return {ok:false,status:409};
  const direction = update.kind === 'direction_review', milestone = projectTerms(project).milestones[update.milestone_index], checks = milestone.acceptance;
  const delivered = deliveredIndexes(update, milestone.deliverables);
  if ((input.decision === 'direction_confirmed' && !direction) || (input.decision === 'milestone_accepted' && direction)) return {ok:false,status:400,error:"This decision doesn’t apply to this review."};
  if (input.decision === 'milestone_accepted' && milestone.deliverables.some((_,index)=>!delivered.includes(index)))
    return {ok:false,status:400,error:'This version includes only part of the milestone. The client can accept after every agreed deliverable is included in a review.'};
  const criteria = input.decision === 'changes_requested' ? [...new Set(input.criteria)].sort((first,second)=>first-second) : [];
  const missing = input.decision === 'changes_requested' ? [...new Set(input.missing_deliverables)].sort((first,second)=>first-second) : [];
  const inaccessible = input.decision === 'changes_requested' ? [...new Set(input.inaccessible_deliverables)].sort((first,second)=>first-second) : [];
  if (criteria.some(index=>index >= checks.length) || missing.some(index=>index >= milestone.deliverables.length || delivered.includes(index)) ||
    inaccessible.some(index=>index >= milestone.deliverables.length || !delivered.includes(index)) ||
    (!direction && input.decision === 'changes_requested' && !criteria.length && !missing.length && !inaccessible.length))
    return {ok:false,status:400,error:'Choose an unmet check, an omitted deliverable, or an included deliverable you cannot access. Tell me what happened.'};
  const tokenHash = await hashValue(token), at = now.toISOString();
  const label = input.decision === 'direction_confirmed' ? 'Direction confirmed' : input.decision === 'milestone_accepted' ? 'Accepted' : 'Changes requested';
  const version = `${update.artifact_version} for milestone ${update.milestone_index+1}`;
  const body = input.decision === 'changes_requested' ? `Requested changes to ${version}. Checks reported unmet: [${criteria.map(index=>index+1).join(', ')}]. Deliverables unavailable: [${missing.map(index=>index+1).join(', ')}]. Included but inaccessible: [${inaccessible.map(index=>index+1).join(', ')}].\n\n${input.note}` : `${direction ? 'Confirmed' : 'Accepted'} ${version}.`;
  const note = `${label} on ${update.artifact_version} · milestone ${update.milestone_index+1}${criteria.length ? ` · checks ${criteria.map(index=>index+1).join(', ')}` : ''}${missing.length ? ` · missing deliverables ${missing.map(index=>index+1).join(', ')}` : ''}${inaccessible.length ? ` · inaccessible deliverables ${inaccessible.map(index=>index+1).join(', ')}` : ''}`;
  await db.batch([
    softwareGuard(db,`SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id JOIN audio_client_sessions s ON s.email=r.email
      JOIN software_project_updates u ON u.request_id=p.request_id
      WHERE p.request_id=? AND p.revoked_at IS NULL AND p.content_deleted_at IS NULL AND p.state<>'complete' AND r.status<>'withdrawn' AND r.email<>''
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.id=? AND u.status='shared' AND u.kind=?
      AND NOT EXISTS(SELECT 1 FROM software_project_updates newer WHERE newer.request_id=u.request_id AND newer.kind=u.kind AND newer.milestone_index=u.milestone_index
        AND newer.status='shared' AND (newer.shared_at>u.shared_at OR (newer.shared_at=u.shared_at AND newer.id>u.id)))
      AND NOT EXISTS(SELECT 1 FROM software_project_messages WHERE update_id=u.id AND decision IS NOT NULL)`,[id,tokenHash,at,updateId,update.kind]),
    db.prepare('INSERT INTO software_project_messages(request_id,actor,actor_id,body,update_id,decision,created_at) VALUES (?,\'client\',?,?,?,?,?)')
      .bind(id,tokenHash,body,updateId,input.decision,at),
    db.prepare(`UPDATE software_projects SET state='building',step=?,waiting_for='',updated_at=? WHERE request_id=? AND milestone_index=?
      AND NOT EXISTS(SELECT 1 FROM software_project_updates newer WHERE newer.request_id=? AND newer.milestone_index=software_projects.milestone_index AND newer.status='shared'
        AND newer.kind IN ('direction_review','delivery_review') AND (newer.shared_at>? OR (newer.shared_at=? AND newer.id>?)))`)
      .bind(input.decision==='milestone_accepted' ? 'handoff' : direction && input.decision==='changes_requested' ? 'direction' : 'build',at,id,update.milestone_index,id,update.shared_at,update.shared_at,update.id),
    db.prepare("INSERT INTO software_project_audit(request_id,action,actor,occurred_at,note) SELECT ?,'state-changed','client',?,'' WHERE changes()>0").bind(id,at),
    softwareAudit(db,id,'decision-recorded','client',at,note),
  ]);
  return {ok:true,status:200};
}
const CLIENT_MESSAGE_WINDOW_MS = 300_000, CLIENT_MESSAGE_LIMIT = 12;
export async function listSoftwareProjectMessages(db: D1Database, requestId: string): Promise<SoftwareProjectMessage[]> {
  const result = await db.prepare(`SELECT ${messageColumns} FROM software_project_messages WHERE request_id=? ORDER BY id`)
    .bind(requestId).all<SoftwareProjectMessage>();
  return result.results;
}
export function readableSoftwareProjectMessages(
  messages: SoftwareProjectMessage[],
  updates: { id: string; milestone_index?: number | null; artifact_version?: string; kind?: string }[],
  terms: ReturnType<typeof projectTerms>,
  reader: 'owner' | 'client' = 'owner',
) {
  return messages.map(message=>{
    if(!message.decision || !message.update_id) return message;
    const update=updates.find(item=>item.id===message.update_id), milestone=terms.milestones[update?.milestone_index ?? 0];
    if(!milestone || !update) return message;
    if(reader==='owner') return message.decision==='changes_requested' ? {...message,body:softwareRevisionHistoryBody(message.body,milestone.acceptance,milestone.deliverables)} : message;
    const label=softwareVersionLabel({artifact_version:update.artifact_version ?? '',kind:update.kind});
    const version=softwareVersionNumber({artifact_version:update.artifact_version ?? ''}) ? label.toLowerCase() : label;
    const milestoneLabel=terms.milestones.length>1 ? ` of milestone ${(update.milestone_index ?? 0)+1}` : '';
    if(message.decision!=='changes_requested') return {...message,body:message.decision==='direction_confirmed' ? terms.milestones.length>1 ? `You confirmed the direction for milestone ${(update.milestone_index ?? 0)+1}.` : 'You confirmed this direction.' : `You accepted ${version}${milestoneLabel}.`};
    return {...message,body:`You asked for changes to ${version}${milestoneLabel}.\n\n${softwareClientRevisionBody(message.body,milestone.acceptance,milestone.deliverables)}`};
  });
}

export async function postOwnerSoftwareProjectMessage(db: D1Database, requestId: string, ownerEmail: string, body: string, now = new Date()): Promise<SoftwareProjectMessage | null> {
  return db.prepare(`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'owner',?,?,? FROM software_projects p
    JOIN owner_requests r ON r.id=p.request_id
    WHERE p.request_id=? AND p.state<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
    RETURNING ${messageColumns}`)
    .bind(ownerEmail, body, now.toISOString(), requestId).first<SoftwareProjectMessage>();
}

export async function postClientSoftwareProjectMessage(db: D1Database, requestId: string, token: string, body: string, now = new Date()): Promise<SoftwareProjectMessage | null> {
  const tokenHash = await hashValue(token);
  const windowStart = new Date(now.getTime() - CLIENT_MESSAGE_WINDOW_MS).toISOString();
  // The count and write belong to one SQL statement so concurrent sends cannot
  // all pass a separate KV read before any of them saves a message.
  return db.prepare(`INSERT INTO software_project_messages(request_id,actor,actor_id,body,created_at)
    SELECT p.request_id,'client',?,?,? FROM software_projects p
    JOIN owner_requests r ON r.id=p.request_id
    JOIN audio_client_sessions s ON s.email=r.email
    WHERE p.request_id=? AND p.state<>'complete' AND p.revoked_at IS NULL AND r.status<>'withdrawn'
      AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND (SELECT count(*) FROM software_project_messages m
        WHERE m.request_id=? AND m.actor='client' AND m.created_at>?)<?
    RETURNING ${messageColumns}`)
    .bind(tokenHash, body, now.toISOString(), requestId, tokenHash, now.toISOString(),
      requestId, windowStart, CLIENT_MESSAGE_LIMIT).first<SoftwareProjectMessage>();
}

export async function markProjectMessagesRead(db: D1Database, requestId: string, reader: 'owner' | 'client', messageId: number, token: string | null = null, now = new Date()): Promise<void> {
  if (!Number.isInteger(messageId) || messageId < 1) return;
  const sender = reader === 'owner' ? 'client' : 'owner';
  if (reader === 'owner') {
    await db.prepare(`UPDATE software_project_messages SET read_at=? WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL`)
      .bind(now.toISOString(), messageId, requestId, sender).run();
    return;
  }
  if (!token) return;
  const tokenHash = await hashValue(token);
  await db.prepare(`UPDATE software_project_messages SET read_at=?
    WHERE id=? AND request_id=? AND actor=? AND read_at IS NULL AND EXISTS(
      SELECT 1 FROM software_projects p JOIN owner_requests r ON r.id=p.request_id
      JOIN audio_client_sessions s ON s.email=r.email
      WHERE p.request_id=software_project_messages.request_id AND p.revoked_at IS NULL
        AND r.status<>'withdrawn' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?)`)
    .bind(now.toISOString(), messageId, requestId, sender, tokenHash, now.toISOString()).run();
}
