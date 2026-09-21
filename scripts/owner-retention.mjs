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
const terminalPaymentStatuses = "'paid','void'";
const requestEligibility = (now, paymentGuard = '1') => `(status='withdrawn' OR (contact_delete_after IS NOT NULL AND contact_delete_after<=${quote(now.toISOString())})
  OR (status='resolved' AND kind<>'service' AND resolved_at<${quote(dayCutoff(now, 90))})
  OR (status='resolved' AND kind='service' AND resolved_at<${quote(dayCutoff(now, 365))}))
  AND (name<>'' OR email<>'' OR city_region<>'' OR details_json<>'{}' OR private_note<>'') AND (${paymentGuard})`;
const requestSnapshot = (now, selection = '1', paymentGuard = '1') => `SELECT json_group_array(json_array(id,updated_at)) AS snapshot FROM
  (SELECT id,updated_at FROM owner_requests WHERE ${requestEligibility(now, paymentGuard)} AND (${selection}) ORDER BY id)`;
const playbackSnapshot = (cutoff, selection = '1') => `SELECT json_group_array(json_array(id,occurred_at)) AS snapshot FROM
  (SELECT id,occurred_at FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND (${selection}) ORDER BY id LIMIT 1000)`;
const playbackSummary = (cutoff, selection = '1') => `SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,
  COALESCE(campaign_id,'') AS campaign_id,COALESCE(channel,'') AS channel,COALESCE(creative,'') AS creative,
  country,region,city,COUNT(*) AS count FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND traffic_class='human' AND (${selection})
  GROUP BY day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city ORDER BY day,release_id,event`;
const idsSelection = rows => rows.length ? `id IN (${rows.map(row => quote(row[0])).join(',')})` : '0';

async function paymentRetentionGuard(database) {
  const tables = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_payments'");
  if (!tables.length) return '1';
  return `NOT EXISTS (SELECT 1 FROM audio_payments AS payment WHERE payment.request_id=owner_requests.id
    AND (payment.booking_status NOT IN (${terminalPaymentStatuses}) OR payment.balance_status NOT IN (${terminalPaymentStatuses})))`;
}

export async function previewOwnerRetention(database, environment, now = new Date()) {
  const cutoff = dayCutoff(now, 90);
  const paymentGuard = await paymentRetentionGuard(database);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now, '1', paymentGuard));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(cutoff));
  const playbackRows = JSON.parse(playback); const selection = idsSelection(playbackRows);
  const dailySummary = await database.query(playbackSummary(cutoff, selection));
  const [{ total: allPlayback }] = await database.query(`SELECT COUNT(*) AS total FROM music_playback_events WHERE occurred_at<${quote(cutoff)}`);
  const [requestCheck] = await database.query(requestSnapshot(now, '1', paymentGuard));
  const [playbackCheck] = await database.query(playbackSnapshot(cutoff));
  if (requestCheck.snapshot !== requests || playbackCheck.snapshot !== playback) throw new Error('Eligible owner data changed during preview. Generate a fresh review.');
  return {
    version: 1, environment, generatedAt: now.toISOString(), playbackCutoff: cutoff,
    requestSourceHash: hash(requests), playbackSourceHash: hash(playback),
    requestContacts: JSON.parse(requests).length,
    rawPlayback: playbackRows.length, remainingPlayback: Math.max(0, Number(allPlayback) - playbackRows.length),
    dailySummary, lifetimeTotals: await database.query(lifetimeOwnerPlayback),
    notes: 'Review campaign, channel, creative, medium, event, and approximate geography before applying. The manifest contains aggregate evidence and hashes, never request contact values. Applying uses one transaction, coarsens retained geography, blanks eligible request contact fields, and removes at most 1,000 reviewed raw playback rows. Run another preview when remainingPlayback is above zero.',
  };
}

function validateReview(review, environment, now) {
  if (review.version !== 1 || review.environment !== environment || typeof review.playbackCutoff !== 'string' ||
    !Number.isFinite(Date.parse(review.playbackCutoff)) || review.playbackCutoff > dayCutoff(now, 90) ||
    !Number.isInteger(review.requestContacts) || !Number.isInteger(review.rawPlayback) || !Number.isInteger(review.remainingPlayback)) throw new Error('Invalid review, wrong environment, or cutoff less than 90 days old.');
}

