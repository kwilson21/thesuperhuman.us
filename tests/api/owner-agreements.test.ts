import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { POST } from '~/pages/api/owner/agreements';
import { templateFields } from '~/lib/agreement-templates';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
let sql: InstanceType<typeof DatabaseSync>, db: D1Database;
beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync('db/music.sql', 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({
    query,
    args,
    bind: (...values: unknown[]) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ meta: sql.prepare(query).run(...args) }),
  });
  db = {
    prepare: (query: string) => statement(query),
    batch: async (items: ReturnType<typeof statement>[]) => {
      sql.exec('BEGIN');
      try {
        const result = items.map((item) => ({
          results: /^SELECT|RETURNING/.test(item.query)
            ? sql.prepare(item.query).all(...item.args)
            : (sql.prepare(item.query).run(...item.args), []),
        }));
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
});

const synthetic = (kind: 'msa' | 'sow') =>
  templateFields[kind]
    .filter((f) => !f.startsWith('milestone.'))
    .map((f) => `${f}: {{${f}}}`)
    .join('\n') +
  (kind === 'sow'
    ? '\n{{#milestones}}\n' +
      templateFields.sow
        .filter((f) => f.startsWith('milestone.'))
        .map((f) => `${f}: {{${f}}}`)
        .join('\n') +
      '\n{{/milestones}}'
    : '');
const revised = (kind: 'msa' | 'sow') => synthetic(kind).replace('\n', ' revised\n');

function post(body: unknown) {
  return POST({
    request: new Request('https://thesuperhuman.us/api/owner/agreements', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://thesuperhuman.us' },
      body: JSON.stringify(body),
    }),
    locals: { owner: { email: 'owner@example.com' }, runtime: { env: { MUSIC_DB: db } } },
  } as unknown as APIContext);
}
const publish = (kind: 'msa' | 'sow', text: string, expectedCurrentVersion: number, versionLabel?: string, extra: Record<string, unknown> = {}) =>
  post({ action: 'publish', kind, text, expectedCurrentVersion, confirmed: true, versionLabel, ...extra });

it('previews without a comparison before the first publication and with a line diff after', async () => {
  const first = await (await post({ action: 'preview', kind: 'msa', text: synthetic('msa'), expectedCurrentVersion: 0 })).json();
  expect(first).toEqual({ ok: true, text: expect.any(String), compare: null });
  expect((await publish('msa', synthetic('msa'), 0, 'v1')).status).toBe(200);
  const lines = synthetic('msa').split('\n');
  const changed = (await (await post({ action: 'preview', kind: 'msa', text: revised('msa'), expectedCurrentVersion: 1 })).json()) as { compare: unknown };
  expect(changed.compare).toEqual({
    label: 'v1',
    rows: [
      { kind: 'removed', text: lines[0] },
      { kind: 'added', text: `${lines[0]} revised` },
      { kind: 'unchanged', count: lines.length - 1 },
    ],
  });
});

it('previews the submitted version label where the template names the source revision', async () => {
  const labelled = await (await post({ action: 'preview', kind: 'msa', text: synthetic('msa'), expectedCurrentVersion: 0, versionLabel: 'v2026-12-01' })).json() as { text: string };
  expect(labelled.text).toContain('msa.source_revision: v2026-12-01');
  const blank = await (await post({ action: 'preview', kind: 'msa', text: synthetic('msa'), expectedCurrentVersion: 0, versionLabel: '' })).json() as { text: string };
  expect(blank.text).toContain('msa.source_revision: Sample version label');
});

it('falls back to the sample label when a typed preview label would not publish', async () => {
  for (const versionLabel of ['[draft]', 'v{{x}}']) {
    const preview = (await (await post({ action: 'preview', kind: 'msa', text: synthetic('msa'), expectedCurrentVersion: 0, versionLabel })).json()) as { ok: boolean; text: string };
    expect(preview).toMatchObject({ ok: true, text: expect.stringContaining('msa.source_revision: Sample version label') });
  }
});

it('publishes the label and source revision, storing a blank revision as NULL', async () => {
  expect(await (await publish('msa', synthetic('msa'), 0, 'v2026-09-30', { sourceRevision: ' ' })).json()).toEqual({
    ok: true,
    id: expect.any(String),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    version: 1,
    versionLabel: 'v2026-09-30',
  });
  expect(sql.prepare('SELECT version_label,source_revision FROM software_agreement_templates').get()).toEqual({
    version_label: 'v2026-09-30',
    source_revision: null,
  });
  expect((await publish('msa', revised('msa'), 1, '2.0.1-rc', { sourceRevision: ' synthetic-revision ' })).status).toBe(200);
  expect(sql.prepare("SELECT version_label,source_revision FROM software_agreement_templates WHERE version=2").get()).toEqual({
    version_label: '2.0.1-rc',
    source_revision: 'synthetic-revision',
  });
});

it('refuses a missing, spaced, slashed or over-long label before publishing', async () => {
  for (const versionLabel of [undefined, 'v 1', 'v1/2', 'a'.repeat(41)]) {
    const response = await publish('msa', synthetic('msa'), 0, versionLabel);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Check required fields and limits.' });
  }
  expect(sql.prepare('SELECT COUNT(*) AS total FROM software_agreement_templates').get()).toEqual({ total: 0 });
});

it('shows the identical-text and duplicate-label refusals to the owner unchanged', async () => {
  expect((await publish('msa', synthetic('msa'), 0, 'v1')).status).toBe(200);
  expect((await publish('sow', synthetic('sow'), 0, 'v1')).status).toBe(200);
  const refusals = [
    [await publish('msa', synthetic('msa'), 1, 'v2'), 'This text matches v1. Nothing to publish.'],
    [await publish('msa', revised('msa'), 1, 'v1'), 'v1 is already used for the MSA. Choose another label.'],
    [await publish('sow', revised('sow'), 1, 'v1'), 'v1 is already used for the SOW. Choose another label.'],
  ] as const;
  for (const [response, error] of refusals) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error });
  }
});

it('returns a stored version with its label and comparison, and 404 for an unknown version', async () => {
  expect((await publish('msa', synthetic('msa'), 0, 'v1')).status).toBe(200);
  expect((await publish('msa', revised('msa'), 1, 'v2')).status).toBe(200);
  const lines = synthetic('msa').split('\n');
  expect(await (await post({ action: 'template-version', kind: 'msa', version: 1 })).json()).toEqual({
    ok: true,
    version: 1,
    label: 'v1',
    text: synthetic('msa'),
    compare: null,
  });
  expect(await (await post({ action: 'template-version', kind: 'msa', version: 2 })).json()).toEqual({
    ok: true,
    version: 2,
    label: 'v2',
    text: revised('msa'),
    compare: {
      label: 'v1',
      rows: [
        { kind: 'removed', text: lines[0] },
        { kind: 'added', text: `${lines[0]} revised` },
        { kind: 'unchanged', count: lines.length - 1 },
      ],
    },
  });
  const missing = await post({ action: 'template-version', kind: 'msa', version: 9 });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ ok: false, error: 'That version was not found.' });
});
