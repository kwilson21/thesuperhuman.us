import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';

export const dailyPlayback = `SELECT day,release_id,recording_id,medium,event,sum(count) AS count FROM (
  SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,count(*) AS count
  FROM music_events GROUP BY day,release_id,recording_id,medium,event
  UNION ALL SELECT day,release_id,recording_id,medium,event,count FROM music_event_daily
) GROUP BY day,release_id,recording_id,medium,event`;
export const lifetimePlayback = `SELECT release_id,recording_id,medium,event,sum(count) AS count
FROM (${dailyPlayback}) GROUP BY release_id,recording_id,medium,event`;

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
    async close() { await proxy?.dispose(); },
  };
}
