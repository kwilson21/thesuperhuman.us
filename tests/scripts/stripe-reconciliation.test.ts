import { expect, it } from 'vitest';
import { changedRows, reconciliationStatements } from '../../scripts/stripe-reconciliation.mjs';

it('builds bounded reconciliation statements for exact event and reservation identities', () => {
  const now = new Date('2026-09-20T16:00:00.000Z');
  expect(reconciliationStatements(['--resolve-event', 'evt_1', 'Confirmed', 'duplicate'], now)[0])
    .toContain("event_id='evt_1'");
  const clear = reconciliationStatements(['--clear-reservation', 'request-1', 'booking', 'No', 'invoice', 'exists'], now);
  expect(clear).toHaveLength(2);
  expect(clear[1]).toContain('booking_creation_started_at=NULL');
  expect(clear[1]).toContain('booking_creation_started_at IS NOT NULL');
  expect(() => reconciliationStatements(['--clear-reservation', 'request-1', 'other', 'No'], now)).toThrow();
});

it('distinguishes a real reconciliation receipt from a no-op batch', () => {
  expect(changedRows([{ meta: { changes: 0 } }, { meta: { changes: 1 } }])).toBe(1);
  expect(changedRows([{ results: [], meta: { changes: 0 } }])).toBe(0);
});
it('records full pre-start software deposit refunds and absent provider invoices by exact reservation id',()=>{
  const refunded=reconciliationStatements(['--software-deposit-refunded','local-invoice','Confirmed']);
  expect(refunded).toHaveLength(2);
  expect(refunded[1]).toContain('refunded_at=');
  expect(refunded[1]).toContain("kind='deposit'");
  expect(refunded[1]).toContain('NOT EXISTS(SELECT 1 FROM software_projects');
  const absent=reconciliationStatements(['--software-no-invoice','local-invoice','Confirmed']);
  expect(absent[1]).toContain("status='void',creation_started_at=NULL");
  expect(absent[1]).toContain('stripe_invoice_id IS NULL');
  expect(reconciliationStatements(['--resolve-software-event','evt_1','Confirmed'])[0]).toContain('software_stripe_unmatched_events');
  expect(()=>reconciliationStatements(['--software-deposit-refunded','local-invoice'])).toThrow();
});
