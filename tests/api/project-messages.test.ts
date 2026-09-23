import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { POST as clientPost } from '~/pages/api/studio/projects/[id]/messages';
import { POST as ownerPost } from '~/pages/api/owner/projects/[id]/messages';
import { completeClientCode, issueClientCode } from '~/lib/audio-client-access';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const baseline = readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8');
const secret = 'studio-code-key-for-tests-32-characters';
let sql: InstanceType<typeof DatabaseSync>, db: D1Database, token: string;

beforeEach(async () => {
  sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(baseline);
  sql.prepare(`INSERT INTO owner_requests(id,kind,email,summary,status,created_at,updated_at)
    VALUES ('song-1','service','artist@example.com','A song','new',?,?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  const statement = (query: string, args: unknown[] = []) => ({
    query, args,
    bind: (...values: unknown[]) => statement(query, values),
    run: async () => ({ results: [], meta: { changes: sql.prepare(query).run(...args).changes } }),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    first: async () => sql.prepare(query).get(...args) ?? null,
  });
  db = { prepare: (query: string) => statement(query), batch: async (items: ReturnType<typeof statement>[]) => {
    sql.exec('BEGIN');
    try {
      const results = items.map(item => ({ results: /\bRETURNING\b/i.test(item.query) ? sql.prepare(item.query).all(...item.args) : (sql.prepare(item.query).run(...item.args), []) }));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const code = (await issueClientCode(db, 'artist@example.com', secret))!;
  token = (await completeClientCode(db, 'artist@example.com', code, secret))!;
});

function context(actor: 'owner' | 'client', body: unknown, options: { enabled?: boolean; owner?: boolean; origin?: string; id?: string; cookie?: boolean } = {}) {
  const owner = options.owner ?? actor === 'owner';
  const path = actor === 'owner' ? 'owner' : 'studio';
  const id = options.id ?? 'song-1';
  return {
    params: { id },
    request: new Request(`https://thesuperhuman.us/api/${path}/projects/${id}/messages`, {
      method: 'POST', headers: {
        origin: options.origin ?? 'https://thesuperhuman.us', 'content-type': 'application/json',
        cookie: options.cookie === false ? '' : `studio_session=${token}`,
      }, body: JSON.stringify(body),
    }),
    locals: { owner: owner ? { email: 'owner@example.com' } : undefined, runtime: { env: {
      AUDIO_CLIENT_PORTAL_ENABLED: options.enabled === false ? 'false' : 'true', MUSIC_DB: db,
    } } },
  } as any;
}

it('requires the right actor and an active portal before storing messages', async () => {
  expect((await ownerPost(context('owner', { action: 'send', body: 'Hi.' }, { owner: false }))).status).toBe(403);
  expect((await clientPost(context('client', { action: 'send', body: 'Hi.' }, { cookie: false }))).status).toBe(401);
  expect((await clientPost(context('client', { action: 'send', body: 'Hi.' }, { enabled: false }))).status).toBe(404);
  expect((await clientPost(context('client', { action: 'send', body: 'Hi.' }, { id: 'another-song' }))).status).toBe(404);
  expect(sql.prepare('SELECT count(*) AS n FROM audio_project_messages').get()).toEqual({ n: 0 });
  sql.close();
});

it('stores both sides of the thread, validates links, and rejects cross-site posts', async () => {
  expect((await ownerPost(context('owner', { action: 'send', body: 'What direction feels right?' }))).status).toBe(200);
  expect((await clientPost(context('client', { action: 'send', body: 'I updated https://drive.google.com/file/example' }))).status).toBe(200);
  expect((await clientPost(context('client', { action: 'send', body: 'http://example.com/file' }))).status).toBe(400);
  expect((await clientPost(context('client', { action: 'send', body: 'Cross-site' }, { origin: 'https://other.example' }))).status).toBe(403);
  expect(sql.prepare('SELECT actor,body FROM audio_project_messages ORDER BY id').all())
    .toEqual([{ actor: 'owner', body: 'What direction feels right?' }, { actor: 'client', body: 'I updated https://drive.google.com/file/example' }]);
  sql.close();
});

it('rate-limits client messages without deleting earlier messages', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    clientPost(context('client', { action: 'send', body: `Note ${index}` }))));
  expect(responses.filter(response => response.status === 200)).toHaveLength(12);
  expect(responses.filter(response => response.status === 429)).toHaveLength(8);
  expect(sql.prepare('SELECT count(*) AS n FROM audio_project_messages').get()).toEqual({ n: 12 });
  sql.close();
});

it('does not consume a message allowance when the project rejects the write', async () => {
  sql.prepare("UPDATE audio_projects SET stage='complete' WHERE request_id='song-1'").run();
  expect((await clientPost(context('client', { action: 'send', body: 'Too late' }))).status).toBe(409);
  expect(sql.prepare('SELECT count(*) AS n FROM audio_project_messages').get()).toEqual({ n: 0 });
  sql.close();
});
