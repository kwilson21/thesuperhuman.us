import type { APIRoute } from 'astro';
import { parsePublication } from '~/lib/publication/contract';
import { D1PublicationJournal } from '~/lib/publication/journal';
import { readProject } from '~/lib/publication/read';

export const prerender = false;
const headers = { 'cache-control': 'no-store' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
function allowed(env: Env, project: string): boolean {
  return (env.PUBLICATION_PROJECTS ?? '').split(',').map(p => p.trim()).filter(Boolean).includes(project);
}
async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const supplied = request.headers.get('authorization');
  if (!supplied?.startsWith('Bearer ') || supplied.length > 4096) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(supplied.slice(7)), digest(token)]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const project = url.searchParams.get('project') ?? '';
  if (!allowed(env, project)) return reply({ error: 'Project unavailable.' }, 404);
  if (!env.PUBLICATION_DB) return reply({ error: 'Updates unavailable.' }, 503);
  try { return reply(await readProject(env.PUBLICATION_DB, project)); }
  catch { return reply({ error: 'Updates unavailable.' }, 503); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env;
  if (!await authorized(request, env.PUBLICATION_TOKEN)) return reply({ error: 'Unauthorized.' }, 401);
  if (!env.PUBLICATION_DB) return reply({ error: 'Delivery unavailable.' }, 503);
  let input: unknown;
  try {
    // Read a bounded UTF-8 envelope even if Content-Length was omitted or incorrect.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Missing publication.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return reply({ error: 'Publication too large.' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return reply({ error: 'Invalid publication.' }, 400); }
  const publication = parsePublication(input);
  if (!publication) return reply({ error: 'Invalid publication.' }, 400);
  if (!allowed(env, publication.projectId)) return reply({ error: 'Project unavailable.' }, 403);
  try {
    const result = await new D1PublicationJournal(env.PUBLICATION_DB).commit(publication);
    return reply(result, result.status === 'conflict' ? 409 : result.status === 'withdrawn' ? 410
      : result.status === 'rejected' ? 400 : 200);
  } catch { return reply({ error: 'Delivery pending. Retry the same event.' }, 503); }
};
