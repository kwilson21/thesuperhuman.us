import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('~/scripts/brief-suggestion-pass', () => ({ setupSuggestionPass: () => async () => true }));
class Node extends EventTarget {
  dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; hidden = false; disabled = false;
  name = ''; value = ''; checked = false; type = ''; required = false; maxLength = -1; textContent = ''; placeholder = ''; scrollTop = 0; style = { height: '' }; offsetHeight = 200; clientHeight = 198; scrollHeight = 198;
  selectionStart = 0; selectionEnd = 0; children: Node[] = []; parentElement!: Node; section!: Node; nodes: Record<string, Node> = {}; inputs: Node[] = [];
  focus = vi.fn();
  getAttribute(key: string) { return key === 'name' ? this.name : this.attrs[key] ?? null; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; } removeAttribute(key: string) { delete this.attrs[key]; }
  appendChild(node: Node) { this.children.push(node); return node; } replaceChildren() { this.children = []; }
  contains(node: Node) { return Object.values(this.nodes).includes(node); }
  closest() { return this.section; }
  querySelector(selector: string): any { return this.nodes[selector] ?? null; }
  querySelectorAll(selector: string): Node[] {
    if (selector === 'input, textarea') return this.inputs;
    return selector === '[data-form-error]' ? Object.entries(this.nodes).filter(([key]) => key.startsWith('[data-form-error=')).map(([, value]) => value) : [];
  }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  checkValidity() { return (!this.required || !!this.value) && (this.type !== 'email' || /.+@.+\..+/.test(this.value)) && (this.type !== 'number' || this.value === '' || Number(this.value) >= 0); }
}
class Input extends Node {} class Textarea extends Node {}
let form: Node & { elements: any }, steps: Node[], controls: Node[], store: Map<string, string>, dots: Node[], kicker: Node;
const make = (name = '', type = '', value = '') => { const node = new Input(); Object.assign(node, { name, type, value }); return node; };
function fire(node: Node, event: string, props: Record<string, unknown> = {}) { const message = new Event(event, { cancelable: true }); Object.assign(message, props); node.dispatchEvent(message); return message; }
function fill(name: string, value: string) { const node = controls.find(node => node.name === name)!; node.value = value; node.setSelectionRange(value.length, value.length); fire(node, 'input'); fire(form, 'input'); return node; }
const field = (name: string) => controls.find(node => node.name === name)!;
function click(selector: string) { fire(form.nodes[selector], 'click'); }
function choose(name: string, value: string) { const node = controls.find(node => node.name === name && node.value === value)!; controls.filter(node => node.name === name).forEach(node => node.checked = node.value === value); fire(form, 'input'); const message = new Event('change'); Object.defineProperty(message, 'target', { value: node }); form.dispatchEvent(message); }
const current = () => steps.findIndex(node => !node.hidden);
const backToStart = () => { while (current() > 0) click('[data-back]'); };
const visibleDots = () => dots.map(item => item.hidden);
async function setup(requestedPath?: string) {
  form = new Node() as any; form.dataset.available = 'false'; steps = Array.from({ length: 9 }, () => new Node()); controls = [];
  for (const section of steps) section.nodes.h1 = new Node();
  for (const index of [1, 2]) {
    const section = steps[index], box = new Textarea(); box.name = ''; box.required = index === 1; box.section = section; controls.push(box);
    for (const selector of ['[data-accept-hint]', '[data-answer-label]', '[data-question-hint]', '[data-question-footnote]', '[data-accept]', '[data-suggestions-toggle]', '[data-suggestions-disclosure]', '[data-suggestions-off]', '[data-ghost-prefix]', '[data-ghost-text]']) section.nodes[selector] = new Node();
    section.nodes['[data-ghost-prefix]'].parentElement = new Node();
    section.nodes['[data-answer]'] = box; section.nodes.textarea = box; section.inputs = [box];
    section.nodes['[data-form-error]'] = new Node();
  }
  // Website-only screens: the link and notes (no suggestions) and who keeps it up to date.
  const website = steps[7], currentUrl = make('currentUrl', 'url'), existing = new Textarea(); existing.name = 'existing';
  const updates = ['self', 'help', 'unsure'].map(value => make('updates', 'radio', value));
  website.inputs = [currentUrl, existing]; steps[8].inputs = updates;
  controls.push(make('path', 'radio', 'website'), make('path', 'radio', 'webapp'), make('path', 'radio', 'workflow'), make('timing', 'radio', 'flexible'), make('timing', 'radio', 'date'), make('timing', 'radio', 'asap'), make('timingDate', 'date'), make('budgetNote', 'number'), make('name'), make('email', 'email'), make('company'), currentUrl, existing, ...updates);
  controls.find(node => node.name === 'timing')!.checked = true;
  controls.filter(node => node.name === 'path').forEach(node => node.checked = node.value === requestedPath);
  steps[4].inputs = [controls.find(node => node.name === 'budgetNote')!];
  for (const key of ['[data-next]', '[data-back]', '[type=submit]', '[data-form-status]', '[data-send-reassurance]', '[data-review]', '[data-date-field]', '[data-timing-hint]']) form.nodes[key] = new Node();
  form.nodes['button[type="submit"]'] = form.nodes['[type=submit]'];
  const skips = [2, 4, 7].map(i => { const node = new Node(); steps[i].nodes['[data-skip]'] = node; return node; });
  for (const node of controls) { const error = new Node(); error.dataset.formError = node.name; form.nodes[`[data-form-error="${node.name}"]`] = error; }
  form.querySelector = (selector: string): any => {
    // A question's error paragraph follows the question it is configured for.
    const match = selector.match(/^\[data-form-error="(.+)"\]$/);
    const remapped = match ? steps.map(node => node.nodes['[data-form-error]']).find(error => error?.dataset.formError === match[1]) : undefined;
    return remapped ?? form.nodes[selector] ?? null;
  };
  form.querySelectorAll = (selector: string) => {
    if (selector === 'input, textarea, button') return [...controls, form.nodes['[data-back]'], form.nodes['[data-next]'], form.nodes['[type=submit]'], ...skips, ...form.nodes['[data-review]'].children.flatMap(node => node.children).filter(node => node.type === 'button')];
    if (selector === '[data-step]') return steps;
    if (selector === '[data-answer]') return steps.slice(1, 3).map(node => node.nodes['[data-answer]']);
    if (selector === '[data-skip]') return skips;
    if (['[data-suggestions-toggle]', '[data-suggestions-disclosure]', '[data-suggestions-off]'].includes(selector)) return steps.slice(1, 3).map(node => node.nodes[selector]);
    if (selector === '[data-ghost-prefix], [data-ghost-text]') return steps.slice(1, 3).flatMap(node => [node.nodes['[data-ghost-prefix]'], node.nodes['[data-ghost-text]']]);
    if (selector === '[data-accept]' || selector === '[data-accept-hint]') return steps.slice(1, 3).map(node => node.nodes[selector]);
    if (selector === '[data-form-error]') return Object.entries(form.nodes).filter(([key]) => key.startsWith('[data-form-error=')).map(([, value]) => value);
    const match = selector.match(/^\[name="(.+)"\]$/); return match ? controls.filter(node => node.name === match[1]) : [];
  };
  form.elements = controls; form.elements.namedItem = (key: string) => controls.find(node => node.name === key && node.type !== 'radio');
  vi.stubGlobal('HTMLElement', Node); vi.stubGlobal('HTMLInputElement', Input); vi.stubGlobal('HTMLTextAreaElement', Textarea);
  vi.stubGlobal('FormData', class { get(name: string) { return controls.find(node => node.name === name && !node.disabled && (node.type !== 'radio' || node.checked))?.value ?? null; } });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('MutationObserver', class { observe() {} });
  // The progress dots mirror the page: eight items, each with a visually hidden label.
  dots = Array.from({ length: 8 }, () => { const item = new Node(); item.nodes['.sr-only'] = new Node(); return item; });
  kicker = new Node();
  vi.stubGlobal('document', { querySelector: (selector: string) => selector === '[data-brief-kicker]' ? kicker : null, querySelectorAll: (selector: string) => selector === '.intake-progress li' ? dots : [], getElementById: () => new Node(), createElement: () => new Node(), createTextNode: () => new Node() });
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ suggestion: ' in a spreadsheet' })));
  const { setupSoftwareInquiry } = await import('~/scripts/software-inquiry'); setupSoftwareInquiry(form as any);
}
// Every flow can schedule suggestions; keep old forms from calling the next test's fetch.
beforeEach(async () => { vi.useFakeTimers(); store = new Map(); await setup(); });
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
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
  choose('path', 'webapp'); fill('appGoal', 'An idea with space '); const saved = JSON.parse(store.get('software-brief-draft')!);
  await setup(); expect(current()).toBe(1); expect(field('appGoal').value).toBe('An idea with space ');
  fire(form, 'keydown', { ctrlKey: true, key: 'Enter' }); expect(current()).toBe(2);
  expect(JSON.parse(store.get('software-brief-draft')!).submissionId).toBe(saved.submissionId);
});
it('suggests only after a pause and accepts Tab, arrow and the accessible button explicitly', async () => {
  vi.useFakeTimers(); choose('path', 'workflow'); const box = fill('today', 'We track new clients'); const chip = steps[1].nodes['[data-accept]'];
  await vi.advanceTimersByTimeAsync(399); expect(fetch).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
  expect(box.value).toBe('We track new clients'); expect(chip.hidden).toBe(false); expect(chip.attrs['aria-label']).toBe('Add suggestion: in a spreadsheet');
  expect(fire(box, 'keydown', { key: 'Tab', isComposing: false }).defaultPrevented).toBe(true); expect(box.value).toBe('We track new clients in a spreadsheet');
  await vi.advanceTimersByTimeAsync(400); fire(box, 'keydown', { key: 'ArrowRight' }); expect(box.value).toBe('We track new clients in a spreadsheet in a spreadsheet');
  await vi.advanceTimersByTimeAsync(400); fire(chip, 'click'); expect(box.value).toBe('We track new clients in a spreadsheet in a spreadsheet in a spreadsheet');
});
it('ignores suggestions when typing, moving the cursor or switching questions, and remembers off', async () => {
  vi.useFakeTimers(); choose('path', 'workflow'); const box = fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400);
  fire(box, 'keydown', { key: 'x' }); expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  fill('today', 'We track other clients'); box.selectionStart = 0; fire(box, 'select'); await vi.advanceTimersByTimeAsync(400); expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  fire(steps[1].nodes['[data-suggestions-toggle]'], 'click');
  expect(steps[1].nodes['[data-suggestions-disclosure]'].hidden).toBe(true);
  expect(steps[1].nodes['[data-suggestions-off]'].hidden).toBe(false);
  await setup(); expect(steps[1].nodes['[data-suggestions-toggle]'].textContent).toBe('Turn on');
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
  const privacy = readFileSync('src/pages/privacy.astro', 'utf8');
  for (const sentence of [
    "isn't used to train models without your explicit consent",
    'The name, email and company fields are never sent for suggestions.',
    'Neither are a website brief’s link and notes on what you already have, which show no suggestions.',
    'Anything you type in an answer box is sent for suggestions.',
    'You can turn suggestions off', 'in your browser', 'strictly necessary security cookie that expires after 30 minutes',
    'Updated October 19, 2026', 'kept for up to two days',
    'Project brief suggestions use', 'While you write a project brief,',
    'Project briefs, including website briefs, include the project answers you enter, an optional link to your current website, your name, email and optional company, and the timing and optional budget you choose to share. I use them to review your project, including any current site you link to, and reply to you.',
  ]) expect(privacy).toContain(sentence);
  expect(privacy).not.toContain('Software brief suggestions use'); expect(privacy).not.toContain('While you write a software brief'); expect(privacy).not.toContain('Updated October 10, 2026'); expect(privacy).not.toContain('approximate counter');
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

it('preserves both paths across switching and refresh, but sends only the selected answers', async () => {
  choose('path', 'workflow'); fill('today', 'Workflow writing '); fill('firstResult', 'Workflow result');
  choose('path', 'webapp'); expect(field('appGoal').value).toBe('');
  fill('appGoal', 'Web app writing '); fill('firstVersion', 'Web app version');
  await setup(); choose('path', 'workflow');
  expect(field('today').value).toBe('Workflow writing ');
  expect(field('firstResult').value).toBe('Workflow result');
  choose('path', 'webapp'); expect(field('appGoal').value).toBe('Web app writing ');
  expect(field('firstVersion').value).toBe('Web app version');
  click('[data-next]'); click('[data-next]'); click('[data-next]'); click('[data-next]');
  fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  fire(form, 'submit');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.appGoal).toBe('Web app writing'); expect(body.firstVersion).toBe('Web app version');
  expect(body).not.toHaveProperty('today'); expect(body).not.toHaveProperty('firstResult');
});
it.each(['storage', 'submit'])('notices a sent draft through %s before sending with a new identity', async trigger => {
  choose('path', 'workflow'); fill('today', 'We track clients');
  const oldId = JSON.parse(store.get('software-brief-draft')!).submissionId;
  click('[data-next]'); fire(steps[2].nodes['[data-skip]'], 'click'); click('[data-next]');
  fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  store.set('software-brief-sent', oldId); store.delete('software-brief-draft');
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  if (trigger === 'storage') window.dispatchEvent(Object.assign(new Event('storage'), { key: 'software-brief-sent' }));
  else fire(form, 'submit');
  expect(fetch).not.toHaveBeenCalled();
  expect(form.nodes['[data-form-status]'].textContent).toBe('This brief was already sent from another tab. Your changes here will be sent as a new brief.');
  fire(form, 'submit'); await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).submissionId).not.toBe(oldId);
});

