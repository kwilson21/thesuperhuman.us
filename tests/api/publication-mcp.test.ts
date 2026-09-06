import { it, expect } from 'vitest';
import { publicationMcp, projectAccess } from '~/lib/publication/mcp';
import { publicationOAuthRoute } from '~/lib/publication/oauth';
const env = { PUBLICATION_OWNER_ID: '10987837', PUBLICATION_PROJECTS: 'threadline', PUBLICATION_DB: {} } as Env;
const identity = { ownerId: '10987837', scopes: ['publication:threadline'] };
it('requires both current project allowlisting and a matching owner/project grant', () => {
  expect(projectAccess(env, identity, 'threadline')).toBe(true);
  expect(projectAccess(env, { ...identity, ownerId: 'other' }, 'threadline')).toBe(false);
  expect(projectAccess(env, { ...identity, scopes: [] }, 'threadline')).toBe(false);
  expect(projectAccess({ ...env, PUBLICATION_PROJECTS: '' }, identity, 'threadline')).toBe(false);
  expect(projectAccess({ ...env, PUBLICATION_PROJECTS: 'threadline,other' }, identity, 'other')).toBe(false);
});
it('exposes tools with explicit mutating annotations and denies unauthorized projects before storage', async () => {
  const request = (method: string, params = {}) => new Request('https://thesuperhuman.us/api/publication/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const response = await publicationMcp(request('tools/list'), env, identity);
  const list = await response.json() as any;
  expect(list.result.tools).toHaveLength(2);
  expect(list.result.tools.find((t: any) => t.name === 'publish_project_update').annotations.destructiveHint).toBe(true);
  for (const name of ['get_project_progress']) {
    const reply = await publicationMcp(request('tools/call', { name, arguments: { projectId: 'private' } }), env, identity);
    expect((await reply.json() as any).result.isError).toBe(true);
  }
});
it('fails closed before OAuth runtime loading when deployment credentials are absent', async () => {
  const call = (url: string) => publicationOAuthRoute({ request: new Request(url), locals: { runtime: { env, ctx: {} } } } as any);
  expect((await call('https://thesuperhuman.us/api/publication/mcp')).status).toBe(503);
  expect((await call('https://preview.workers.dev/api/publication/mcp')).status).toBe(404);
});
