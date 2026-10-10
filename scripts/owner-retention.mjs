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
const unstartedPaymentInstallment = installment => `(${installment}_status='not_created'
  AND ${installment}_invoice_id IS NULL AND ${installment}_creation_started_at IS NULL)`;
const finishedBookingInstallment = `(booking_status IN (${terminalPaymentStatuses}) OR ${unstartedPaymentInstallment('booking')})`;
// A balance never started is finished when the booking was not paid, or when the client stopped
// the project after the last revision round (no balance is due then; migration 0018).
const clientStopped = table => `EXISTS(SELECT 1 FROM audio_project_messages stop
  WHERE stop.request_id=${table}.request_id AND stop.review_decision='stopped')`;
const finishedBalanceInstallment = table => `(balance_status IN (${terminalPaymentStatuses})
  OR (${unstartedPaymentInstallment('balance')} AND (booking_status<>'paid' OR ${clientStopped(table)})))`;
/** Payment terms with nothing left to collect or reconcile, for the audio_payments row named `table`. */
export const finishedPaymentTerms = (table = 'audio_payments') => `${finishedBookingInstallment} AND ${finishedBalanceInstallment(table)}`;
const requestEligibility = (now, paymentGuard = '1', portalGuard = '1', portalCompleted = '0') => `(status='withdrawn' OR (contact_delete_after IS NOT NULL AND contact_delete_after<=${quote(now.toISOString())})
  OR (status='resolved' AND kind<>'service' AND resolved_at<${quote(dayCutoff(now, 90))})
  OR (status='resolved' AND kind='service' AND resolved_at<${quote(dayCutoff(now, 365))})
  OR (${portalCompleted}))
  AND (name<>'' OR email<>'' OR city_region<>'' OR details_json<>'{}' OR private_note<>'' OR summary<>'')
  AND (${paymentGuard}) AND (${portalGuard})`;
const requestSnapshot = (now, selection = '1', paymentGuard = '1', portalGuard = '1', portalCompleted = '0') => `SELECT json_group_array(json_array(id,updated_at)) AS snapshot FROM
  (SELECT id,updated_at FROM owner_requests WHERE ${requestEligibility(now, paymentGuard, portalGuard, portalCompleted)} AND (${selection}) ORDER BY id)`;
const playbackSnapshot = (cutoff, selection = '1') => `SELECT json_group_array(json_array(id,occurred_at)) AS snapshot FROM
  (SELECT id,occurred_at FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND (${selection}) ORDER BY id LIMIT 1000)`;
const playbackSummary = (cutoff, selection = '1') => `SELECT substr(occurred_at,1,10) AS day,release_id,recording_id,medium,event,
  COALESCE(campaign_id,'') AS campaign_id,COALESCE(channel,'') AS channel,COALESCE(creative,'') AS creative,
  country,region,city,COUNT(*) AS count FROM music_playback_events WHERE occurred_at<${quote(cutoff)} AND traffic_class='human' AND (${selection})
  GROUP BY day,release_id,recording_id,medium,event,campaign_id,channel,creative,country,region,city ORDER BY day,release_id,event`;
async function softwareIntakeSnapshotQuery(database, now) {
  const projects=await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_projects'");
  if(!projects.length) return "SELECT '[]' AS snapshot";
  const agreements=await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreements'");
  if(!agreements.length) return "SELECT '[]' AS snapshot";
  const invoices=await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_invoices'");
  const cutoff=quote(dayCutoff(now,730));
  const openInvoice=invoices.length ? "AND NOT EXISTS(SELECT 1 FROM software_invoices i WHERE i.request_id=r.id AND i.status IN ('creating','open','payment_failed','uncollectible'))" : '';
  const recentInvoice=invoices.length ? `AND NOT EXISTS(SELECT 1 FROM software_invoices i WHERE i.request_id=r.id AND i.created_at>=${cutoff})` : '';
  return `SELECT json_group_array(json_array(id,updated_at,project_updated_at,content_deleted_at,retention_anchor)) AS snapshot FROM
    (SELECT r.id,r.updated_at,p.updated_at AS project_updated_at,p.content_deleted_at,
        MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,'')) AS retention_anchor
      FROM owner_requests r JOIN software_projects p ON p.request_id=r.id
      WHERE r.kind='software' AND p.content_deleted_at IS NOT NULL
        AND MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))<>''
        AND MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))<=${cutoff}
        AND (r.name<>'' OR r.email<>'' OR r.city_region<>'' OR r.details_json<>'{}' OR r.private_note<>'' OR r.summary<>'')
        AND EXISTS(SELECT 1 FROM software_agreements a WHERE a.id=p.agreement_id AND a.status='executed' AND a.legal_hold=0)
        AND NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.request_id=r.id AND a.legal_hold=1)
        AND NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.request_id=r.id AND a.status IN ('review','client_signed'))
        ${openInvoice} ${recentInvoice}
      ORDER BY r.id LIMIT 100)`;
}
async function softwareIntakeSnapshot(database, now) {
  const [{snapshot}] = await database.query(await softwareIntakeSnapshotQuery(database,now));
  return snapshot ?? '[]';
}

