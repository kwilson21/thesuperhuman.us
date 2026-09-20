#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMusicDatabase, lifetimeOwnerPlayback } from './music-analytics.mjs';
import { renderMusicReport } from './music-report-view.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const hash = value => createHash('sha256').update(value).digest('hex');
const dayCutoff = (now, days) => new Date(now.getTime() - days * 86400000).toISOString();
const requestEligibility = now => `(status='withdrawn' OR (contact_delete_after IS NOT NULL AND contact_delete_after<=${quote(now.toISOString())})
  OR (status='resolved' AND kind<>'service' AND resolved_at<${quote(dayCutoff(now, 90))})
  OR (status='resolved' AND kind='service' AND resolved_at<${quote(dayCutoff(now, 365))}))
  AND (name<>'' OR email<>'' OR city_region<>'' OR details_json<>'{}' OR private_note<>'')`;
const requestSnapshot = (now, selection = '1') => `SELECT json_group_array(json_array(id,updated_at)) AS snapshot FROM
  (SELECT id,updated_at FROM owner_requests WHERE ${requestEligibility(now)} AND (${selection}) ORDER BY id)`;
const playbackSnapshot = (cutoff, selection = '1') => `SELECT json_group_array(json_array(id,occurred_at)) AS snapshot FROM
  (SELECT id,occurred_at FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND (${selection}) ORDER BY id)`;
const playbackSummary = cutoff => `SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,
  COALESCE(campaign_id,'') AS campaign_id,COALESCE(channel,'') AS channel,COALESCE(creative,'') AS creative,
  country,region,city,COUNT(*) AS count FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND traffic_class='human'
  GROUP BY day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city ORDER BY day,release_id,event`;

export async function previewOwnerRetention(database, environment, now = new Date()) {
  const cutoff = dayCutoff(now, 90);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(cutoff));
  const dailySummary = await database.query(playbackSummary(cutoff));
  const [requestCheck] = await database.query(requestSnapshot(now));
  const [playbackCheck] = await database.query(playbackSnapshot(cutoff));
  if (requestCheck.snapshot !== requests || playbackCheck.snapshot !== playback) throw new Error('Eligible owner data changed during preview. Generate a fresh review.');
  return {
    version: 1, environment, generatedAt: now.toISOString(), playbackCutoff: cutoff,
    requestSourceHash: hash(requests), playbackSourceHash: hash(playback),
    requestContacts: JSON.parse(requests).length, rawPlayback: JSON.parse(playback).length,
    dailySummary, lifetimeTotals: await database.query(lifetimeOwnerPlayback),
    notes: 'Review campaign, channel, creative, medium, event, and approximate geography before applying. The manifest contains aggregate evidence and hashes, never request contact values. Applying blanks eligible request contact fields and removes raw playback only after daily totals are preserved.',
  };
}

function validateReview(review, environment, now) {
  if (review.version !== 1 || review.environment !== environment || typeof review.playbackCutoff !== 'string' ||
    !Number.isFinite(Date.parse(review.playbackCutoff)) || review.playbackCutoff > dayCutoff(now, 90) ||
    !Number.isInteger(review.requestContacts) || !Number.isInteger(review.rawPlayback)) throw new Error('Invalid review, wrong environment, or cutoff less than 90 days old.');
}

