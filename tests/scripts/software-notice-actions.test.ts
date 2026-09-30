import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const panel = readFileSync(new URL('../../src/components/owner/SoftwareProjectPanel.astro', import.meta.url), 'utf8');
// Execute the template's actual visibility condition without a browser or build.
const expression = panel.match(/\{([^{}]+) && <>\<p class="rail-muted">/)![1];
const visible = new Function('update', `return ${expression}`);
it.each(['pending', 'failed', 'sending'])('only shared updates expose %s notice actions', notification_status => {
  expect(visible({ status: 'shared', notification_status })).toBe(true);
  for (const status of ['draft', 'superseded']) expect(visible({ status, notification_status })).toBe(false);
});
it.each(['sent', 'not_requested'])('hides %s notice actions', notification_status => {
  expect(visible({ status: 'shared', notification_status })).toBe(false);
});

it('preserves manual initial payment when only later invoices exist and limits redelivery prompts to delivery invoices',()=>{
  const client=readFileSync(new URL('../../src/pages/studio/software/[id].astro',import.meta.url),'utf8');
  const line=readFileSync(new URL('../../src/components/owner/SoftwareInvoiceLine.astro',import.meta.url),'utf8');
  const fallback=client.match(/project.first_payment_recorded_at \? 'Received' : 'Not recorded'/)![0];
  const label=new Function('project',`return ${fallback}`);
  // A void invoice remains history after the owner records the bank deposit and starts.
  expect(label({first_payment_recorded_at:'2026-09-30'})).toBe('Received');
  expect(label({first_payment_recorded_at:null})).toBe('Not recorded');
  const condition=line.match(/const redeliveryPrompt=(.+);/)![1];
  const prompt=new Function('kind','redeliveryAt','latest',`return ${condition}`);
  expect(prompt('deposit','2026-10-02',{status:'open',created_at:'2026-10-01'})).toBe(false);
  expect(prompt('balance','2026-10-02',{status:'open',created_at:'2026-10-01'})).toBe(true);
  expect(prompt('balance','2026-10-02',{status:'open',created_at:'2026-10-03'})).toBe(false);
  expect(prompt('milestone','2026-10-02',{status:'open',created_at:'2026-10-01'})).toBe(true);
});