it('keeps the sent identity stable if another tab finishes while delivery is pending', async () => {
  choose('path', 'workflow'); fill('today', 'We track clients');
  click('[data-next]'); fire(steps[2].nodes['[data-skip]'], 'click'); click('[data-next]');
  fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  const sentId = JSON.parse(store.get('software-brief-draft')!).submissionId;
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fire(form, 'submit');
  store.set('software-brief-sent', sentId);
  window.dispatchEvent(Object.assign(new Event('storage'), { key: 'software-brief-sent' }));
  expect(JSON.parse(store.get('software-brief-draft')!).submissionId).toBe(sentId);
  vi.stubGlobal('document', { querySelector: () => new Node() });
  resolve(Response.json({ ok: true, brief: { name: 'Alex', email: 'alex@example.com' }, clientCopyStatus: 'sent' }));
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(store.get('software-brief-sent')).toBe(sentId);
});

it.each(['different', 'invalid', 'missing'])('preserves a %s saved draft when delivery succeeds', async draft => {
  choose('path', 'workflow'); fill('today', 'We track clients');
  click('[data-next]'); fire(steps[2].nodes['[data-skip]'], 'click'); click('[data-next]');
  fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  const sentId = JSON.parse(store.get('software-brief-draft')!).submissionId;
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fire(form, 'submit');
  const saved = draft === 'different' ? JSON.stringify({ answers: { today: 'Another tab writing' }, step: 1, submissionId: crypto.randomUUID() }) : draft === 'invalid' ? '{' : undefined;
  if (saved !== undefined) store.set('software-brief-draft', saved); else store.delete('software-brief-draft');
  vi.stubGlobal('document', { querySelector: () => new Node() });
  resolve(Response.json({ ok: true, brief: { name: 'Alex', email: 'alex@example.com' }, clientCopyStatus: 'sent' }));
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(store.get('software-brief-draft')).toBe(saved);
  expect(store.get('software-brief-sent')).toBe(sentId);
});