async function verifyTriggers(database) {
  const schema = await readFile(new URL('../db/music.sql', import.meta.url), 'utf8');
  for (const name of ['music_playback_events_archive_before_delete', 'owner_requests_audit_personal_delete']) {
    const expected = schema.match(new RegExp(`CREATE TRIGGER IF NOT EXISTS ${name}[\\s\\S]*?END;`))?.[0];
    const rows = await database.query(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=${quote(name)}`);
    const normalize = sql => sql.replace('IF NOT EXISTS ', '').replace(/;$/, '').replace(/\s+/g, ' ').trim();
    if (!expected || rows.length !== 1 || normalize(rows[0].sql) !== normalize(expected)) throw new Error(`Retention trigger ${name} is missing or different. Apply the reviewed music schema first.`);
  }
}

export async function applyOwnerRetention(database, review, environment, now = new Date()) {
  validateReview(review, environment, now);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(review.playbackCutoff));
  if (hash(requests) !== review.requestSourceHash || hash(playback) !== review.playbackSourceHash) throw new Error('Eligible owner data changed or this review was already applied. Generate and review a fresh preview.');
  const summary = await database.query(playbackSummary(review.playbackCutoff));
  if (JSON.stringify(summary) !== JSON.stringify(review.dailySummary) || JSON.parse(requests).length !== review.requestContacts || JSON.parse(playback).length !== review.rawPlayback) throw new Error('Review summary does not match eligible owner data.');
  await verifyTriggers(database);
  const requestRows = JSON.parse(requests);
  for (let start=0; start<requestRows.length; start+=100) {
    const chunk = requestRows.slice(start,start+100); const ids = chunk.map(row => row[0]);
    const selection = `id IN (${ids.map(quote).join(',')})`;
    const guard = requestSnapshot(now, selection);
    await database.query(`UPDATE owner_requests SET name='',email='',city_region='',details_json='{}',private_note='',updated_at=${quote(now.toISOString())}
      WHERE ${selection} AND (${guard})=${quote(JSON.stringify(chunk))}`);
    const [remaining] = await database.query(requestSnapshot(now, selection));
    if (remaining.snapshot !== '[]') throw new Error('Reviewed request data changed during cleanup. Stop and generate a fresh preview.');
  }
  const playbackRows = JSON.parse(playback);
  for (let start=0; start<playbackRows.length; start+=100) {
    const chunk = playbackRows.slice(start,start+100); const ids = chunk.map(row => row[0]);
    const selection = `id IN (${ids.map(quote).join(',')})`;
    const guard = playbackSnapshot(review.playbackCutoff, selection);
    await database.query(`DELETE FROM music_playback_events WHERE occurred_at<${quote(review.playbackCutoff)} AND ${selection}
      AND (${guard})=${quote(JSON.stringify(chunk))}`);
    const [remaining] = await database.query(playbackSnapshot(review.playbackCutoff, selection));
    if (remaining.snapshot !== '[]') throw new Error('Reviewed playback data changed during cleanup. Stop and generate a fresh preview.');
  }
  const runId = hash(`${review.generatedAt}:${review.requestSourceHash}:${review.playbackSourceHash}`);
  await database.query(`INSERT INTO owner_retention_runs(id,environment,playback_cutoff,playback_rows,request_contacts,completed_at)
    VALUES(${quote(runId)},${quote(environment)},${quote(review.playbackCutoff)},${review.rawPlayback},${review.requestContacts},${quote(now.toISOString())})`);
  return { requestContacts: review.requestContacts, rawPlayback: review.rawPlayback };
}

async function main() {
  const args = process.argv.slice(2), remote = args.includes('--remote'), applyIndex = args.indexOf('--apply');
  const reviewPath = applyIndex < 0 ? '.private/owner-retention-review.json' : args[applyIndex + 1];
  const allowed = new Set(['--remote','--apply',...(applyIndex < 0 ? [] : [reviewPath])]);
  if (!reviewPath || args.some(arg => !allowed.has(arg))) throw new Error('Usage: node scripts/owner-retention.mjs [--remote] [--apply .private/owner-retention-review.json]');
  await mkdir('.private',{recursive:true}); const environment = remote ? 'Production' : 'Local test data'; const database = await openMusicDatabase(remote);
  try {
    if (applyIndex >= 0) {
      const review = JSON.parse(await readFile(resolve(reviewPath),'utf8')); const result = await applyOwnerRetention(database,review,environment);
      console.log(`Removed ${result.rawPlayback} reviewed raw playback records and personal detail from ${result.requestContacts} reviewed requests.`);
    } else {
      const review = await previewOwnerRetention(database,environment); await writeFile(reviewPath,JSON.stringify(review,null,2),{mode:0o600});
      await writeFile('.private/owner-retention-review.html',renderMusicReport('Owner data retention review',`${environment} · ${review.generatedAt}`,`${review.rawPlayback} raw playback records and ${review.requestContacts} request contacts are eligible. Nothing has been removed. ${review.notes}`,{'Playback totals to preserve':review.dailySummary,'Lifetime campaign totals':review.lifetimeTotals}),{mode:0o600});
      console.log(`Preview only: ${review.rawPlayback} playback records and ${review.requestContacts} request contacts are eligible. Review .private/owner-retention-review.html, then explicitly run --apply ${reviewPath}${remote ? ' --remote' : ''}.`);
    }
  } finally { await database.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
