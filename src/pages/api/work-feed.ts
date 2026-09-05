import type { APIRoute } from 'astro';
import {
  WORK_FEED_KEY,
  allowedWorkFeedProjects,
  parseStoredWorkUpdate,
  secretsMatch,
  validatePublicWorkUpdate,
} from '~/lib/work-feed';

export const prerender = false;

const RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

function envFrom(locals: App.Locals): Env {
  return (locals as any).runtime.env as Env;
}

export const GET: APIRoute = async ({ locals }) => {
  const stored = await envFrom(locals).WORK_FEED.get(WORK_FEED_KEY);
  return Response.json(
    { update: parseStoredWorkUpdate(stored) },
    { headers: RESPONSE_HEADERS },
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envFrom(locals);
  const authorization = request.headers.get('authorization');
  const suppliedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (
    !env.WORK_FEED_INGEST_TOKEN
    || !suppliedToken
    || !(await secretsMatch(suppliedToken, env.WORK_FEED_INGEST_TOKEN))
  ) {
    return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers: RESPONSE_HEADERS });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const validation = validatePublicWorkUpdate(body);
  if (!validation.ok) {
    return Response.json(
      { ok: false, error: validation.error },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const update = validation.value;
  if (!allowedWorkFeedProjects(env.WORK_FEED_ALLOWED_PROJECTS).has(update.projectId)) {
    return Response.json({ ok: false, error: 'Project is not allowlisted.' }, { status: 403, headers: RESPONSE_HEADERS });
  }

  const current = parseStoredWorkUpdate(await env.WORK_FEED.get(WORK_FEED_KEY));
  if (current && update.revision <= current.revision) {
    return Response.json(
      { ok: false, error: 'Revision is not newer than the published update.' },
      { status: 409, headers: RESPONSE_HEADERS },
    );
  }

  await env.WORK_FEED.put(WORK_FEED_KEY, JSON.stringify(update));
  return Response.json({ ok: true, revision: update.revision }, { headers: RESPONSE_HEADERS });
};
