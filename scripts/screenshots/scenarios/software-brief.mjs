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
        await page.route('**/api/software/brief/suggest', route => route.fulfill({ json: { suggestion: ' in a shared spreadsheet' } }));
        // Captures always begin from a fresh fictional draft.
        await page.evaluate(() => { localStorage.removeItem('software-brief-draft'); localStorage.removeItem('software-suggestions'); });
        await page.reload();
        if (target === 0) return;
        await page.locator(`[name=path][value=${path}]`).check();
        if (target === 1) {
          if (suggestion) {
            await page.locator('[data-step="1"] textarea').fill('We track new clients');
            await page.locator('[data-step="1"] [data-accept]').waitFor({ state: 'visible' });
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
