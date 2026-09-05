import { describe, it, expect, vi } from 'vitest';
import { deliver, type DeliveryPorts } from '~/lib/publication/delivery';
import type { Publication, Receipt } from '~/lib/publication/contract';

const publication: Publication = {
  version: 1, projectId: 'threadline', eventId: 'outcome-1', entryId: 'episode-1',
  expectedRevision: 0, operation: 'publish', origin: 'shutdown', occurredOn: '2026-09-05',
  threadId: null, milestoneId: null,
  story: { headline: 'A clearer return to work', summary: 'The return experience is ready to evaluate.',
    technicalDetail: null, delivery: 'implemented', basis: 'repository-verified' },
};
const receipt: Receipt = { projectId: 'threadline', eventId: 'outcome-1', revision: 1,
  publishedAt: '2026-09-05T21:00:00.000Z' };

function fixture() {
  let stored: Publication | null = null;
  let ack: Receipt | null = null;
  const ports = {
    outbox: {
      prepare: vi.fn(async (p: Publication) => {
        stored ??= structuredClone(p);
        return { publication: structuredClone(stored), receipt: ack };
      }),
      acknowledge: vi.fn(async (r: Receipt) => { ack = r; }),
    },
    mayPublish: vi.fn(async () => true),
    journal: { commit: vi.fn<DeliveryPorts['journal']['commit']>(async () => ({ status: 'accepted', receipt })) },
  };
  return ports;
}

describe('protocol-boundary delivery', () => {
  it('repairs a corrupt stored receipt through idempotent journal delivery', async () => {
    const p = fixture();
    await p.outbox.acknowledge({ ...receipt, revision: 0 });
    p.journal.commit.mockResolvedValue({ status: 'duplicate', receipt });
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
    expect(p.journal.commit).toHaveBeenCalledTimes(1);
    expect(p.outbox.acknowledge).toHaveBeenLastCalledWith(receipt);
  });
  it('persists before transport and records acknowledgement before reporting delivery', async () => {
    const p = fixture();
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
    expect(p.outbox.prepare.mock.invocationCallOrder[0]).toBeLessThan(p.journal.commit.mock.invocationCallOrder[0]);
    expect(p.journal.commit.mock.invocationCallOrder[0]).toBeLessThan(p.outbox.acknowledge.mock.invocationCallOrder[0]);
  });
  it('does not send when policy holds the update', async () => {
    const p = fixture(); p.mayPublish.mockResolvedValue(false);
    expect(await deliver(publication, p)).toEqual({ status: 'held' });
    expect(p.journal.commit).not.toHaveBeenCalled();
  });
  it('retries after network failure with the same event identity', async () => {
    const p = fixture(); p.journal.commit.mockRejectedValueOnce(new Error('offline'));
    expect(await deliver(publication, p)).toEqual({ status: 'pending' });
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
    expect(p.journal.commit.mock.calls.map(c => c[0].eventId)).toEqual(['outcome-1', 'outcome-1']);
  });
  it('recovers a lost acknowledgement using a duplicate server receipt', async () => {
    const p = fixture(); p.outbox.acknowledge.mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await deliver(publication, p)).toEqual({ status: 'pending' });
    p.journal.commit.mockResolvedValue({ status: 'duplicate', receipt });
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
  });
  it('uses a receipt for an unchanged retry and still rechecks policy', async () => {
    const p = fixture(); await deliver(publication, p);
    expect(await deliver(publication, p)).toEqual({ status: 'delivered', receipt });
    expect(p.journal.commit).toHaveBeenCalledTimes(1);
    p.mayPublish.mockResolvedValue(false);
    expect(await deliver(publication, p)).toEqual({ status: 'held' });
  });
  it('refuses to overwrite a pending event with changed content', async () => {
    const p = fixture(); p.journal.commit.mockRejectedValueOnce(new Error('offline'));
    await deliver(publication, p);
    expect(await deliver({ ...publication, story: { ...publication.story, summary: 'Different outcome' } }, p))
      .toEqual({ status: 'conflict' });
    expect(p.journal.commit).toHaveBeenCalledTimes(1);
  });
  it.each(['conflict', 'withdrawn', 'rejected'] as const)('does not force a %s result', async status => {
    const p = fixture(); p.journal.commit.mockResolvedValue({ status });
    expect(await deliver(publication, p)).toEqual({ status });
    expect(p.outbox.acknowledge).not.toHaveBeenCalled();
  });
  it('rejects mismatched, regressive, or malformed receipts', async () => {
    for (const wrong of [{ ...receipt, projectId: 'other' }, { ...receipt, revision: 0 },
      { ...receipt, publishedAt: '2026-02-30T21:00:00.000Z' }]) {
      const p = fixture(); p.journal.commit.mockResolvedValue({ status: 'accepted', receipt: wrong });
      expect(await deliver(publication, p)).toEqual({ status: 'pending' });
      expect(p.outbox.acknowledge).not.toHaveBeenCalled();
    }
  });
  it('makes no external calls for invalid input', async () => {
    const p = fixture(); expect(await deliver({ secret: 'private' }, p)).toEqual({ status: 'invalid' });
    expect(p.outbox.prepare).not.toHaveBeenCalled();
  });
});
