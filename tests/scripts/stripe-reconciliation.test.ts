import { expect, it } from 'vitest';
import { changedRows, reconciliationStatements } from '../../scripts/stripe-reconciliation.mjs';

it('builds bounded reconciliation statements for exact event and reservation identities', () => {
  const now = new Date('2026-09-20T16:00:00.000Z');
  expect(reconciliationStatements(['--resolve-event', 'evt_1', 'Confirmed', 'duplicate'], now)[0])
    .toContain("event_id='evt_1'");
  const clear = reconciliationStatements(['--clear-reservation', 'request-1', 'booking', 'No', 'invoice', 'exists'], now);
  expect(clear).toHaveLength(2);
  expect(clear[1]).toContain('booking_creation_started_at=NULL');
  expect(() => reconciliationStatements(['--clear-reservation', 'request-1', 'other', 'No'], now)).toThrow();
});

it('distinguishes a real reconciliation receipt from a no-op batch', () => {
  expect(changedRows([{ meta: { changes: 0 } }, { meta: { changes: 1 } }])).toBe(1);
  expect(changedRows([{ results: [], meta: { changes: 0 } }])).toBe(0);
});