const idsSelection = rows => rows.length ? `id IN (${rows.map(row => quote(row[0])).join(',')})` : '0';

async function paymentRetentionGuard(database) {
  const tables = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_payments'");
  if (!tables.length) return '1';
  const messages = new Set((await database.query('PRAGMA table_info(audio_project_messages)')).map(row => String(row.name)));
  if (!messages.has('review_decision')) throw new Error('Review decisions migration 0018 is required before owner retention can run.');
  return `NOT EXISTS (SELECT 1 FROM audio_payments AS payment WHERE payment.request_id=owner_requests.id
    AND NOT (${finishedPaymentTerms('payment')}))`;
}

async function portalRetentionGuard(database, now) {
  const tables = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_projects'");
  if (!tables.length) return { guard: '1', completed: '0' };
  const columns = new Set((await database.query('PRAGMA table_info(audio_projects)')).map(row => String(row.name)));
  if (!columns.has('content_deleted_at')) throw new Error('Studio retention migration 0014 is required before owner retention can run.');
  const software = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_projects'");
  const invoices = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_invoices'");
  const agreements = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreements'");
  const cutoff=quote(dayCutoff(now,730));
  const openInvoice=invoices.length ? "OR EXISTS(SELECT 1 FROM software_invoices i WHERE i.request_id=owner_requests.id AND i.status IN ('creating','open','payment_failed','uncollectible'))" : '';
  const recentInvoice=invoices.length ? ` AND NOT EXISTS(SELECT 1 FROM software_invoices i WHERE i.request_id=owner_requests.id AND i.created_at>=${cutoff})` : '';
  const heldAgreement=agreements.length ? "OR EXISTS(SELECT 1 FROM software_agreements a WHERE a.request_id=owner_requests.id AND (a.legal_hold=1 OR a.status IN ('review','client_signed')))" : '';
  const softwareNotReady=software.length ? ` AND NOT EXISTS(SELECT 1 FROM software_projects p WHERE p.request_id=owner_requests.id AND
    (p.content_deleted_at IS NULL OR MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))='' OR
     MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))>${cutoff} ${openInvoice} ${heldAgreement}))` : '';
  const agreementGuard = agreements.length ? ' AND NOT EXISTS(SELECT 1 FROM software_agreements a WHERE a.request_id=owner_requests.id)' : '';
  const softwareCompleted = software.length ? ` OR EXISTS(SELECT 1 FROM software_projects p WHERE p.request_id=owner_requests.id AND p.content_deleted_at IS NOT NULL
    AND MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))<>'' AND MAX(COALESCE(p.completed_at,''),COALESCE(p.revoked_at,''))<=${cutoff} ${openInvoice.replaceAll('owner_requests.id','p.request_id')} ${heldAgreement.replaceAll('owner_requests.id','p.request_id')})` : '';
  return {
    guard: `NOT EXISTS(SELECT 1 FROM audio_projects p WHERE p.request_id=owner_requests.id AND p.content_deleted_at IS NULL)${softwareNotReady}${agreementGuard}${recentInvoice}`,
    completed: `EXISTS(SELECT 1 FROM audio_projects p WHERE p.request_id=owner_requests.id AND p.content_deleted_at IS NOT NULL)${softwareCompleted}`,
  };
}

