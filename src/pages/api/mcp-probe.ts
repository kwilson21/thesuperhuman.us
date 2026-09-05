import type { APIRoute } from 'astro';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

export const prerender = false;

/** Public connectivity probe only. No credentials, database access, or publication. */
export const ALL: APIRoute = async ({ request }) => {
  const server = new McpServer({ name: 'superhuman-connectivity-probe', version: '1.0.0' });
  server.registerTool('publication_connection_probe', {
    description: 'Test this chat connection by echoing a short nonsecret challenge. Does not publish or read project data.',
    inputSchema: z.object({ challenge: z.string().min(1).max(80) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    return { content: [{ type: 'text', text: JSON.stringify({ service: 'thesuperhuman.us', challenge: args.challenge, publishingEnabled: false }) }] };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally { await server.close(); }
};
