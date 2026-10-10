// Fictional client journey and owner readback at both widths.
export default {
  title: 'Software brief journey',
  async run({ capture, sql }) {
    sql(`INSERT OR IGNORE INTO owner_requests(id,kind,service_id,name,email,summary,details_json,status,private_note,created_at,updated_at,submission_id)
      VALUES ('screenshot-software','software','workflow','Alex Example','alex@example.com','One place to see what each client needs next.',
      '{"path":"workflow","today":"We track onboarding in spreadsheets.\\nWe chase updates by email.","audience":"Our client team","firstResult":"One place to see what each client needs next.","company":"Example Studio","timing":"flexible","timingReason":"","budgetStatus":"exploring","budgetNote":"","approver":"self","approverRole":"","clientCopyStatus":"sent"}',
      'new','','2026-09-29T12:00:00.000Z','2026-09-29T12:00:00.000Z','00000000-0000-4000-8000-000000000001')`);
    const steps = [];
    for (const viewport of ['desktop', 'phone']) {
      const prepare = async (page, target, path = 'workflow', suggestion = false) => {
        await page.route('**/api/software/brief/pass', route => route.fulfill({ json: { ok: true } }));
        await page.route('**/api/software/brief/suggest', route => route.fulfill({ json: { suggestion: ' in a shared spreadsheet' } }));
        const messages = [], requests = [];
        const endpoint = request => /\/api\/software\/brief\/(pass|suggest)$/.test(new URL(request.url()).pathname);
        page.on('console', message => messages.push(`${message.type()}: ${message.text()}`));
        page.on('pageerror', error => messages.push(`pageerror: ${error.message}`));
        page.on('request', request => {
          if (endpoint(request)) requests.push({ request, method: request.method(), path: new URL(request.url()).pathname, status: 'pending' });
        });
        page.on('response', response => {
          const item = requests.find(item => item.request === response.request());
          if (item) item.status = response.status();
        });
        page.on('requestfailed', request => {
          const item = requests.find(item => item.request === request);
          if (item) item.status = request.failure()?.errorText ?? 'failed';
        });
        // Install before page scripts; wrap every API assignment, including later initialization.
        await page.addInitScript(() => {
          localStorage.removeItem('software-brief-draft'); localStorage.removeItem('software-suggestions');
          window.screenshotAutocomplete = { passState: 'idle', lastError: null };
          let api;
          Object.defineProperty(window, 'turnstile', {
            configurable: true,
            get: () => api,
            set: value => {
              api = new Proxy(value, { get(target, key) {
                if (key === 'render') return (container, options) => {
                  if (options['response-field'] !== false) return target.render(container, options);
                  window.screenshotAutocomplete.passState = 'token';
                  queueMicrotask(() => Promise.resolve(options.callback('screenshot-suggestion-token')).catch(error => {
                    window.screenshotAutocomplete.lastError = String(error);
                  }));
                  return 'screenshot-suggestion-widget';
                };
                if (key === 'remove') return id => { if (id !== 'screenshot-suggestion-widget') target.remove(id); };
                return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
              } });
            },
          });
        });
        await page.reload();
        if (target === 0) return;
        await page.waitForFunction(() => !!window.turnstile);
        await page.locator(`[name=path][value=${path}]`).check();
        if (target === 1) {
          if (suggestion) {
            await page.locator('[data-step="1"] textarea').fill('We track new clients');
            try {
              await page.locator('[data-step="1"] [data-accept]').waitFor({ state: 'visible' });
            } catch (error) {
              const state = await page.evaluate(() => {
                const form = document.querySelector('#software-inquiry'), box = form.querySelector('[data-step="1"] textarea');
                return { ...window.screenshotAutocomplete,
                  enabled: form.querySelector('[data-step="1"] [data-suggestions-toggle]')?.textContent === 'Turn off',
                  sitekeyPresent: !!form.dataset.suggestionSitekey, available: form.dataset.available,
                  turnstilePresent: !!window.turnstile, words: box.value.trim().split(/\s+/).length,
                  cursorAtEnd: box.selectionStart === box.value.length && box.selectionEnd === box.value.length,
                  stepHidden: box.closest('[data-step]').hidden,
                };
              }).catch(error => ({ lastError: String(error) }));
              const endpoints = requests.map(({ request, ...item }) => item);
              const pass = endpoints.filter(item => item.path.endsWith('/pass')).at(-1);
              if (pass) state.passState = pass.status === 200 ? 'pass response 200 (mock ok)' : `pass ${pass.status}`;
              console.error('Software brief autocomplete failure:', JSON.stringify({ console: messages, requests: endpoints, autocomplete: state }, null, 2));
              throw error;
            }
            if (await page.locator('[data-step="1"] textarea').inputValue() !== 'We track new clients') throw new Error('Suggestion was inserted without acceptance');
          }
          return;
        }
        await page.locator('[data-step="1"] textarea').fill(path === 'workflow' ? 'We track client onboarding in spreadsheets. Updates arrive by email.' : 'A simple way for clients to book lessons.');
        await page.locator('[data-next]').click();
        if (target === 2) return;
        await page.locator('[data-step="2"] [data-skip]').click();
        if (target === 3) return;
        await page.locator('[data-next]').click();
        if (target === 4) return;
        await page.locator('[data-step="4"] [data-skip]').click();
        if (target === 5) return;
        await page.locator('[name=name]').fill('Alex Example');
        await page.locator('[name=email]').fill('alex@example.com');
        await page.locator('[data-next]').click();
        await page.locator('[data-step="6"]:visible').waitFor();
        const summary = await page.locator('[data-review]').innerText();
        if (/First result|First version|Budget|Company/.test(summary)) throw new Error('Unanswered optional fields appeared in summary');
      };
      for (let question = 0; question < 7; question++) {
        steps.push({ title: `Brief question ${question + 1}, ${viewport}`, images: [{ file: await capture({ file: `software-brief-question-${question + 1}-${viewport}.png`, path: '/software/start', viewport, prepare: page => prepare(page, question) }), caption: 'Fictional brief, one question at a time' }] });
      }
      for (const question of [1, 2]) steps.push({ title: `Idea question ${question + 1}, ${viewport}`, images: [{ file: await capture({ file: `software-brief-idea-${question + 1}-${viewport}.png`, path: '/software/start', viewport, prepare: page => prepare(page, question, 'idea') }), caption: 'Fictional idea brief' }] });
      steps.push({ title: `Autocomplete, ${viewport}`, images: [{ file: await capture({ file: `software-brief-suggestion-${viewport}.png`, path: '/software/start', viewport, prepare: page => prepare(page, 1, 'workflow', true) }), caption: viewport === 'phone' ? 'Mocked suggestion with an explicit accept button' : 'Mocked decorative ghost text' }] });
      for (const clientCopyStatus of ['sent', 'uncertain', 'failed', undefined]) {
        steps.push({ title: `Client receipt ${clientCopyStatus ?? 'unattempted'}, ${viewport}`, images: [{ file: await capture({ file: `software-brief-receipt-${clientCopyStatus ?? 'unattempted'}-${viewport}.png`, path: '/software/start', viewport, prepare: async page => {
          await page.route('**/api/software-inquiry', async route => {
            const input = route.request().postDataJSON();
            await route.fulfill({ json: { ok: true, brief: { name: input.name, email: input.email }, clientCopyStatus } });
          });
          await prepare(page, 6);
          await page.locator('[name=cf-turnstile-response]').waitFor({ state: 'attached', timeout: 30_000 });
          await page.waitForFunction(() => !!document.querySelector('[name=cf-turnstile-response]')?.value, { timeout: 30_000 });
          await page.locator('[type=submit]').click();
          await page.locator('#software-success:visible').waitFor({ timeout: 30_000 });
          if (await page.evaluate(() => localStorage.getItem('software-brief-draft'))) throw new Error('Sent draft was not cleared');
          await page.locator('[data-intake-progress]').waitFor({ state: 'hidden' });
          await page.locator('[data-copy-card]:visible').waitFor();
        } }), caption: 'Fictional receipt with mocked delivery; no email call' }] });
      }
    }
    const images = [];
    for (const viewport of ['desktop', 'phone']) {
      for (const status of ['sent', 'failed', 'uncertain', 'unattempted']) {
        sql(status === 'unattempted' ? `UPDATE owner_requests SET details_json=json_remove(details_json,'$.clientCopyStatus','$.clientCopyAttemptedAt') WHERE id='screenshot-software'` : `UPDATE owner_requests SET details_json=json_set(details_json,'$.clientCopyStatus','${status}','$.clientCopyAttemptedAt','2026-09-29T12:00:00.000Z') WHERE id='screenshot-software'`);
        images.push({ file: await capture({ file: `software-brief-owner-${status}-${viewport}.png`, path: '/owner/requests/screenshot-software', viewport, owner: true }), caption: `Fictional software brief ${status}, ${viewport}` });
      }
      images.push({ file: await capture({ file: `software-brief-list-${viewport}.png`, path: '/owner/requests?kind=software', viewport, owner: true }), caption: `Software request list, ${viewport}` });
    }
    steps.push({ title: 'Owner reads the saved brief', images });
    return steps;
  },
};