export async function previewOwnerRetention(database, environment, now = new Date()) {
  const cutoff = dayCutoff(now, 90);
  const paymentGuard = await paymentRetentionGuard(database);
  const portal = await portalRetentionGuard(database, now);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now, '1', paymentGuard, portal.guard, portal.completed));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(cutoff));
  const softwareIntake = await softwareIntakeSnapshot(database,now);
  const playbackRows = JSON.parse(playback); const selection = idsSelection(playbackRows);
  const dailySummary = await database.query(playbackSummary(cutoff, selection));
  const [{ total: allPlayback }] = await database.query(`SELECT COUNT(*) AS total FROM music_playback_events WHERE occurred_at<${quote(cutoff)}`);
  const [requestCheck] = await database.query(requestSnapshot(now, '1', paymentGuard, portal.guard, portal.completed));
  const [playbackCheck] = await database.query(playbackSnapshot(cutoff));
  const softwareIntakeCheck = await softwareIntakeSnapshot(database,now);
  if (requestCheck.snapshot !== requests || playbackCheck.snapshot !== playback || softwareIntakeCheck !== softwareIntake) throw new Error('Eligible owner data changed during preview. Generate a fresh review.');
  return {
    version: 1, environment, generatedAt: now.toISOString(), playbackCutoff: cutoff,
    requestSourceHash: hash(requests), playbackSourceHash: hash(playback), softwareIntakeSourceHash: hash(softwareIntake),
    requestContacts: JSON.parse(requests).length, softwareIntakeContacts: JSON.parse(softwareIntake).length,
    rawPlayback: playbackRows.length, remainingPlayback: Math.max(0, Number(allPlayback) - playbackRows.length),
    dailySummary, lifetimeTotals: await database.query(lifetimeOwnerPlayback),
    notes: 'Review campaign, channel, creative, medium, event, and approximate geography before applying. The manifest contains aggregate evidence, row IDs and hashes, never request contact values. Applying uses one transaction, coarsens retained geography, blanks eligible request contact fields, and removes at most 1,000 reviewed raw playback rows. Website-signed software projects become eligible to scrub the original request brief two years after completion or access closure, only after project content cleanup; separate agreements, signatures, certificates and attachment evidence are preserved. Run another preview when remainingPlayback is above zero.',
  };
}

