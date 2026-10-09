import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
class Node extends EventTarget {
  dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; hidden = false; disabled = false;
  name = ''; value = ''; checked = false; type = ''; required = false; maxLength = -1; textContent = ''; placeholder = ''; scrollTop = 0;
  selectionStart = 0; selectionEnd = 0; children: Node[] = []; parentElement!: Node; section!: Node; nodes: Record<string, Node> = {};
  focus = vi.fn();
  getAttribute(key: string) { return key === 'name' ? this.name : this.attrs[key] ?? null; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; } removeAttribute(key: string) { delete this.attrs[key]; }
  appendChild(node: Node) { this.children.push(node); return node; } replaceChildren() { this.children = []; }
  contains(node: Node) { return Object.values(this.nodes).includes(node); }
  closest() { return this.section; }
  querySelector(selector: string): any { return this.nodes[selector] ?? null; }
  querySelectorAll(selector: string): Node[] { return selector === '[data-form-error]' ? Object.entries(this.nodes).filter(([key]) => key.startsWith('[data-form-error=')).map(([, value]) => value) : []; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  checkValidity() { return (!this.required || !!this.value) && (this.type !== 'email' || /.+@.+\..+/.test(this.value)) && (this.type !== 'number' || this.value === '' || Number(this.value) >= 0); }
}
class Input extends Node {} class Textarea extends Node {}
let form: Node & { elements: any }, steps: Node[], controls: Node[], store: Map<string, string>;
const make = (name = '', type = '', value = '') => { const node = new Input(); Object.assign(node, { name, type, value }); return node; };
function fire(node: Node, event: string, props: Record<string, unknown> = {}) { const message = new Event(event, { cancelable: true }); Object.assign(message, props); node.dispatchEvent(message); return message; }
function fill(name: string, value: string) { const node = controls.find(node => node.name === name)!; node.value = value; node.setSelectionRange(value.length, value.length); fire(node, 'input'); fire(form, 'input'); return node; }
function click(selector: string) { fire(form.nodes[selector], 'click'); }
function choose(name: string, value: string) { const node = controls.find(node => node.name === name && node.value === value)!; controls.filter(node => node.name === name).forEach(node => node.checked = node.value === value); const message = new Event('change'); Object.defineProperty(message, 'target', { value: node }); form.dispatchEvent(message); }
const current = () => steps.findIndex(node => !node.hidden);
async function setup() {
  form = new Node() as any; form.dataset.available = 'false'; steps = Array.from({ length: 7 }, () => new Node()); controls = [];
  for (const section of steps) section.nodes.h1 = new Node();
  for (const [index, key] of [[1, 'today'], [2, 'firstResult']] as const) {
    const section = steps[index], box = new Textarea(); box.name = key; box.required = index === 1; box.section = section; controls.push(box);
    for (const selector of ['[data-answer-label]', '[data-question-hint]', '[data-accept]', '[data-suggestions-toggle]', '[data-ghost-prefix]', '[data-ghost-text]']) section.nodes[selector] = new Node();
    section.nodes['[data-ghost-prefix]'].parentElement = new Node();
    section.nodes['[data-answer]'] = box; section.nodes.textarea = box; section.nodes['input, textarea'] = box;
    section.nodes['[data-form-error]'] = new Node();
  }
  controls.push(make('path', 'radio', 'workflow'), make('path', 'radio', 'idea'), make('timing', 'radio', 'flexible'), make('timing', 'radio', 'date'), make('timing', 'radio', 'asap'), make('timingDate', 'date'), make('budgetNote', 'number'), make('name'), make('email', 'email'), make('company'));
  controls.find(node => node.name === 'timing')!.checked = true;
  steps[4].nodes['input, textarea'] = controls.find(node => node.name === 'budgetNote')!;
  for (const key of ['[data-next]', '[data-back]', '[type=submit]', '[data-form-status]', '[data-send-reassurance]', '[data-review]', '[data-date-field]']) form.nodes[key] = new Node();
  form.nodes['button[type="submit"]'] = form.nodes['[type=submit]'];
  const skips = [2, 4].map(i => { const node = new Node(); steps[i].nodes['[data-skip]'] = node; return node; });
  for (const node of controls) { const error = new Node(); error.dataset.formError = node.name; form.nodes[`[data-form-error="${node.name}"]`] = error; }
  form.querySelector = (selector: string): any => {
    const match = selector.match(/^\[data-form-error="(.+)"\]$/);
    if (match && ['today', 'idea', 'firstResult', 'firstVersion'].includes(match[1])) return steps[['today', 'idea'].includes(match[1]) ? 1 : 2].nodes['[data-form-error]'];
    return form.nodes[selector] ?? null;
  };
  form.querySelectorAll = (selector: string) => {
    if (selector === '[data-step]') return steps;
    if (selector === '[data-answer]') return steps.slice(1, 3).map(node => node.nodes['[data-answer]']);
    if (selector === '[data-skip]') return skips;
    if (selector === '[data-suggestions-toggle]') return steps.slice(1, 3).map(node => node.nodes[selector]);
    if (selector === '[data-ghost-prefix], [data-ghost-text]') return steps.slice(1, 3).flatMap(node => [node.nodes['[data-ghost-prefix]'], node.nodes['[data-ghost-text]']]);
    if (selector === '[data-accept]') return steps.slice(1, 3).map(node => node.nodes[selector]);
    if (selector === '[data-form-error]') return Object.entries(form.nodes).filter(([key]) => key.startsWith('[data-form-error=')).map(([, value]) => value);
    const match = selector.match(/^\[name="(.+)"\]$/); return match ? controls.filter(node => node.name === match[1]) : [];
  };
  form.elements = controls; form.elements.namedItem = (key: string) => controls.find(node => node.name === key && node.type !== 'radio');
  vi.stubGlobal('HTMLElement', Node); vi.stubGlobal('HTMLInputElement', Input); vi.stubGlobal('HTMLTextAreaElement', Textarea);
  vi.stubGlobal('FormData', class { get(name: string) { return controls.find(node => node.name === name && !node.disabled && (node.type !== 'radio' || node.checked))?.value ?? null; } });
  vi.stubGlobal('window', {});
  vi.stubGlobal('MutationObserver', class { observe() {} });
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [], getElementById: () => new Node(), createElement: () => new Node(), createTextNode: () => new Node() });
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ suggestion: ' in a spreadsheet' })));
  const { setupSoftwareInquiry } = await import('~/scripts/software-inquiry'); setupSoftwareInquiry(form as any);
}
beforeEach(async () => { store = new Map(); await setup(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('enforces required answers, traverses all questions, Back and individual summary Edit', () => {
  click('[data-next]'); expect(current()).toBe(0); choose('path', 'workflow'); expect(current()).toBe(1);
  click('[data-next]'); expect(current()).toBe(1); fill('today', 'We track clients.'); click('[data-next]'); expect(current()).toBe(2);
  click('[data-back]'); expect(current()).toBe(1); click('[data-next]'); fire(steps[2].nodes['[data-skip]'], 'click'); expect(current()).toBe(3);
  choose('timing', 'date'); click('[data-next]'); expect(current()).toBe(3); fill('timingDate', '2027-01-01'); click('[data-next]'); expect(current()).toBe(4);
  fire(steps[4].nodes['[data-skip]'], 'click'); expect(current()).toBe(5); click('[data-next]'); expect(current()).toBe(5);
  fill('name', 'Alex'); fill('email', 'bad'); click('[data-next]'); expect(current()).toBe(5);
  fill('email', 'alex@example.com'); click('[data-next]'); expect(current()).toBe(6);
  const rows = form.nodes['[data-review]'].children;
  expect(rows.map(node => node.textContent)).toContain('2027-01-01'); expect(rows.map(node => node.textContent).join(' ')).not.toMatch(/First result|Budget|Company/);
  fire(rows[3].children[1], 'click'); expect(current()).toBe(1); expect(steps[1].nodes.h1.focus).toHaveBeenCalled();
});
it('restores untrimmed answers, step and identity and supports keyboard continuation', async () => {
  choose('path', 'idea'); fill('idea', 'An idea with space '); const saved = JSON.parse(store.get('software-brief-draft')!);
  await setup(); expect(current()).toBe(1); expect(controls.find(node => node.name === 'idea')!.value).toBe('An idea with space ');
  fire(form, 'keydown', { ctrlKey: true, key: 'Enter' }); expect(current()).toBe(2);
  expect(JSON.parse(store.get('software-brief-draft')!).submissionId).toBe(saved.submissionId);
});
it('suggests only after a pause and accepts Tab, arrow and the accessible button explicitly', async () => {
  vi.useFakeTimers(); choose('path', 'workflow'); const box = fill('today', 'We track new clients'); const chip = steps[1].nodes['[data-accept]'];
  await vi.advanceTimersByTimeAsync(399); expect(fetch).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
  expect(box.value).toBe('We track new clients'); expect(chip.hidden).toBe(false); expect(chip.attrs['aria-label']).toContain('Add suggestion');
  fire(box, 'keydown', { key: 'Tab', isComposing: false }); expect(box.value).toBe('We track new clients in a spreadsheet');
  await vi.advanceTimersByTimeAsync(400); fire(box, 'keydown', { key: 'ArrowRight' }); expect(box.value).toBe('We track new clients in a spreadsheet in a spreadsheet');
  await vi.advanceTimersByTimeAsync(400); fire(chip, 'click'); expect(box.value).toBe('We track new clients in a spreadsheet in a spreadsheet in a spreadsheet');
});
it('ignores suggestions when typing, moving the cursor or switching questions, and remembers off', async () => {
  vi.useFakeTimers(); choose('path', 'workflow'); const box = fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400);
  fire(box, 'keydown', { key: 'x' }); expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  fill('today', 'We track other clients'); box.selectionStart = 0; fire(box, 'select'); await vi.advanceTimersByTimeAsync(400); expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  fire(steps[1].nodes['[data-suggestions-toggle]'], 'click'); await setup(); expect(steps[1].nodes['[data-suggestions-toggle]'].textContent).toBe('Suggestions off · Turn on');
});
it('never sends contact fields, and only supplies earlier project answers for question three', async () => {
  vi.useFakeTimers(); choose('path', 'workflow'); fill('name', 'Private'); fill('email', 'private@example.com'); fill('company', 'Private'); fill('today', 'We track new clients');
  await vi.advanceTimersByTimeAsync(400); expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ question: 'What happens today?', text: 'We track new clients', earlier: { path: 'workflow' } });
  click('[data-next]'); fill('firstResult', 'A simpler way to'); await vi.advanceTimersByTimeAsync(400);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).earlier).toEqual({ path: 'workflow', today: 'We track new clients' });
});
it('keeps writing with unavailable browser storage', async () => {
  await setup(); vi.stubGlobal('localStorage', { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } }); choose('path', 'workflow'); fill('today', 'We track clients'); click('[data-next]'); expect(current()).toBe(2);
});
it('discloses browser drafts and Workers AI accurately, with reassurance only at send', () => {
  const privacy = readFileSync('src/pages/privacy.astro', 'utf8'); expect(privacy).toContain("isn't used to train models without your explicit consent"); expect(privacy).toContain('You can turn suggestions off'); expect(privacy).toContain('in your browser');
  expect(readFileSync('src/pages/software/start.astro', 'utf8').match(/No booking or payment at this stage\./g)).toHaveLength(1);
});

it('preserves drafts on failed delivery and clears them after a saved receipt', async () => {
  choose('path', 'workflow'); fill('today', 'We track clients'); click('[data-next]'); fire(steps[2].nodes['[data-skip]'], 'click'); click('[data-next]'); fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: 'Try again.' }, { status: 503 }));
  fire(form, 'submit'); await vi.waitFor(() => expect(form.nodes['[data-form-status]'].textContent).toBe('Try again.'));
  expect(store.has('software-brief-draft')).toBe(true);
  vi.stubGlobal('document', { querySelector: () => new Node() });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true, brief: { name: 'Alex', email: 'alex@example.com' }, clientCopyStatus: 'sent' }));
  fire(form, 'submit'); await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(store.has('software-brief-draft')).toBe(false);
});
it('discards a late suggestion after navigation', async () => {
  vi.useFakeTimers(); choose('path', 'workflow');
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400); click('[data-next]');
  resolve(Response.json({ suggestion: ' in a spreadsheet' })); await vi.advanceTimersByTimeAsync(1);
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(true); expect(current()).toBe(2);
});
