export type CampaignAttribution = {
  campaignId?: string;
  channel?: string;
  creative?: string;
};

export type CampaignTag = Required<CampaignAttribution>;

export async function resolveCampaignTag(db: D1Database, attribution: CampaignAttribution): Promise<CampaignTag | null> {
  const { campaignId, channel, creative } = attribution;
  if (!campaignId || !channel || !creative) return null;
  const row = await db.prepare(`SELECT t.campaign_id,t.channel,t.creative
    FROM owner_campaign_tags t JOIN owner_campaigns c ON c.id=t.campaign_id
    WHERE t.campaign_id=? AND t.channel=? AND t.creative=? AND c.status='active'`)
    .bind(campaignId, channel, creative).first<{ campaign_id: string; channel: string; creative: string }>();
  return row ? { campaignId: row.campaign_id, channel: row.channel, creative: row.creative } : null;
}