it('offers no suggestion when the silent pass requires interaction', async () => {
  const mock = vi.spyOn(await import('~/scripts/brief-suggestion-pass'), 'setupSuggestionPass').mockReturnValue(async () => false);
  await setup(); vi.useFakeTimers(); choose('path', 'workflow'); fill('today', 'We track new clients');
  await vi.advanceTimersByTimeAsync(400);
  expect(fetch).not.toHaveBeenCalled(); expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  mock.mockRestore();
});


it('renews an expired pass once and retries the current suggestion', async () => {
  const pass = vi.fn(async (_renew = false) => true);
  const mock = vi.spyOn(await import('~/scripts/brief-suggestion-pass'), 'setupSuggestionPass').mockReturnValue(pass);
  await setup(); vi.useFakeTimers(); choose('path', 'workflow');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ suggestion: '', passRequired: true }));
  fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400);
  expect(pass.mock.calls.filter(args => args[0] === true)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(false);
  mock.mockRestore();
});
it('allows a later suggestion after typing cancels a successfully renewed retry', async () => {
  const pass = vi.fn(async (_renew = false) => true);
  const mock = vi.spyOn(await import('~/scripts/brief-suggestion-pass'), 'setupSuggestionPass').mockReturnValue(pass);
  await setup(); vi.useFakeTimers(); choose('path', 'workflow');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ suggestion: '', passRequired: true }))
    .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
  fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400);
  expect(fetch).toHaveBeenCalledTimes(2);
  fill('today', 'We track other clients'); await vi.advanceTimersByTimeAsync(400);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(pass.mock.calls.filter(args => args[0] === true)).toHaveLength(1);
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(false);
  mock.mockRestore();
});
it.each(['check fails', 'retry still expired', 'retry throws'])('stays silent for the page after renewal: %s', async failure => {
  const pass = vi.fn(async (renew = false) => !renew || failure !== 'check fails');
  const mock = vi.spyOn(await import('~/scripts/brief-suggestion-pass'), 'setupSuggestionPass').mockReturnValue(pass);
  await setup(); vi.useFakeTimers(); choose('path', 'workflow');
  vi.mocked(fetch).mockImplementation(async () => Response.json({ suggestion: '', passRequired: true }));
  if (failure === 'retry throws') vi.mocked(fetch).mockResolvedValueOnce(Response.json({ suggestion: '', passRequired: true })).mockRejectedValueOnce(new Error('unavailable'));
  fill('today', 'We track new clients'); await vi.advanceTimersByTimeAsync(400);
  const calls = vi.mocked(fetch).mock.calls.length;
  fill('today', 'We track other clients'); await vi.advanceTimersByTimeAsync(400);
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(pass.mock.calls.filter(args => args[0] === true)).toHaveLength(1);
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  expect(form.nodes['[data-form-status]'].textContent).toBe('');
  mock.mockRestore();
});

