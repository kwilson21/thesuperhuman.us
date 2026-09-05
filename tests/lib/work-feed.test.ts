import { describe, expect, it } from 'vitest';
import {
  allowedWorkFeedProjects,
  parseStoredWorkUpdate,
  secretsMatch,
  validatePublicWorkUpdate,
} from '~/lib/work-feed';

const validUpdate = {
  schemaVersion: 1,
  projectId: 'threadline',
  projectName: 'Threadline',
  headline: 'Orchestrating live provisional threads',
  summary: 'Directing agents as they connect bounded evidence to a continuously revised public-safe projection.',
  status: 'active',
  revision: 3,
  updatedAt: '2026-09-05T19:30:00.000Z',
  links: [{ label: 'Repository', url: 'https://github.com/kwilson21/threadline' }],
};

describe('validatePublicWorkUpdate', () => {
  it('accepts the bounded public projection', () => {
    expect(validatePublicWorkUpdate(validUpdate)).toEqual({ ok: true, value: validUpdate });
  });

  it('rejects extra fields so raw evidence cannot ride along', () => {
    const result = validatePublicWorkUpdate({
      ...validUpdate,
      artifactRefs: ['packages/private/file.ts'],
    });
    expect(result).toEqual({ ok: false, error: 'Update contains unsupported fields.' });
  });

  it('rejects unsupported status and unsafe links', () => {
    expect(validatePublicWorkUpdate({ ...validUpdate, status: 'completed' }).ok).toBe(false);
    expect(validatePublicWorkUpdate({
      ...validUpdate,
      links: [{ label: 'Local file', url: 'file:///private/source.ts' }],
    }).ok).toBe(false);
  });
});

describe('work-feed helpers', () => {
  it('fails closed for malformed stored state', () => {
    expect(parseStoredWorkUpdate('{bad json')).toBeNull();
    expect(parseStoredWorkUpdate(JSON.stringify({ ...validUpdate, revision: 0 }))).toBeNull();
  });

  it('parses comma-separated project allowlists', () => {
    expect(allowedWorkFeedProjects('threadline, another-project ')).toEqual(
      new Set(['threadline', 'another-project']),
    );
  });

  it('compares ingest secrets without direct string equality', async () => {
    await expect(secretsMatch('same-secret', 'same-secret')).resolves.toBe(true);
    await expect(secretsMatch('wrong-secret', 'same-secret')).resolves.toBe(false);
  });
});
