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
      if (viewport === 'desktop') steps.push({ title: `Client chooses a starting point, ${viewport}`, images: [{ file: await capture({ file: 'software-brief-no-path-desktop.png', path: '/software/start', viewport }), caption: 'No starting point selected' }] });
      steps.push({ title: `Client project, ${viewport}`, images: [{ file: await capture({ file: `software-brief-project-${viewport}.png`, path: '/software/start?path=workflow', viewport }), caption: 'Fictional project step' }] });
      steps.push({ title: `Client idea, ${viewport}`, images: [{ file: await capture({ file: `software-brief-idea-${viewport}.png`, path: '/software/start?path=idea', viewport }), caption: 'Fictional idea questions' }] });
      const fill = async page => {
        await page.locator('[name=today]').fill('We track client onboarding in several spreadsheets.\nUpdates arrive by email and are easy to miss.');
        await page.locator('[name=audience]').fill('The fictional client team');
        await page.locator('[name=firstResult]').fill('A shared view of next steps that the client team can check each morning.');
        await page.locator('[data-next]').click();
      };
      steps.push({ title: `Client details, ${viewport}`, images: [{ file: await capture({ file: `software-brief-details-${viewport}.png`, path: '/software/start?path=workflow', viewport, prepare: fill }), caption: 'Fictional details step' }] });
      const review = async page => {
        await fill(page);
        await page.locator('[name=name]').fill('Alex Example');
        await page.locator('[name=email]').fill('alex@example.com');
        await page.locator('[name=timing]').selectOption('quarter');
        await page.locator('[name=budgetStatus]').selectOption('exploring');
        await page.locator('[name=approver]').selectOption('other');
        await page.locator('[name=approverRole]').fill('Project sponsor');
        await page.locator('[data-next]').click();
        await page.locator('[name=cf-turnstile-response]').waitFor({ state: 'attached', timeout: 30_000 });
        await page.waitForFunction(() => !!document.querySelector('[name=cf-turnstile-response]')?.value, { timeout: 30_000 });
        await page.locator('[data-step="2"]:visible').waitFor();
        await page.waitForTimeout(1_500);
      };
      steps.push({ title: `Client review, ${viewport}`, images: [{ file: await capture({ file: `software-brief-review-${viewport}.png`, path: '/software/start?path=workflow', viewport, prepare: review }), caption: 'Fictional review step' }] });
      for (const clientCopyStatus of ['sent', 'uncertain', 'failed', undefined]) {
        steps.push({ title: `Client receipt ${clientCopyStatus ?? 'unattempted'}, ${viewport}`, images: [{ file: await capture({ file: `software-brief-receipt-${clientCopyStatus ?? 'unattempted'}-${viewport}.png`, path: '/software/start?path=workflow', viewport, prepare: async page => {
          await page.route('**/api/software-inquiry', async route => {
            const input = route.request().postDataJSON();
            await route.fulfill({ json: { ok: true, brief: { name: input.name, email: input.email }, clientCopyStatus } });
          });
          await review(page);
          await page.locator('[type=submit]').click();
          await page.locator('#software-success:visible').waitFor({ timeout: 30_000 });
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
