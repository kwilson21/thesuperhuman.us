import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ModuleKind, transpileModule } from 'typescript';
import type { APIContext } from 'astro';
import { expect, it, vi } from 'vitest';
import { POST } from '~/pages/api/owner/agreements';
import { templateFields } from '~/lib/agreement-templates';

// Minimal DOM: only what the page script touches (text, classes, hidden, children and listeners).
class FakeElement {
  tagName = '';
  className = '';
  hidden = false;
  dataset: Record<string, string> = {};
  handlers = new Map<string, (event: unknown) => unknown>();
  kids: FakeElement[] = [];
  private text = '';
  get textContent(): string {
    return this.kids.length ? this.kids.map(kid => kid.textContent).join('') : this.text;
  }
  set textContent(value: string) { this.kids = []; this.text = value; }
  appendChild(node: FakeElement) { this.kids.push(node); return node; }
  replaceChildren(...nodes: FakeElement[]) { this.kids = nodes; this.text = ''; }
  addEventListener(type: string, handler: (event: unknown) => unknown) { this.handlers.set(type, handler); }
}
const createElement = (tagName: string) => Object.assign(new FakeElement(), { tagName: tagName.toUpperCase() });
const lineDiffExports: Record<string, unknown> = {};
runInNewContext(transpileModule(readFileSync('src/lib/line-diff.ts', 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS } }).outputText, { exports: lineDiffExports });
const pageScript = transpileModule(readFileSync('src/pages/owner/agreements.astro', 'utf8').split('<script>')[1].split('</script>')[0], { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
const owner = { email: 'owner@example.test' };
type TemplateRow = { id: string; kind: 'msa' | 'sow'; version: number; text: string; sha256: string; version_label: string | null; source_revision: string | null; published_at: string };
// Serves the two queries the agreement endpoint makes: the current version of a kind, and one version by number.
const templateDb = (rows: TemplateRow[]) => ({
  prepare: () => ({
    bind: (...args: unknown[]) => ({
      first: async () => rows.filter(row => row.kind === args[0] && (args.length === 1 || row.version === args[1])).sort((a, b) => b.version - a.version)[0] ?? null,
    }),
  }),
});
const endpoint = (db: unknown) => (path: string, init: RequestInit) => POST({
  request: new Request(`https://example.test${path}`, { ...init, headers: { ...init.headers, origin: 'https://example.test' } }),
  locals: { owner, runtime: { env: { MUSIC_DB: db } } },
} as unknown as APIContext);
function previewForm() {
  const status = new FakeElement(), preview = new FakeElement(), diff = Object.assign(new FakeElement(), { hidden: true });
  const form = Object.assign(new FakeElement(), {
    // HTMLFormElement named access returns a RadioNodeList for these two buttons.
    action: { toString: () => '[object RadioNodeList]' },
    getAttribute: (name: string) => name === 'action' ? '/api/owner/agreements' : null,
    hasAttribute: () => false,
    querySelector: (selector: string) => selector === '[role="status"]' ? status : selector === '[data-template-diff]' ? diff : preview,
  });
  return { form, status, preview, diff };
}
function runPage({ form, buttons = [], data = {}, fetch }: { form: FakeElement; buttons?: FakeElement[]; data?: Record<string, string>; fetch: unknown }) {
  runInNewContext(pageScript, {
    document: {
      querySelector: () => ({ addEventListener: () => {} }),
      querySelectorAll: (selector: string) => selector.includes('data-template-version') ? buttons : [form],
      createElement,
    },
    FormData: class { *[Symbol.iterator]() { yield* Object.entries(data); } },
    require: (id: string) => { expect(id).toBe('~/lib/line-diff'); return lineDiffExports; },
    exports: {},
    fetch,
    location: { reload: () => { throw new Error('Preview must remain on the page'); } },
  });
}

it.each(['msa', 'sow'] as const)('renders the %s preview when named action buttons shadow the form endpoint', async kind => {
  const fields = templateFields[kind];
  const text = fields.filter(field => !field.startsWith('milestone.')).map(field => `{{${field}}}`).join('\n')
    + (kind === 'sow' ? '\n{{#milestones}}\n' + fields.filter(field => field.startsWith('milestone.')).map(field => `{{${field}}}`).join('\n') + '\n{{/milestones}}' : '');
  const { form, status, preview, diff } = previewForm();
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    expect(path).toBe('/api/owner/agreements');
    expect(JSON.parse(String(init.body)).action).toBe('preview');
    // No template is published here, so the preview has nothing to compare with.
    return endpoint(templateDb([]))(path, init);
  });
  runPage({ form, fetch, data: { kind, text, expectedCurrentVersion: '1' } });
  await form.handlers.get('submit')!({ preventDefault: () => {}, submitter: { value: 'preview' } });
  expect(fetch).toHaveBeenCalledOnce();
  expect(status.textContent).toBe('');
  expect(preview.textContent).toContain('Sample');
  expect(preview.textContent).not.toMatch(/{{|}}/);
  expect(diff.hidden).toBe(false);
  expect(diff.textContent).toBe('First version. Nothing to compare yet.');
});

