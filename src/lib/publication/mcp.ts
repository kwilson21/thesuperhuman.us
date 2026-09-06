import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { parsePublication } from './contract';
import { deliver } from './delivery';
import { D1PublicationOutbox } from './outbox';
import { D1PublicationJournal } from './journal';
import { readProject } from './read';

export interface PublicationIdentity { ownerId: string; scopes: string[] }
export const scopeFor = (project: string) => `publication:${project}`;
export function projectAccess(env: Env, identity: PublicationIdentity, project: string): boolean {
  return Boolean(env.PUBLICATION_OWNER_ID) && identity.ownerId === env.PUBLICATION_OWNER_ID
    && identity.scopes.includes(scopeFor(project))
    && (env.PUBLICATION_PROJECTS ?? '').split(',').map(s => s.trim()).includes(project);
}
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
const envelope = z.object({
  version: z.literal(1), projectId: id, eventId: id, entryId: id,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  operation: z.enum(['publish', 'correct', 'withdraw']), origin: z.enum(['work', 'shutdown', 'backfill']),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), threadId: id.nullable(), milestoneId: id.nullable(),
  story: z.object({ headline: z.string().min(1).max(140), summary: z.string().min(1).max(1000),
    technicalDetail: z.string().min(1).max(4000).nullable(),
    delivery: z.enum(['proposed', 'implemented', 'tested', 'available']),
    basis: z.enum(['agent-reported', 'repository-verified', 'human-confirmed']),
  }).strict().nullable(),
}).strict();
const result = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError });

/** Called only after OAuth token verification. No public route calls this directly. */
export async function publicationMcp(request: Request, env: Env, identity: PublicationIdentity): Promise<Response> {
  if (!env.PUBLICATION_DB) return new Response('Publication unavailable', { status: 503 });
  const server = new McpServer({ name: 'superhuman-publication', version: '1.0.0' }, {
    instructions: 'Follow docs/publication-agent-protocol.md in kwilson21/thesuperhuman.us. Reconcile the project roadmap and review public wording before delivery. Never send raw private evidence or secrets. Receipts confirm ingestion, not completion or website rendering. Retry identical envelopes; reconcile conflicts without blindly increasing revisions.',
  });
  const outbox = new D1PublicationOutbox(env.PUBLICATION_DB);
  const scopes = identity.scopes.filter(scope => scope.startsWith('publication:'));
  const security = { securitySchemes: [{ type: 'oauth2', scopes }] };
  server.registerTool('get_project_progress', {
    description: 'Read published progress and the current revision for an authorized project. Use before preparing an update or resolving a conflict.',
    inputSchema: z.object({ projectId: id }).strict(), _meta: security,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ projectId }) => {
    if (!projectAccess(env, identity, projectId)) return result({ status: 'forbidden' }, true);
    try { return result(await readProject(env.PUBLICATION_DB!, projectId)); }
    catch { return result({ status: 'unavailable' }, true); }
  });
  server.registerTool('get_pending_publications', {
    description: 'Recover up to 100 private, audience-reviewed pending envelopes after an interrupted session. Review current policy before retrying each exact envelope. Does not publish.',
    inputSchema: z.object({ projectId: id }).strict(), _meta: security,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ projectId }) => {
    if (!projectAccess(env, identity, projectId)) return result({ status: 'forbidden' }, true);
    try { return result({ pending: await outbox.pending(projectId) }); }
    catch { return result({ status: 'unavailable' }, true); }
  });
  server.registerTool('publish_project_update', {
    description: 'Publish, correct, backfill, or permanently withdraw public website progress after canonical reconciliation and audience review. Use plain-language outcomes and accurate delivery/basis. Preserve event identity on retries. A withdrawal removes the entry and blocks restoration. A conflict requires source reconciliation, not automatic revision advancement.',
    inputSchema: z.object({ publication: envelope }).strict(), _meta: security,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ publication }) => {
    if (!projectAccess(env, identity, publication.projectId)) return result({ status: 'forbidden' }, true);
    const parsed = parsePublication(publication);
    if (!parsed) return result({ status: 'invalid' }, true);
    const outcome = await deliver(parsed, { outbox, journal: new D1PublicationJournal(env.PUBLICATION_DB!),
      mayPublish: async p => projectAccess(env, identity, p.projectId) });
    return result(outcome, outcome.status !== 'delivered');
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally { await server.close(); }
}
