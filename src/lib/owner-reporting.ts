import { ownerRequestFromRow, type OwnerRequest, type OwnerRequestRow } from './owner-model';

export type ListeningSummary = {
  reportedStarts: number;
  reported30SecondListens: number;
  reportedCompletions: number;
  replays: number;
};
export type GeographySummary = { cities: { label: string; reportedListens: number }[] };
export type CampaignSummary = { id: string; name: string; primaryGoal: string; startsAt: string; endsAt: string | null; status: 'draft' | 'active' | 'complete' };
export type CampaignDesk = CampaignSummary & {
  subjectType: 'release' | 'service'; subjectId: string; status: 'draft' | 'active' | 'complete';
  secondarySignals: string[]; approvedPlan: string; retrospective: string; nextLesson: string;
  listening: ListeningSummary; geography: GeographySummary;
  demand: { purchase: number; merchandise: number; subscribers: number };
  requests: OwnerRequest[]; channels: { channel: string; creative: string }[];
};
export type StudioLedger = {
  attention: { newRequests: number };
  listening: ListeningSummary;
  geography: GeographySummary;
  activeCampaign: CampaignSummary | null;
  attentionRequests: OwnerRequest[];
  activeCampaignListening: ListeningSummary;
  observations: string[];
};
export type AudiencePermission = { email: string; status: 'subscribed' | 'unsubscribed'; grantedAt: string; withdrawnAt: string | null; sourceRequestId: string | null };

type CampaignRow = {
  id: string; subject_type: 'release' | 'service'; subject_id: string; name: string; primary_goal: string;
  secondary_signals: string; starts_at: string; ends_at: string | null; approved_plan: string;
  retrospective: string; next_lesson: string; status: 'draft' | 'active' | 'complete';
};
const requestColumns = `id,kind,release_id,service_id,campaign_id,name,email,city_region,
  summary,details_json,status,private_note,created_at,updated_at,resolved_at,contact_delete_after`;

async function listening(db: D1Database, campaignId?: string): Promise<ListeningSummary> {
  const campaign = campaignId ? ' AND campaign_id=?' : '';
  const query = `SELECT event,COUNT(*) AS total FROM music_playback_events
    WHERE traffic_class='human'${campaign} AND event IN ('start','listen30','complete','replay') GROUP BY event`;
  const rows = (await db.prepare(query).bind(...(campaignId ? [campaignId] : [])).all<{ event: string; total: number }>()).results;
  const count = (event: string) => Number(rows.find(row => row.event === event)?.total ?? 0);
  return { reportedStarts: count('start') + count('replay'), reported30SecondListens: count('listen30'), reportedCompletions: count('complete'), replays: count('replay') };
}

async function geography(db: D1Database, campaignId?: string): Promise<GeographySummary> {
  const campaign = campaignId ? ' AND campaign_id=?' : '';
  const rows = (await db.prepare(`SELECT city,region,COUNT(DISTINCT session_id) AS total
    FROM music_playback_events WHERE traffic_class='human' AND event IN ('listen30','complete')
      AND city<>''${campaign} GROUP BY city,region ORDER BY total DESC,city ASC`)
    .bind(...(campaignId ? [campaignId] : [])).all<{ city: string; region: string; total: number }>()).results;
  const visible = rows.filter(row => Number(row.total) >= 5).map(row => ({ label: row.region ? `${row.city}, ${row.region}` : row.city, reportedListens: Number(row.total) }));
  const suppressed = rows.filter(row => Number(row.total) < 5).reduce((sum, row) => sum + Number(row.total), 0);
  if (suppressed) visible.push({ label: 'Other locations', reportedListens: suppressed });
  return { cities: visible };
}

