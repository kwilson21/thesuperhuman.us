import { beforeEach, describe, expect, it, vi } from 'vitest';
import { websiteFeed } from '~/lib/publication/website';
import { readProject } from '~/lib/publication/read';
vi.mock('~/lib/publication/read', () => ({ readProject: vi.fn() }));
const env = { PUBLICATION_DB: {}, PUBLICATION_PROJECTS: 'threadline, the-engineers-daily' } as Env;
beforeEach(() => vi.clearAllMocks());
describe('optional project feeds', () => {
  it('preserves the default Threadline caller', async () => {
    await websiteFeed(env);
    expect(readProject).toHaveBeenCalledWith(env.PUBLICATION_DB, 'threadline');
  });
  it('reads the requested allowed project, never another project', async () => {
    await websiteFeed(env, 'the-engineers-daily');
    expect(readProject).toHaveBeenCalledTimes(1);
    expect(readProject).toHaveBeenCalledWith(env.PUBLICATION_DB, 'the-engineers-daily');
  });
  it('does not query projects outside the allowlist or without a binding', async () => {
    expect(await websiteFeed(env, 'private-project')).toBeNull();
    expect(await websiteFeed({ PUBLICATION_PROJECTS: 'threadline' } as Env)).toBeNull();
    expect(readProject).not.toHaveBeenCalled();
  });
  it('does not break the page if optional publication data fails', async () => {
    vi.mocked(readProject).mockRejectedValueOnce(new Error('offline'));
    expect(await websiteFeed(env, 'the-engineers-daily')).toBeNull();
  });
});
