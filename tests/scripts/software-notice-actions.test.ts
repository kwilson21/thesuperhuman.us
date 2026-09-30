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
