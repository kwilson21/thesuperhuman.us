import {
  ownerRequestFromRow,
  ownerRequestKinds,
  ownerRequestStatuses,
  type OwnerRequest,
  type OwnerRequestKind,
  type OwnerRequestRow,
  type OwnerRequestStatus,
} from './owner-model';

export type NewOwnerRequest = {
  kind: OwnerRequestKind;
  releaseId?: string;
  serviceId?: string;
  campaignId?: string;
  name?: string;
  email: string;
  cityRegion?: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type RequestCommand =
  | { id: string; action: 'review' | 'resolve' | 'reopen' | 'withdraw'; actor: string }
  | { id: string; action: 'note'; actor: string; note: string };

const requestColumns = `id,kind,release_id,service_id,campaign_id,name,email,city_region,
  summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after`;

function validActor(actor: string) {
  const value = actor.trim().toLowerCase();
  if (!value || value.length > 320) throw new Error('Invalid request actor.');
  return value;
}

export async function saveOwnerRequest(db: D1Database, input: NewOwnerRequest, actor = 'system'): Promise<OwnerRequest> {
  if (!ownerRequestKinds.includes(input.kind)) throw new Error('Invalid request kind.');
  const details = JSON.stringify(input.details ?? {});
  if (details.length > 16_000) throw new Error('Request details are too large.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO owner_requests
      (id,kind,release_id,service_id,campaign_id,name,email,city_region,summary,details_json,status,private_note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'new','',?,?)`)
      .bind(id, input.kind, input.releaseId ?? null, input.serviceId ?? null, input.campaignId ?? null,
        input.name?.trim() ?? '', input.email.trim().toLowerCase(), input.cityRegion?.trim() ?? '',
        input.summary.trim(), details, now, now),
    db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      VALUES (?,'created',?,'',?)`).bind(id, validActor(actor), now),
  ]);
  return (await getOwnerRequest(db, id))!;
}

export async function getOwnerRequest(db: D1Database, id: string): Promise<OwnerRequest | null> {
  const row = await db.prepare(`SELECT ${requestColumns} FROM owner_requests WHERE id=?`).bind(id).first<OwnerRequestRow>();
  return row ? ownerRequestFromRow(row) : null;
}

export async function listOwnerRequests(db: D1Database, filter: { kind?: OwnerRequestKind; status?: OwnerRequestStatus } = {}) {
  if (filter.kind && !ownerRequestKinds.includes(filter.kind)) throw new Error('Invalid request kind.');
  if (filter.status && !ownerRequestStatuses.includes(filter.status)) throw new Error('Invalid request status.');
  const clauses: string[] = [];
  const values: string[] = [];
  if (filter.kind) { clauses.push('kind=?'); values.push(filter.kind); }
  if (filter.status) { clauses.push('status=?'); values.push(filter.status); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const result = await db.prepare(`SELECT ${requestColumns} FROM owner_requests${where} ORDER BY created_at DESC`)
    .bind(...values).all<OwnerRequestRow>();
  return result.results.map(ownerRequestFromRow);
}

export async function changeOwnerRequest(db: D1Database, command: RequestCommand): Promise<OwnerRequest> {
  const current = await getOwnerRequest(db, command.id);
  if (!current) throw new Error('Request not found.');
  const actor = validActor(command.actor);
  const now = new Date().toISOString();
  if (command.action === 'note') {
    const note = command.note.trim();
    if (note.length > 1000) throw new Error('Private note must be 1,000 characters or fewer.');
    const [update] = await db.batch([
      db.prepare(`UPDATE owner_requests SET private_note=?,updated_at=? WHERE id=? AND updated_at=? RETURNING ${requestColumns}`)
        .bind(note, now, command.id, current.updatedAt),
      db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
        SELECT ?,'note-updated',?,'',? WHERE EXISTS
          (SELECT 1 FROM owner_requests WHERE id=? AND updated_at=? AND private_note=?)`)
        .bind(command.id, actor, now, command.id, now, note),
    ]);
    const row = update.results[0] as OwnerRequestRow | undefined;
    if (!row) throw new Error('Request changed while it was being updated.');
    return ownerRequestFromRow(row);
  }

  const transitions = {
    review: { from: ['new'], to: 'reviewed', audit: 'reviewed' },
    resolve: { from: ['new', 'reviewed'], to: 'resolved', audit: 'resolved' },
    reopen: { from: ['reviewed', 'resolved'], to: 'new', audit: 'reopened' },
    withdraw: { from: ['new', 'reviewed', 'resolved'], to: 'withdrawn', audit: 'withdrawn' },
  } as const;
  const transition = transitions[command.action];
  if (!(transition.from as readonly OwnerRequestStatus[]).includes(current.status)) throw new Error('Invalid request transition.');
  const placeholders = transition.from.map(() => '?').join(',');
  const resolvedAt = transition.to === 'resolved' ? now : null;
  const [update] = await db.batch([
    db.prepare(`UPDATE owner_requests SET status=?,resolved_at=?,updated_at=?
      WHERE id=? AND updated_at=? AND status IN (${placeholders}) RETURNING ${requestColumns}`)
      .bind(transition.to, resolvedAt, now, command.id, current.updatedAt, ...transition.from),
    db.prepare(`INSERT INTO owner_request_audit (request_id,action,actor,note,occurred_at)
      SELECT ?,? ,?,'',? WHERE EXISTS
        (SELECT 1 FROM owner_requests WHERE id=? AND updated_at=? AND status=?)`)
      .bind(command.id, transition.audit, actor, now, command.id, now, transition.to),
  ]);
  const row = update.results[0] as OwnerRequestRow | undefined;
  if (!row) throw new Error('Request changed while it was being updated.');
  return ownerRequestFromRow(row);
}
