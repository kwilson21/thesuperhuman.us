import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import type { APIContext } from 'astro';
import { expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/owner/agreements';
import { templateFields } from '~/lib/agreement-templates';

it.each(['msa', 'sow'] as const)('renders the %s preview when named action buttons shadow the form endpoint', async kind => {
  const fields = templateFields[kind];
  const text = fields.filter(field => !field.startsWith('milestone.')).map(field => `{{${field}}}`).join('\n')
    + (kind === 'sow' ? '\n{{#milestones}}\n' + fields.filter(field => field.startsWith('milestone.')).map(field => `{{${field}}}`).join('\n') + '\n{{/milestones}}' : '');
  const status = { textContent: '' }, preview = { textContent: '' };
  let submit!: (event: unknown) => Promise<void>;
  const form = {
    // HTMLFormElement named access returns a RadioNodeList for these two buttons.
    action: { toString: () => '[object RadioNodeList]' },
    getAttribute: (name: string) => name === 'action' ? '/api/owner/agreements' : null,
    hasAttribute: () => false,
    querySelector: (selector: string) => selector === '[role="status"]' ? status : preview,
    addEventListener: (_: string, handler: typeof submit) => { submit = handler; },
  };
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    expect(path).toBe('/api/owner/agreements');
    expect(JSON.parse(String(init.body)).action).toBe('preview');
    return POST({
      request: new Request(`https://example.test${path}`, { ...init, headers: { ...init.headers, origin: 'https://example.test' } }),
      locals: { owner: { email: 'owner@example.test' }, runtime: { env: { MUSIC_DB: {} } } },
    } as unknown as APIContext);
  });
  const source = readFileSync('src/pages/owner/agreements.astro', 'utf8').split('<script>')[1].split('</script>')[0];
  runInNewContext(transpileModule(source, {}).outputText, {
    document: { querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [form] },
    FormData: class { *[Symbol.iterator]() { yield* Object.entries({ kind, text, expectedCurrentVersion: '1' }); } },
    fetch, location: { reload: () => { throw new Error('Preview must remain on the page'); } },
  });
  await submit({ preventDefault: () => {}, submitter: { value: 'preview' } });
  expect(fetch).toHaveBeenCalledOnce();
  expect(status.textContent).toBe('');
  expect(preview.textContent).toContain('Sample');
  expect(preview.textContent).not.toMatch(/{{|}}/);
});