it('accepts taps only on ghost text and updates the hint for touch and keyboard', async () => {
  choose('path', 'workflow');
  fire(form, 'pointerdown', { pointerType: 'touch' });
  fire(steps[1].nodes['[data-answer]'], 'keydown', { key: 'Unidentified', keyCode: 229 });
  const box = fill('today', 'We track new clients');
  await vi.advanceTimersByTimeAsync(400);
  const hint = steps[1].nodes['[data-accept-hint]'], ghost = steps[1].nodes['[data-ghost-text]'];
  expect(hint.hidden).toBe(false); expect(hint.textContent).toBe('Tap to accept');
  fire(box, 'click'); expect(box.value).toBe('We track new clients');
  expect(fire(ghost, 'pointerdown').defaultPrevented).toBe(true);
  fire(ghost, 'click'); expect(box.value).toBe('We track new clients in a spreadsheet');
  expect(hint.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(400);
  fire(box, 'keydown', { key: 'Shift' });
  expect(hint.textContent).toBe('Tab to accept'); expect(hint.hidden).toBe(true);
});
it('keeps the decorative mirror on phones and the accessible accept control visually hidden', () => {
  const page = readFileSync('src/pages/software/start.astro', 'utf8');
  const css = readFileSync('src/styles/software-intake.css', 'utf8');
  expect(page).toContain('class="sr-only" data-accept hidden');
  expect(page).toContain('class="brief-ghost" aria-hidden="true"');
  expect(css).toContain('[data-ghost-text]{pointer-events:auto');
  expect(css).toContain('pointer-events:none;z-index:1');
  expect(css).not.toContain('.brief-ghost{visibility:hidden}');
  expect(readFileSync('src/scripts/brief-autocomplete.ts', 'utf8')).not.toContain('Use:');
});

it('leaves normal Tab navigation alone without a suggestion or with a selection', async () => {
  choose('path', 'workflow'); const box = fill('today', 'We track new clients');
  expect(fire(box, 'keydown', { key: 'Tab' }).defaultPrevented).toBe(false);
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(400);
  box.selectionStart = 0;
  expect(fire(box, 'keydown', { key: 'ArrowRight' }).defaultPrevented).toBe(false);
  expect(box.value).toBe('We track new clients');
  expect(steps[1].nodes['[data-accept-hint]'].hidden).toBe(true);
});

it.each(['webapp', 'workflow'])('explicit %s entry restores its answers at the first question over another saved path', async requested => {
  choose('path', 'workflow'); fill('today', 'Workflow answer'); fill('firstResult', 'Workflow result');
  choose('path', 'webapp'); fill('appGoal', 'Web app answer'); fill('firstVersion', 'Web app version');
  choose('path', requested === 'webapp' ? 'workflow' : 'webapp');
  click('[data-next]'); click('[data-next]');
  await setup(requested);
  expect(current()).toBe(1);
  expect(controls.find(node => node.name === 'path' && node.checked)!.value).toBe(requested);
  expect(steps[1].nodes['[data-answer]'].value).toBe(requested === 'webapp' ? 'Web app answer' : 'Workflow answer');
  expect(steps[2].nodes['[data-answer]'].value).toBe(requested === 'webapp' ? 'Web app version' : 'Workflow result');
});
it('opens an explicit path at its first question with no draft', async () => {
  await setup('webapp'); expect(current()).toBe(1);
});
it('clears remapped question errors and invalid markers when switching paths', () => {
  choose('path', 'webapp'); click('[data-next]');
  expect(steps[1].nodes['[data-form-error]'].hidden).toBe(false);
  expect(steps[1].nodes['[data-answer]'].getAttribute('aria-invalid')).toBe('true');
  click('[data-back]'); choose('path', 'workflow');
  expect(steps[1].nodes['[data-form-error]'].hidden).toBe(true);
  expect(steps[1].nodes['[data-form-error]'].textContent).toBe('');
  expect(steps[1].nodes['[data-answer]'].getAttribute('aria-invalid')).toBeNull();
});
it('grows the answer to fit typed text and the tappable suggestion without scrolling', async () => {
  choose('path', 'workflow'); const box = fill('today', 'We track new clients');
  const overlay = steps[1].nodes['[data-ghost-prefix]'].parentElement;
  box.scrollHeight = 300; overlay.scrollHeight = 360;
  await vi.advanceTimersByTimeAsync(400);
  expect(box.style.height).toBe('362px');
  fire(box, 'keydown', { key: 'x' });
  expect(box.style.height).toBe('362px');
  const css = readFileSync('src/styles/software-intake.css', 'utf8');
  expect(css).toMatch(/brief-answer textarea\{[^}]*overflow:hidden/);
  expect(css).not.toContain('scrollbar-gutter');
});
it.each(['webapp', 'workflow'])('refresh of the same explicit %s path restores the saved step', async requested => {
  choose('path', requested); fill(requested === 'webapp' ? 'appGoal' : 'today', 'A saved answer');
  click('[data-next]'); click('[data-next]');
  await setup(requested); expect(current()).toBe(3);
});

function modelAnswerHeight(box: Node) {
  Object.defineProperty(box, 'offsetHeight', { get: () => parseFloat(box.style.height) || 200 });
  Object.defineProperty(box, 'clientHeight', { get: () => box.offsetHeight - 2 });
  Object.defineProperty(box, 'scrollHeight', { get: () => Math.max(box.clientHeight, box.value.length > 100 ? 300 : 100) });
}
it('shrinks a grown answer after deletion while keeping the six-row minimum', () => {
  choose('path', 'workflow'); const box = steps[1].nodes['[data-answer]'];
  modelAnswerHeight(box);
  fill('today', 'Long answer '.repeat(20)); expect(box.style.height).toBe('302px');
  fill('today', 'Short'); expect(box.style.height).toBe('200px');
  fill('today', ''); expect(box.style.height).toBe('200px');
  expect(readFileSync('src/pages/software/start.astro', 'utf8')).toContain('rows="6" data-answer');
});
it('shrinks the reused answer box when switching to a shorter answer', () => {
  choose('path', 'workflow'); const box = steps[1].nodes['[data-answer]'];
  modelAnswerHeight(box);
  fill('today', 'Long answer '.repeat(20)); expect(box.style.height).toBe('302px');
  click('[data-back]'); choose('path', 'webapp'); fill('appGoal', 'Short');
  click('[data-back]'); choose('path', 'workflow'); expect(box.style.height).toBe('302px');
  click('[data-back]'); choose('path', 'webapp');
  expect(box.value).toBe('Short'); expect(box.style.height).toBe('200px');
});
it('fits the full suggestion after a grown answer shrinks', async () => {
  choose('path', 'workflow'); const box = steps[1].nodes['[data-answer]'];
  modelAnswerHeight(box);
  fill('today', 'Long answer '.repeat(20)); expect(box.style.height).toBe('302px');
  fill('today', 'We track new clients'); expect(box.style.height).toBe('200px');
  steps[1].nodes['[data-ghost-prefix]'].parentElement.scrollHeight = 260;
  await vi.advanceTimersByTimeAsync(400);
  expect(box.style.height).toBe('262px');
  expect(steps[1].nodes['[data-ghost-text]'].textContent).toBe(' in a spreadsheet');
  expect(steps[1].nodes['[data-accept]'].hidden).toBe(false);
});

it.each(['flexible', 'asap'])('clears a rejected date immediately when timing changes to %s', timing => {
  choose('path', 'workflow'); fill('today', 'We track clients'); click('[data-next]');
  fire(steps[2].nodes['[data-skip]'], 'click'); choose('timing', 'date'); click('[data-next]');
  const date = controls.find(node => node.name === 'timingDate')!;
  const error = form.nodes['[data-form-error="timingDate"]'];
  expect(error.textContent).toBe('Add a valid date.'); expect(date.getAttribute('aria-invalid')).toBe('true');
  expect(form.nodes['[data-form-status]'].textContent).toBe('Please check the highlighted fields.');
  choose('timing', timing);
  expect(error.textContent).toBe(''); expect(error.hidden).toBe(true);
  expect(date.getAttribute('aria-invalid')).toBeNull(); expect(form.nodes['[data-form-status]'].textContent).toBe('');
  choose('timing', 'date'); expect(error.hidden).toBe(true);
});

it.each(['success', 'server failure', 'network failure'])('locks editing during delivery and restores controls after %s', async outcome => {
  choose('path', 'workflow'); fill('today', 'We track clients'); click('[data-next]');
  fire(steps[2].nodes['[data-skip]'], 'click'); click('[data-next]');
  fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  const edits = form.nodes['[data-review]'].children.flatMap(node => node.children).filter(node => node.type === 'button');
  const company = controls.find(node => node.name === 'company')!; company.disabled = true;
  let resolve!: (response: Response) => void, reject!: (error: Error) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const draft = store.get('software-brief-draft');
  fire(form, 'submit');
  expect(form.nodes['[data-back]'].disabled).toBe(true);
  expect(edits.length).toBeGreaterThan(0); expect(edits.every(node => node.disabled)).toBe(true);
  expect(controls.every(node => node.disabled)).toBe(true);
  expect(form.nodes['[type=submit]'].disabled).toBe(true);
  expect(form.nodes['[type=submit]'].textContent).toBe('Sending…');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).today).toBe('We track clients');
  expect(store.get('software-brief-draft')).toBe(draft);
  vi.stubGlobal('document', { querySelector: () => new Node(), querySelectorAll: () => [] });
  if (outcome === 'network failure') reject(new Error('offline'));
  else resolve(Response.json(outcome === 'success' ? { ok: true, brief: { name: 'Alex', email: 'alex@example.com' } } : { ok: false, error: 'Try again.' }, { status: outcome === 'success' ? 200 : 503 }));
  await vi.waitFor(() => expect(form.getAttribute('aria-busy')).toBeNull());
  expect(form.nodes['[data-back]'].disabled).toBe(false);
  expect(edits.every(node => !node.disabled)).toBe(true);
  expect(controls.filter(node => node !== company).every(node => !node.disabled)).toBe(true);
  expect(company.disabled).toBe(true);
  if (outcome === 'success') { expect(form.hidden).toBe(true); expect(store.has('software-brief-draft')).toBe(false); }
  else {
    expect(form.hidden).toBe(false); expect(store.get('software-brief-draft')).toBe(draft);
    fire(edits[0], 'click'); expect(current()).toBe(0);
    click('[data-next]'); fill('today', 'Corrected answer');
    expect(JSON.parse(store.get('software-brief-draft')!).answers.today).toBe('Corrected answer');
  }
});

