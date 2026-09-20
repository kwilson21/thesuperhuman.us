#!/usr/bin/env node
import { openMusicDatabase } from './music-analytics.mjs';
import { pathToFileURL } from 'node:url';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value);

export function reconciliationStatements(args, now = new Date()) {
  const [action, first, second, ...rest] = args;
  const note = rest.join(' ').trim();
  const at = now.toISOString();
  if (action === '--resolve-event' && validId(first) && second?.trim()) {
    return [`UPDATE stripe_unmatched_events SET resolved_at=${quote(at)},resolution=${quote([second, ...rest].join(' ').trim())}
      WHERE event_id=${quote(first)} AND resolved_at IS NULL`];
  }
  if (action === '--clear-reservation' && validId(first) && ['booking','balance'].includes(second) && note) {
    return [
      `INSERT INTO owner_request_audit(request_id,action,actor,note,occurred_at)
        SELECT ${quote(first)},${quote(`${second}-payment-updated`)},'stripe-reconciliation',${quote(note)},${quote(at)}
        WHERE EXISTS (SELECT 1 FROM audio_payments WHERE request_id=${quote(first)} AND ${second}_invoice_id IS NULL AND ${second}_creation_started_at IS NOT NULL)`,
      `UPDATE audio_payments SET ${second}_creation_started_at=NULL,updated_at=${quote(at)}
        WHERE request_id=${quote(first)} AND ${second}_invoice_id IS NULL`,
    ];
  }
  throw new Error('Use --resolve-event EVENT_ID NOTE or --clear-reservation REQUEST_ID booking|balance NOTE.');
}

export function changedRows(value) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + changedRows(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const changes = Number(value.meta?.changes);
  return (Number.isFinite(changes) ? changes : 0) + changedRows(value.results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = await openMusicDatabase(process.argv.includes('--remote'));
  try {
    const args = process.argv.slice(2).filter(value => value !== '--remote');
    if (!args.length) {
      console.log(JSON.stringify(await database.query(`SELECT event_id,event_type,invoice_id,request_id,installment,status,reason,received_at
        FROM stripe_unmatched_events WHERE resolved_at IS NULL ORDER BY received_at`), null, 2));
    } else {
      const results = await database.batch(reconciliationStatements(args));
      if (changedRows(results) < 1) throw new Error('No matching unresolved event or pending reservation was changed.');
      console.log('Stripe reconciliation recorded. Run owner:health to verify the result.');
    }
  } finally { await database.close(); }
}
