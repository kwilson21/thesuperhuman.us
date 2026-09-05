import { describe, it, expect } from 'vitest';
import { parsePublication } from '~/lib/publication/contract';

function candidate() {
  return {
    version: 1, projectId: 'threadline', eventId: 'outcome-1', entryId: 'episode-1',
    expectedRevision: 0, operation: 'publish', origin: 'backfill', occurredOn: '2026-09-02',
    threadId: null, milestoneId: null,
    story: { headline: 'Resume work with context', summary: 'The first return experience is ready for evaluation.',
      technicalDetail: null, delivery: 'implemented', basis: 'repository-verified' },
  };
}

describe('publication transport boundary', () => {
  it('preserves day precision and allows unassigned exploratory work', () => {
    expect(parsePublication(candidate())).toEqual(candidate());
  });
  it('rejects extra private fields at both levels', () => {
    expect(parsePublication({ ...candidate(), sourcePath: '/private/chat' })).toBeNull();
    expect(parsePublication({ ...candidate(), story: { ...candidate().story, prompt: 'private' } })).toBeNull();
  });
  it.each(['2026-02-30', '2026-13-01', 'yesterday', '2026-09-02T01:02:03Z'])(
    'rejects invalid or invented precision: %s', occurredOn => {
      expect(parsePublication({ ...candidate(), occurredOn })).toBeNull();
    });
  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects revision %s', expectedRevision => {
    expect(parsePublication({ ...candidate(), expectedRevision })).toBeNull();
  });
  it('requires a content-free withdrawal and a story for other operations', () => {
    expect(parsePublication({ ...candidate(), operation: 'withdraw' })).toBeNull();
    expect(parsePublication({ ...candidate(), operation: 'withdraw', story: null })).not.toBeNull();
    expect(parsePublication({ ...candidate(), story: null })).toBeNull();
  });
  it('does not accept implicit completion or unknown provenance', () => {
    expect(parsePublication({ ...candidate(), story: { ...candidate().story, delivery: 'completed' } })).toBeNull();
    expect(parsePublication({ ...candidate(), origin: 'guess' })).toBeNull();
  });
  it('detaches prepared content from mutable caller data', () => {
    const input = candidate(); const parsed = parsePublication(input);
    input.story.summary = 'changed after preparation';
    expect(parsed?.story?.summary).not.toBe(input.story.summary);
  });
});
