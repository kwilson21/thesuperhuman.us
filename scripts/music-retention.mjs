#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMusicDatabase, lifetimePlayback } from './music-analytics.mjs';

const quote = value => `'${value.replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');
export const cutoffFor = now => new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
export const snapshotQuery = cutoff => `SELECT json_group_array(json_array(release_id,recording_id,session_id,medium,event,occurred_at)) AS snapshot
FROM (SELECT * FROM music_events WHERE occurred_at < ${quote(cutoff)}
ORDER BY release_id,recording_id,session_id,medium,event)`;
export const summaryQuery = cutoff => `SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,count(*) AS count
FROM music_events WHERE occurred_at < ${quote(cutoff)} GROUP BY day,release_id,recording_id,medium,event
ORDER BY day,release_id,recording_id,medium,event`;

export async function preview(database, environment, now = new Date()) {
  const cutoff = cutoffFor(now);
  const [{ snapshot }] = await database.query(snapshotQuery(cutoff));
  const dailySummary = await database.query(summaryQuery(cutoff));
  // Confirm a consistent review if records changed between the two reads.
  const [check] = await database.query(snapshotQuery(cutoff));
  if (check.snapshot !== snapshot) throw new Error('Eligible events changed during preview. Generate a fresh review.');
  return { version: 1, environment, generatedAt: now.toISOString(), cutoff,
    sourceHash: hash(snapshot), rows: JSON.parse(snapshot).length, dailySummary,
    lifetimeTotals: await database.query(lifetimePlayback),
    notes: 'Review trends by date, release, recording, audio/video, and start/listen30 before applying. Counts are browser reports, not audited unique listeners. Daily totals remain; individual tab identifiers are removed. Contact requests are unaffected.',
  };
}

export async function apply(database, review, environment, now = new Date()) {
  if (review.version !== 1 || review.environment !== environment ||
      typeof review.cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(review.cutoff) ||
      !Number.isFinite(Date.parse(review.cutoff)) || review.cutoff > cutoffFor(now)) {
    throw new Error('Invalid review, wrong environment, or cutoff less than 90 days old.');
  }
  const [{ snapshot }] = await database.query(snapshotQuery(review.cutoff));
  if (hash(snapshot) !== review.sourceHash) throw new Error('Eligible events changed or this review was already applied. Generate and review a fresh preview.');
  const summary = await database.query(summaryQuery(review.cutoff));
  if (JSON.stringify(summary) !== JSON.stringify(review.dailySummary) || JSON.parse(snapshot).length !== review.rows) {
    throw new Error('Review summary does not match eligible events. Generate a fresh preview.');
  }
  // Verify the archive mechanism before any delete. Its inserts and each delete
  // are part of one SQLite statement, so a trigger failure rolls everything back.
  const schema = await readFile(new URL('../db/music.sql', import.meta.url), 'utf8');
  const expected = schema.match(/CREATE TRIGGER IF NOT EXISTS music_events_archive_before_delete[\s\S]*?END;/)[0];
  const triggers = await database.query("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='music_events_archive_before_delete'");
  const normalize = sql => sql.replace('IF NOT EXISTS ', '').replace(/;$/, '').replace(/\s+/g, ' ').trim();
  if (triggers.length !== 1 || normalize(triggers[0].sql) !== normalize(expected)) throw new Error('Archive trigger is missing or different. Apply the reviewed db/music.sql schema first.');
  // The exact snapshot predicate closes the race between review verification and
  // deletion, including changes with the same count. This is ONE atomic statement.
  await database.query(`DELETE FROM music_events WHERE occurred_at < ${quote(review.cutoff)}
AND (${snapshotQuery(review.cutoff)}) = ${quote(snapshot)}`);
  const [remaining] = await database.query(snapshotQuery(review.cutoff));
  if (remaining.snapshot !== '[]') throw new Error('Cleanup did not empty the reviewed range (concurrent change possible). Generate a fresh preview before retrying.');
  return review.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const remote = args.includes('--remote');
  const applyIndex = args.indexOf('--apply');
  const reviewPath = applyIndex < 0 ? '.private/music-retention-review.json' : args[applyIndex + 1];
  const allowed = new Set(['--remote', '--apply', ...(applyIndex < 0 ? [] : [reviewPath])]);
  if (!reviewPath || args.some(arg => !allowed.has(arg))) throw new Error('Usage: node scripts/music-retention.mjs [--remote] [--apply .private/music-retention-review.json]');
  await mkdir('.private', { recursive: true });
  const environment = remote ? 'Production' : 'Local test data';
  const database = await openMusicDatabase(remote);
  try {
    if (applyIndex >= 0) {
      const review = JSON.parse(await readFile(resolve(reviewPath), 'utf8'));
      const rows = await apply(database, review, environment);
      console.log(`Archived daily totals and removed ${rows} reviewed raw events. Contact requests were not changed.`);
    } else {
      const review = await preview(database, environment);
      await writeFile(reviewPath, JSON.stringify(review, null, 2), { mode: 0o600 });
      console.log(`Preview only: ${review.rows} events before ${review.cutoff}. Review ${reviewPath}, preserve any additional insights privately, then explicitly run --apply ${reviewPath}${remote ? ' --remote' : ''}. Nothing was removed.`);
    }
  } finally { await database.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
