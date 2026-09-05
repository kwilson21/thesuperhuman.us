import { describe, it, expect, vi } from 'vitest';
const { commit, read } = vi.hoisted(() => ({ commit: vi.fn(), read: vi.fn() }));
vi.mock('~/lib/publication/journal', () => ({ D1PublicationJournal: class { commit = commit; } }));
vi.mock('~/lib/publication/read', () => ({ readProject: read }));
import { GET, POST } from '~/pages/api/work-feed';
const body = { version: 1, projectId: 'threadline', eventId: 'one', entryId: 'first',
  expectedRevision: 0, operation: 'withdraw', origin: 'work', occurredOn: '2026-09-05',
  threadId: null, milestoneId: null, story: null };
function ctx(value: unknown = body, env: Record<string, unknown> = {}, token = 'secret') {
  return { locals: { runtime: { env: { PUBLICATION_DB: {}, PUBLICATION_PROJECTS: 'threadline',
    PUBLICATION_TOKEN: 'secret', ...env } } }, url: new URL('https://example.com/api/work-feed?project=threadline'),
    request: new Request('https://example.com/api/work-feed', { method: 'POST',
      headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(value) }) } as any;
}
describe('publication receiver', () => {
  it('fails closed without authorization or a binding', async () => {
    expect((await POST(ctx(body, {}, 'wrong'))).status).toBe(401);
    expect((await POST(ctx(body, { PUBLICATION_TOKEN: undefined }))).status).toBe(401);
    expect((await POST(ctx(body, { PUBLICATION_DB: undefined }))).status).toBe(503);
  });
  it('rejects private extra fields, unlisted projects and oversized envelopes', async () => {
    expect((await POST(ctx({ ...body, privatePrompt: 'hidden' }))).status).toBe(400);
    expect((await POST(ctx({ ...body, projectId: 'private' }))).status).toBe(403);
    expect((await POST(ctx('x'.repeat(40000)))).status).toBe(413);
  });
  it.each([['accepted', 200], ['duplicate', 200], ['conflict', 409], ['withdrawn', 410], ['rejected', 400]])
    ('maps %s to %s without claiming delivery on failure', async (status, code) => {
      commit.mockResolvedValueOnce({ status });
      const response = await POST(ctx());
      expect(response.status).toBe(code); expect(await response.json()).toEqual({ status });
    });
  it('does not expose storage errors and serves only listed public projects', async () => {
    commit.mockRejectedValueOnce(new Error('private database details'));
    const response = await POST(ctx()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database');
    expect((await GET(ctx(body, { PUBLICATION_PROJECTS: '' }))).status).toBe(404);
    read.mockResolvedValueOnce({ projectId: 'threadline', revision: 0, current: null, history: [] });
    const result = await GET(ctx()); expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ current: null });
  });
});