async function requests(db: D1Database, where = '', values: unknown[] = [], limit = 6) {
  const rows = (await db.prepare(`SELECT ${requestColumns} FROM owner_requests ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, limit).all<OwnerRequestRow>()).results;
  return rows.map(ownerRequestFromRow);
}

function campaignSummary(row: CampaignRow): CampaignSummary {
  return { id: row.id, name: row.name, primaryGoal: row.primary_goal, startsAt: row.starts_at, endsAt: row.ends_at, status: row.status };
}

export async function loadCampaignDesk(db: D1Database, campaignId: string, now: Date): Promise<CampaignDesk | null> {
  const row = await db.prepare(`SELECT id,subject_type,subject_id,name,primary_goal,secondary_signals,starts_at,ends_at,
    approved_plan,retrospective,next_lesson,status FROM owner_campaigns WHERE id=?`).bind(campaignId).first<CampaignRow>();
  if (!row) return null;
  const end = row.ends_at ?? now.toISOString();
  const subjectColumn = row.subject_type === 'release' ? 'release_id' : 'service_id';
  const relatedRequests = await requests(db, `WHERE (campaign_id=? OR (campaign_id IS NULL AND ${subjectColumn}=? AND created_at>=? AND created_at<=?))`, [row.id, row.subject_id, row.starts_at, end], 10);
  const demandRows = (await db.prepare(`SELECT kind,COUNT(*) AS total FROM owner_requests
    WHERE (campaign_id=? OR (campaign_id IS NULL AND ${subjectColumn}=? AND created_at>=? AND created_at<=?))
      AND kind IN ('purchase','merchandise') GROUP BY kind`)
    .bind(row.id, row.subject_id, row.starts_at, end).all<{ kind: 'purchase' | 'merchandise'; total: number }>()).results;
  const demand = {
    purchase: Number(demandRows.find(item => item.kind === 'purchase')?.total ?? 0),
    merchandise: Number(demandRows.find(item => item.kind === 'merchandise')?.total ?? 0),
    subscribers: 0,
  };
  if (row.subject_type === 'release') {
    const subscriber = await db.prepare(`SELECT COUNT(*) AS total FROM owner_audience_permissions permission
      JOIN owner_requests request ON request.id=permission.source_request_id
      WHERE permission.status='subscribed' AND request.release_id=? AND permission.granted_at>=? AND permission.granted_at<=?`)
      .bind(row.subject_id, row.starts_at, end).first<{ total: number }>();
    demand.subscribers = Number(subscriber?.total ?? 0);
  }
  const channels = (await db.prepare(`SELECT channel,creative FROM owner_campaign_tags WHERE campaign_id=? ORDER BY channel,creative`)
    .bind(row.id).all<{ channel: string; creative: string }>()).results;
  return {
    ...campaignSummary(row), subjectType: row.subject_type, subjectId: row.subject_id, status: row.status,
    secondarySignals: JSON.parse(row.secondary_signals) as string[], approvedPlan: row.approved_plan,
    retrospective: row.retrospective, nextLesson: row.next_lesson,
    listening: await listening(db, row.id), geography: await geography(db, row.id), demand,
    requests: relatedRequests, channels,
  };
}

export async function loadStudioLedger(db: D1Database, now: Date): Promise<StudioLedger> {
  const newRow = await db.prepare(`SELECT COUNT(*) AS total FROM owner_requests WHERE status='new'`).first<{ total: number }>();
  const campaign = await db.prepare(`SELECT id,subject_type,subject_id,name,primary_goal,secondary_signals,starts_at,ends_at,
    approved_plan,retrospective,next_lesson,status FROM owner_campaigns
    WHERE status='active' AND starts_at<=? AND (ends_at IS NULL OR ends_at>=?) ORDER BY starts_at DESC LIMIT 1`)
    .bind(now.toISOString(), now.toISOString()).first<CampaignRow>();
  const listeningSummary = await listening(db);
  const observations: string[] = [];
  if (Number(newRow?.total ?? 0)) observations.push(`${Number(newRow?.total)} people are waiting for review.`);
  if (listeningSummary.reported30SecondListens) observations.push(`${listeningSummary.reported30SecondListens} reported listens reached 30 seconds.`);
  return {
    attention: { newRequests: Number(newRow?.total ?? 0) }, listening: listeningSummary,
    geography: await geography(db), activeCampaign: campaign ? campaignSummary(campaign) : null,
    attentionRequests: await requests(db, `WHERE status='new'`, [], 4),
    activeCampaignListening: campaign ? await listening(db, campaign.id) : { reportedStarts: 0, reported30SecondListens: 0, reportedCompletions: 0, replays: 0 },
    observations,
  };
}

export async function listCampaigns(db: D1Database): Promise<CampaignSummary[]> {
  const rows = (await db.prepare(`SELECT id,subject_type,subject_id,name,primary_goal,secondary_signals,starts_at,ends_at,
    approved_plan,retrospective,next_lesson,status FROM owner_campaigns ORDER BY starts_at DESC`).all<CampaignRow>()).results;
  return rows.map(campaignSummary);
}

export async function listAudience(db: D1Database): Promise<AudiencePermission[]> {
  const rows = (await db.prepare(`SELECT email,status,granted_at,withdrawn_at,source_request_id FROM owner_audience_permissions ORDER BY granted_at DESC`)
    .all<{ email: string; status: 'subscribed' | 'unsubscribed'; granted_at: string; withdrawn_at: string | null; source_request_id: string | null }>()).results;
  return rows.map(row => ({ email: row.email, status: row.status, grantedAt: row.granted_at, withdrawnAt: row.withdrawn_at, sourceRequestId: row.source_request_id }));
}