function validateReview(review, environment, now) {
  if (review.version !== 1 || review.environment !== environment || typeof review.playbackCutoff !== 'string' ||
    !Number.isFinite(Date.parse(review.playbackCutoff)) || review.playbackCutoff > dayCutoff(now, 90) ||
    !Number.isInteger(review.requestContacts) || !Number.isInteger(review.softwareIntakeContacts) || typeof review.softwareIntakeSourceHash!=='string' || !Number.isInteger(review.rawPlayback) || !Number.isInteger(review.remainingPlayback)) throw new Error('Invalid review, wrong environment, or cutoff less than 90 days old.');
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
  const portal = await portalRetentionGuard(database, now);
  const [{ snapshot: requests }] = await database.query(requestSnapshot(now, '1', paymentGuard, portal.guard, portal.completed));
  const [{ snapshot: playback }] = await database.query(playbackSnapshot(review.playbackCutoff));
  const softwareIntake=await softwareIntakeSnapshot(database,now);
  if (hash(requests) !== review.requestSourceHash || hash(playback) !== review.playbackSourceHash || hash(softwareIntake)!==review.softwareIntakeSourceHash || JSON.parse(softwareIntake).length!==review.softwareIntakeContacts) throw new Error('Eligible owner data changed or this review was already applied. Generate and review a fresh preview.');
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
        AND ${finishedPaymentTerms()}`,
  ] : [];
  const softwareTables = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('software_fit_reviews','software_offers','software_offer_links')");
  if (softwareTables.length && softwareTables.length !== 3) throw new Error('Software offers migration 0020 is required before owner retention can run.');
  const projectsTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_projects'");
  const softwareCleanup = softwareTables.length ? ['software_offer_links','software_fit_reviews'].map(table =>
    `DELETE FROM ${table} WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`) : [];
  const draftsTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreement_drafts'");
  if (draftsTable.length) softwareCleanup.push(`DELETE FROM software_agreement_drafts WHERE offer_id IN (SELECT id FROM software_offers WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}))`);
  const sessionsTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreement_sessions'");
  const linksTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreement_links'");
  const selectedOffers = `SELECT id FROM software_offers WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`;
  if (sessionsTable.length) softwareCleanup.push(`DELETE FROM software_agreement_sessions WHERE offer_id IN (${selectedOffers})`);
  if (linksTable.length) softwareCleanup.push(`DELETE FROM software_agreement_links WHERE offer_id IN (${selectedOffers})`);
  const eventsTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_agreement_events'");
  if (eventsTable.length) softwareCleanup.push(`DELETE FROM software_agreement_events WHERE agreement_id IS NULL AND offer_id IN (${selectedOffers})${projectsTable.length ? ' AND offer_id NOT IN (SELECT offer_id FROM software_projects)' : ''}`);
  const invoiceTable = await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='software_invoices'");
  if(invoiceTable.length) softwareCleanup.push(
    `DELETE FROM stripe_webhook_events WHERE invoice_id IN (SELECT stripe_invoice_id FROM software_invoices WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}))`,
    `DELETE FROM software_stripe_unmatched_events WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`,
    `DELETE FROM software_invoices WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}) AND created_at<${quote(dayCutoff(now,730))}`);
  if (softwareTables.length) softwareCleanup.push(projectsTable.length
    ? `DELETE FROM software_offers WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}) AND id NOT IN (SELECT offer_id FROM software_projects)`
    : `DELETE FROM software_offers WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`);
  if (projectsTable.length) softwareCleanup.push(
    `DELETE FROM software_milestone_payments WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}) AND request_id IN (SELECT request_id FROM software_projects WHERE content_deleted_at IS NOT NULL)`,
    `UPDATE software_projects SET terms_json='{}',waiting_for='',started_by='' WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection}) AND content_deleted_at IS NOT NULL`,
    `UPDATE software_offers SET terms_json='{}',sent_by=NULL,sent_at=NULL,status='withdrawn',recipient_email_snapshot=CASE WHEN EXISTS(SELECT 1 FROM software_agreements a WHERE a.offer_id=software_offers.id) THEN recipient_email_snapshot ELSE NULL END,agreement_details_json=CASE WHEN EXISTS(SELECT 1 FROM software_agreements a WHERE a.offer_id=software_offers.id) THEN agreement_details_json ELSE NULL END WHERE request_id IN (SELECT id FROM owner_requests WHERE ${requestSelection})`);
  const guard = (query, expected) => `SELECT CASE WHEN (${query})=${quote(expected)} THEN 1 ELSE json_extract('retention source changed','$') END`;
  const runId = hash(`${review.generatedAt}:${review.requestSourceHash}:${review.playbackSourceHash}`);
  const statements = [
    guard(requestSnapshot(now, '1', paymentGuard, portal.guard, portal.completed), requests),
    guard(playbackSnapshot(review.playbackCutoff), playback),
    guard(await softwareIntakeSnapshotQuery(database,now), softwareIntake),
    ...paymentCleanup,
    ...softwareCleanup,
    `UPDATE owner_requests SET name='',email='',city_region='',details_json='{}',private_note='',summary='',updated_at=${quote(now.toISOString())} WHERE ${requestSelection}`,
    ...(JSON.parse(softwareIntake).length ? [`UPDATE owner_requests SET name='',email='',city_region='',details_json='{}',private_note='',summary='',updated_at=${quote(now.toISOString())} WHERE ${idsSelection(JSON.parse(softwareIntake))}`] : []),
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
  return { requestContacts: review.requestContacts, softwareIntakeContacts: review.softwareIntakeContacts, rawPlayback: review.rawPlayback };
}

async function main() {
  const args = process.argv.slice(2), remote = args.includes('--remote'), applyIndex = args.indexOf('--apply'), configIndex = args.indexOf('--config');
  const reviewPath = applyIndex < 0 ? '.private/owner-retention-review.json' : args[applyIndex + 1];
  const configPath = configIndex < 0 ? undefined : args[configIndex + 1];
  const allowed = new Set(['--remote','--apply','--config',...(applyIndex < 0 ? [] : [reviewPath]),...(configPath ? [configPath] : [])]);
  if (!reviewPath || (configIndex >= 0 && (!remote || !configPath)) || args.some(arg => !allowed.has(arg))) throw new Error('Usage: node scripts/owner-retention.mjs [--remote --config path] [--apply .private/owner-retention-review.json]');
  await mkdir('.private',{recursive:true}); const environment = remote ? (configPath ? `Remote ${configPath}` : 'Production') : 'Local test data'; const database = await openMusicDatabase(remote, configPath);
  try {
    if (applyIndex >= 0) {
      const review = JSON.parse(await readFile(resolve(reviewPath),'utf8')); const result = await applyOwnerRetention(database,review,environment);
      console.log(`Removed ${result.rawPlayback} reviewed raw playback records and personal detail from ${result.requestContacts} reviewed requests plus ${result.softwareIntakeContacts} completed software briefs.`);
    } else {
      const review = await previewOwnerRetention(database,environment); await writeFile(reviewPath,JSON.stringify(review,null,2),{mode:0o600});
      await writeFile('.private/owner-retention-review.html',renderMusicReport('Owner data retention review',`${environment} · ${review.generatedAt}`,`${review.rawPlayback} raw playback records, ${review.requestContacts} request contacts, and ${review.softwareIntakeContacts} completed software briefs are eligible. Nothing has been removed. ${review.notes}`,{'Playback totals to preserve':review.dailySummary,'Lifetime campaign totals':review.lifetimeTotals}),{mode:0o600});
      console.log(`Preview only: ${review.rawPlayback} playback records and ${review.requestContacts} request contacts are eligible. Review .private/owner-retention-review.html, then explicitly run --apply ${reviewPath}${remote ? ' --remote' : ''}.`);
    }
  } finally { await database.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