it('shows the preview changes from the current version, with unchanged lines collapsed', async () => {
  const body = templateFields.msa.map(field => `{{${field}}}`).join('\n');
  const rows: TemplateRow[] = [{ id: 'msa-1', kind: 'msa', version: 1, text: `Old clause.\n${body}\n`, sha256: 'a'.repeat(64), version_label: 'v2026-09-30', source_revision: null, published_at: '2026-09-30T12:00:00.000Z' }];
  const { form, status, diff } = previewForm();
  const fetch = vi.fn(endpoint(templateDb(rows)));
  runPage({ form, fetch, data: { kind: 'msa', text: `New clause.\n${body}\n`, expectedCurrentVersion: '1' } });
  await form.handlers.get('submit')!({ preventDefault: () => {}, submitter: { value: 'preview' } });
  expect(status.textContent).toBe('');
  expect(diff.hidden).toBe(false);
  const [heading, pre] = diff.kids;
  expect(heading.tagName).toBe('H3');
  expect(heading.textContent).toBe('Changes from v2026-09-30');
  expect(pre.tagName).toBe('PRE');
  expect(pre.className).toBe('template-diff');
  expect(pre.kids.map(line => line.className)).toEqual(['diff-removed', 'diff-added', 'diff-unchanged']);
  expect(pre.textContent).toBe(`- Old clause.\n+ New clause.\n${templateFields.msa.length} unchanged lines\n`);
});

it('fills a version entry with its stored text, or its changes from the previous version, or the server error', async () => {
  const rows: TemplateRow[] = [
    { id: 'msa-1', kind: 'msa', version: 1, text: 'Old clause.\nShared clause.\n', sha256: 'a'.repeat(64), version_label: 'v2026-09-30', source_revision: null, published_at: '2026-09-30T12:00:00.000Z' },
    { id: 'msa-2', kind: 'msa', version: 2, text: 'New clause.\nShared clause.\n', sha256: 'b'.repeat(64), version_label: 'v2026-10-02', source_revision: null, published_at: '2026-10-02T12:00:00.000Z' },
  ];
  const output = new FakeElement();
  const entry = Object.assign(new FakeElement(), { querySelector: (selector: string) => selector === '[data-template-version-output]' ? output : null });
  const button = (view: string, version = '2') => Object.assign(new FakeElement(), { dataset: { kind: 'msa', version, view }, closest: () => entry });
  const viewText = button('text'), compare = button('compare'), missing = button('compare', '9');
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toMatchObject({ action: 'template-version', kind: 'msa' });
    return endpoint(templateDb(rows))(path, init);
  });
  runPage({ form: previewForm().form, buttons: [viewText, compare, missing], fetch });
  await viewText.handlers.get('click')!({});
  expect(output.kids).toHaveLength(1);
  expect(output.kids[0].tagName).toBe('PRE');
  expect(output.textContent).toBe('New clause.\nShared clause.\n');
  await compare.handlers.get('click')!({});
  const [heading, pre] = output.kids;
  expect(heading.tagName).toBe('H3');
  expect(heading.textContent).toBe('Changes from v2026-09-30');
  expect(pre.textContent).toBe('- Old clause.\n+ New clause.\n1 unchanged line\n');
  await missing.handlers.get('click')!({});
  expect(output.textContent).toBe('That version was not found.');
  expect(fetch).toHaveBeenCalledTimes(3);
});