async function verifyTriggers(database) {
  const schema = await readFile(new URL('../db/music.sql', import.meta.url), 'utf8');
  for (const name of ['owner_requests_audit_personal_delete']) {
    const expected = schema.match(new RegExp(`CREATE TRIGGER IF NOT EXISTS ${name}[\\s\\S]*?END;`))?.[0];
    const rows = await database.query(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=${quote(name)}`);
    const normalize = sql => sql.replace('IF NOT EXISTS ', '').replace(/;$/, '').replace(/\s+/g, ' ').trim();
    if (!expected || rows.length !== 1 || normalize(rows[0].sql) !== normalize(expected)) throw new Error(`Retention trigger ${name} is missing or different. Apply the reviewed music schema first.`);
  }
}

export async function applyOwnerRetention(database, review, environment, now = new Date()) {
  validateReview(review, environment, now);
  const paymentGuard = await paymentRetentionGuard(database);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now, '1', paymentGuard));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(review.playbackCutoff));
  if (hash(requests) !== review.requestSourceHash || hash(playback) !== review.playbackSourceHash) throw new Error('Eligible owner data changed or this review was already applied. Generate and review a fresh preview.');
  const playbackRows = JSON.parse(playback); const playbackSelection = idsSelection(playbackRows);
  const summary = await database.query(playbackSummary(review.playbackCutoff, playbackSelection));
  if (JSON.stringify(summary) !== JSON.stringify(review.dailySummary) || JSON.parse(requests).length !== review.requestContacts || JSON.parse(playback).length !== review.rawPlayback) throw new Error('Review summary does not match eligible owner data.');
  await verifyTriggers(database);
  const requestRows = JSON.parse(requests);
  const requestSelection = idsSelection(requestRows);
  const paymentSchema = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('audio_payments','stripe_webhook_events','stripe_invoice_attempts','stripe_unmatched_events')");
  const paymentTables = new Set(paymentSchema.map(row => String(row.name)));
  if (paymentTables.has('audio_payments')) {
    const columns = new Set((await database.query('PRAGMA table_info(audio_payments)')).map(row => String(row.name)));
    if (paymentTables.size !== 4 || !columns.has('external_refs_deleted_at')) {
      throw new Error('Stripe reconciliation migration 0004 is required before retention can run.');
    }
  }
  const paymentCleanup = paymentTables.has('audio_payments') ? [
    `DELETE FROM stripe_webhook_events WHERE invoice_id IN (SELECT invoice_id FROM stripe_invoice_attempts WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}))`,
    `DELETE FROM stripe_unmatched_events WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`,
    `DELETE FROM stripe_invoice_attempts WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`,
    `UPDATE audio_payments SET stripe_customer_id=NULL,booking_invoice_id=NULL,booking_invoice_url=NULL,
      balance_invoice_id=NULL,balance_invoice_url=NULL,booking_recovery_event_id=NULL,balance_recovery_event_id=NULL,
      booking_creation_started_at=NULL,balance_creation_started_at=NULL,
      external_refs_deleted_at=${quote(now.toISOString())},updated_at=${quote(now.toISOString())}
      WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})
        AND booking_status IN (${terminalPaymentStatuses}) AND balance_status IN (${terminalPaymentStatuses})`,
  ] : [];
  const guard = (query, expected) => `SELECT CASE WHEN (${query})=${quote(expected)} THEN 1 ELSE json_extract('retention source changed','$') END`;
  const runId = hash(`${review.generatedAt}:${review.requestSourceHash}:${review.playbackSourceHash}`);
  const statements = [
    guard(requestSnapshot(now, '1', paymentGuard), requests),
    guard(playbackSnapshot(review.playbackCutoff), playback),
    ...paymentCleanup,
    `UPDATE owner_requests SET name='',email='',city_region='',details_json='{}',private_note='',updated_at=${quote(now.toISOString())} WHERE ${requestSelection}`,
    `INSERT INTO music_playback_daily(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city,count)
      SELECT day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,'' AS city,SUM(count) FROM
        (${playbackSummary(review.playbackCutoff, playbackSelection).replace(/ ORDER BY day,release_id,event$/,'')})
      GROUP BY day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region
      ON CONFLICT(day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city) DO UPDATE SET count=count+excluded.count`,
    `INSERT INTO music_playback_geography_daily(day,release_id,recording_id,campaign_id,channel,creative,country,region,city,count)
      WITH qualified AS (SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,COALESCE(campaign_id,'') AS campaign_id,
        COALESCE(channel,'') AS channel,COALESCE(creative,'') AS creative,country,region,city,session_id
        FROM music_playback_events WHERE traffic_class='human' AND event IN ('listen30','complete') AND (${playbackSelection})
        GROUP BY day,release_id,recording_id,campaign_id,channel,creative,country,region,city,session_id),
      city_counts AS (SELECT day,release_id,recording_id,campaign_id,channel,creative,country,region,city,COUNT(*) AS count
        FROM qualified GROUP BY day,release_id,recording_id,campaign_id,channel,creative,country,region,city)
      SELECT day,release_id,recording_id,campaign_id,channel,creative,country,region,CASE WHEN count>=5 THEN city ELSE '' END,SUM(count)
        FROM city_counts GROUP BY day,release_id,recording_id,campaign_id,channel,creative,country,region,CASE WHEN count>=5 THEN city ELSE '' END
      ON CONFLICT(day,release_id,recording_id,campaign_id,channel,creative,country,region,city) DO UPDATE SET count=count+excluded.count`,
    `DELETE FROM music_playback_events WHERE occurred_at<${quote(review.playbackCutoff)} AND ${playbackSelection}`,
    `INSERT INTO owner_retention_runs(id,environment,playback_cutoff,playback_rows,request_contacts,completed_at)
      VALUES(${quote(runId)},${quote(environment)},${quote(review.playbackCutoff)},${review.rawPlayback},${review.requestContacts},${quote(now.toISOString())})`,
  ];
  if (statements.some(statement => Buffer.byteLength(statement) > 90_000)) {
    throw new Error('Reviewed retention batch exceeds the safe D1 statement limit. Reduce the reviewed row limit and generate a fresh preview.');
  }
  await database.batch(statements);
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
