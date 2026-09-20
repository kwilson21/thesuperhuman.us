import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveCampaignTag } from '~/lib/owner-campaigns';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
  sql.exec(`INSERT INTO owner_campaigns
    (id,subject_type,subject_id,name,primary_goal,starts_at,status,created_at,updated_at)
    VALUES ('old-news','release','old-news-single','Old News launch','Meaningful listening','2026-09-16','active','now','now');
    INSERT INTO owner_campaign_tags VALUES ('old-news','instagram','lyric-clip');`);
  const db = { prepare: (query: string) => ({ bind: (...args: unknown[]) => ({ first: async () => sql.prepare(query).get(...args) ?? null }) }) };
  return db as unknown as D1Database;
}

describe('controlled campaign attribution', () => {
  it('returns only an active campaign tag defined by the owner plan', async () => {
    const db = fixture();
    await expect(resolveCampaignTag(db, { campaignId: 'old-news', channel: 'instagram', creative: 'lyric-clip' }))
      .resolves.toEqual({ campaignId: 'old-news', channel: 'instagram', creative: 'lyric-clip' });
    await expect(resolveCampaignTag(db, { campaignId: 'old-news', channel: 'anything', creative: 'free-text' }))
      .resolves.toBeNull();
    await expect(resolveCampaignTag(db, {})).resolves.toBeNull();
  });
});