// Website and web app briefs.
it('starts a project brief on its first screen and labels it as a project brief', () => {
  expect(kicker.textContent).toBe('Project brief'); expect(visibleDots()).toEqual([false, false, false, false, false, false, false, true]);
});
it('walks a website brief through its own screens, the link and notes, updates, timing and review', () => {
  choose('path', 'website');
  expect(kicker.textContent).toBe('Website brief'); expect(visibleDots()).toEqual(Array(8).fill(false));
  expect(dots[0].nodes['.sr-only'].textContent).toBe('Question 1 of 8'); expect(dots[1].attrs['aria-current']).toBe('step'); expect(dots[0].attrs['aria-current']).toBeUndefined();
  expect(current()).toBe(1);
  expect(steps[1].nodes.h1.textContent).toBe("What's the website for?");
  expect(steps[1].nodes['[data-question-footnote]'].textContent).toBe('Plain language is fine. We’ll work out the design and technical details together. Please leave out passwords and access details.');
  click('[data-next]'); expect(current()).toBe(1);
  expect(steps[1].nodes['[data-form-error]'].textContent).toBe('This answer is required.');
  fill('purpose', 'A site for my pottery studio.'); click('[data-next]'); expect(current()).toBe(7);
  expect(dots[2].attrs['aria-current']).toBe('step'); expect(dots[2].nodes['.sr-only'].textContent).toBe('Question 3 of 8');
  fill('currentUrl', 'yourstudio.com'); click('[data-next]'); expect(current()).toBe(7);
  expect(form.nodes['[data-form-error="currentUrl"]'].textContent).toBe('Start the link with https:// or http://.');
  fill('currentUrl', 'https://yourstudio.com'); fill('existing', 'A logo and about 30 class photos.'); click('[data-next]'); expect(current()).toBe(8);
  click('[data-next]'); expect(current()).toBe(8);
  expect(form.nodes['[data-form-error="updates"]'].textContent).toBe('Choose one.');
  choose('updates', 'self'); click('[data-next]'); expect(current()).toBe(3);
  expect(form.nodes['[data-timing-hint]'].hidden).toBe(false);
  click('[data-next]'); expect(current()).toBe(4);
  fire(steps[4].nodes['[data-skip]'], 'click'); expect(current()).toBe(5);
  fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]'); expect(current()).toBe(6);
  const rows = form.nodes['[data-review]'].children;
  const text = rows.map(node => node.textContent).join(' ');
  expect(text).toContain('Website design'); expect(text).toContain('Me or someone on my team'); expect(text).toContain('What you already have');
  const edit = rows.flatMap(node => node.children).find(node => node.attrs['aria-label'] === 'Edit Current website')!;
  fire(edit, 'click'); expect(current()).toBe(7); expect(steps[7].nodes.h1.focus).toHaveBeenCalled();
});
it('skips the website link and notes together and moves on to who keeps it up to date', () => {
  choose('path', 'website'); fill('purpose', 'A site for my pottery studio.'); click('[data-next]');
  fill('currentUrl', 'https://yourstudio.com'); fill('existing', 'A logo.');
  fire(steps[7].nodes['[data-skip]'], 'click');
  expect(current()).toBe(8);
  expect(field('currentUrl').value).toBe(''); expect(field('existing').value).toBe('');
});
it('sends only the answers for the chosen path, website answers for a website brief', async () => {
  choose('path', 'website'); fill('purpose', 'A site for my pottery studio.'); click('[data-next]');
  fill('currentUrl', 'https://yourstudio.com'); fill('existing', 'A logo.'); click('[data-next]');
  choose('updates', 'self'); click('[data-next]'); click('[data-next]');
  fire(steps[4].nodes['[data-skip]'], 'click'); fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]');
  expect(current()).toBe(6);
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  fire(form, 'submit');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ path: 'website', purpose: 'A site for my pottery studio.', currentUrl: 'https://yourstudio.com', existing: 'A logo.', updates: 'self' });
  for (const key of ['today', 'firstResult', 'appGoal', 'firstVersion', 'idea']) expect(body).not.toHaveProperty(key);
});
it('sends no website answers for a workflow brief, even after website answers were typed', async () => {
  choose('path', 'website'); fill('purpose', 'A site for my pottery studio.'); fill('currentUrl', 'https://yourstudio.com'); fill('existing', 'A logo.');
  backToStart(); choose('path', 'workflow'); expect(current()).toBe(1);
  fill('today', 'We track clients in a spreadsheet.'); click('[data-next]'); expect(current()).toBe(2);
  fire(steps[2].nodes['[data-skip]'], 'click'); expect(current()).toBe(3);
  click('[data-next]'); fire(steps[4].nodes['[data-skip]'], 'click');
  fill('name', 'Alex'); fill('email', 'alex@example.com'); click('[data-next]'); expect(current()).toBe(6);
  form.dataset.available = 'true'; form.nodes['[type=submit]'].disabled = false;
  fire(form, 'submit');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ path: 'workflow', today: 'We track clients in a spreadsheet.' });
  for (const key of ['purpose', 'currentUrl', 'existing', 'updates', 'appGoal', 'firstVersion']) expect(body).not.toHaveProperty(key);
});
it('keeps website-only answers through a path switch and a refresh', async () => {
  choose('path', 'website'); fill('purpose', 'A site for my pottery studio.'); click('[data-next]');
  fill('currentUrl', 'https://yourstudio.com'); fill('existing', 'A logo.'); click('[data-next]'); choose('updates', 'help');
  backToStart(); choose('path', 'workflow'); backToStart(); choose('path', 'website');
  expect(field('purpose').value).toBe('A site for my pottery studio.');
  expect(field('currentUrl').value).toBe('https://yourstudio.com'); expect(field('existing').value).toBe('A logo.');
  expect(controls.find(node => node.name === 'updates' && node.checked)!.value).toBe('help');
  await setup();
  expect(controls.find(node => node.name === 'path' && node.checked)!.value).toBe('website');
  expect(field('purpose').value).toBe('A site for my pottery studio.');
  expect(field('currentUrl').value).toBe('https://yourstudio.com'); expect(field('existing').value).toBe('A logo.');
  expect(controls.find(node => node.name === 'updates' && node.checked)!.value).toBe('help');
});
it('shows the web app brief with seven screens, its own first question and no timing hint', () => {
  choose('path', 'webapp');
  expect(kicker.textContent).toBe('Web app brief'); expect(visibleDots()).toEqual([false, false, false, false, false, false, false, true]);
  expect(dots[0].nodes['.sr-only'].textContent).toBe('Question 1 of 7');
  expect(steps[1].nodes.h1.textContent).toBe('What should the app let people do?');
  expect(steps[1].nodes['[data-question-footnote]'].textContent).toBe('Plain language is fine. We’ll work out the technical details together. Please leave out passwords, access details and real customer data.');
  fill('appGoal', 'Let my students book and pay for lessons.'); click('[data-next]'); expect(current()).toBe(2);
  expect(steps[2].nodes.h1.textContent).toBe('Have a first version in mind?');
  click('[data-next]'); expect(current()).toBe(3);
  expect(form.nodes['[data-timing-hint]'].hidden).toBe(true);
});
it('restores an old idea draft as a web app brief with its idea as the first answer', async () => {
  store.set('software-brief-draft', JSON.stringify({ answers: { path: 'idea', idea: 'Old idea text' }, step: 1 }));
  await setup();
  expect(controls.find(node => node.name === 'path' && node.checked)!.value).toBe('webapp');
  expect(field('appGoal').value).toBe('Old idea text');
  expect(current()).toBe(1); expect(kicker.textContent).toBe('Web app brief');
});
it.each([
  ['website', "I'll look at what you have and reply with a fixed-price first milestone, or a question or two."],
  ['workflow', 'I reply with a fixed-price first milestone, or a question or two.'],
])('sets the receipt first step for a %s brief', async (path, line) => {
  const firstStep = new Node(); firstStep.textContent = 'I reply with a fixed-price first milestone, or a question or two.';
  vi.stubGlobal('document', { querySelector: (selector: string) => selector === '[data-receipt-first-step]' ? firstStep : selector === '#software-inquiry' ? null : new Node() });
  const { renderSoftwareReceipt } = await import('~/scripts/software-inquiry');
  renderSoftwareReceipt({ brief: { name: 'Alex', email: 'alex@example.com' }, clientCopyStatus: 'sent' }, path);
  expect(firstStep.textContent).toBe(line);
});
it('sends the web app first answer as earlier context for the second question', async () => {
  vi.useFakeTimers(); choose('path', 'webapp');
  fill('appGoal', 'Let my students book and pay for lessons.'); click('[data-next]');
  fill('firstVersion', 'A booking page with a calendar'); await vi.advanceTimersByTimeAsync(400);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ question: 'Have a first version in mind?', text: 'A booking page with a calendar', earlier: { path: 'webapp', appGoal: 'Let my students book and pay for lessons.' } });
});
