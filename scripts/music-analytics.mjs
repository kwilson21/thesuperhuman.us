import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

export const dailyPlayback = `SELECT day,release_id,recording_id,medium,event,sum(count) AS count FROM (
  SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,count(*) AS count
  FROM music_events GROUP BY day,release_id,recording_id,medium,event
  UNION ALL SELECT day,release_id,recording_id,medium,event,count FROM music_event_daily
) GROUP BY day,release_id,recording_id,medium,event`;
export const lifetimePlayback = `SELECT release_id,recording_id,medium,event,sum(count) AS count
FROM (${dailyPlayback}) GROUP BY release_id,recording_id,medium,event`;
export const lifetimeOwnerPlayback = `SELECT release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city,SUM(count) AS count FROM (
  SELECT release_id,recording_id,medium,event,COALESCE(campaign_id,'') AS campaign_id,COALESCE(channel,'') AS channel,
    COALESCE(creative,'') AS creative,country,region,city,COUNT(*) AS count FROM music_playback_events WHERE traffic_class='human'
    GROUP BY release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city
  UNION ALL SELECT release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city,count FROM music_playback_daily
) GROUP BY release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city`;

// Keep operator access on the same dedicated MUSIC_DB binding as existing reports.
export async function openMusicDatabase(remote) {
  const proxy = remote ? null : await (await import('wrangler')).getPlatformProxy({
    configPath: resolve('.private/wrangler-music-preview.json'), persist: { path: '.wrangler/state/v3' },
  });
  return {
    async query(sql) {
      if (proxy) return (await proxy.env.MUSIC_DB.prepare(sql).all()).results;
      // Remove transient Wrangler logs, which may contain query results.
      await mkdir('.private', { recursive: true });
      const temporary = await mkdtemp(resolve('.private/music-query-'));
      try {
        const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'MUSIC_DB', '--remote', '--json', '--command', sql], {
          encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, WRANGLER_LOG_PATH: resolve(temporary, 'wrangler.log') },
        });
        if (result.status !== 0) throw new Error('Music database query failed. Check MUSIC_DB and Cloudflare authentication. No cleanup retry is automatic.');
        return JSON.parse(result.stdout)[0].results;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async batch(statements) {
      if (proxy) return proxy.env.MUSIC_DB.batch(statements.map(sql => proxy.env.MUSIC_DB.prepare(sql)));
      await mkdir('.private', { recursive: true });
      const temporary = await mkdtemp(resolve('.private/music-batch-'));
      try {
        const file = resolve(temporary, 'retention.sql');
        await writeFile(file, statements.map(sql => `${sql};`).join('\n'), { mode: 0o600 });
        const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'MUSIC_DB', '--remote', '--yes', '--json', '--file', file], {
          encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, WRANGLER_LOG_PATH: resolve(temporary, 'wrangler.log') },
        });
        if (result.status !== 0) throw new Error('Atomic music database batch failed. D1 rolled back the reviewed retention file; no automatic retry was attempted.');
        return JSON.parse(result.stdout);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async close() { await proxy?.dispose(); },
  };
}
