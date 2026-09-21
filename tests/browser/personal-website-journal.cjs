const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PW_SKILL_DIR, 'node_modules/playwright'));

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4321';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const response = await page.goto(new URL('/building/personal-website', targetUrl).href, { waitUntil: 'commit' });
    assert.ok(response && response.status() < 400, 'Personal Website journal did not load successfully');
    await page.getByRole('button', { name: /Mobile needed the same sense of flow/i }).click();
    const proof = page.locator('.timeline-visual-proof');
    await proof.first().waitFor();
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      proofCount: document.querySelectorAll('.timeline-visual-proof').length,
      figureWidths: [...document.querySelectorAll('.timeline-visual-proof figure')].map(element => Math.round(element.getBoundingClientRect().width)),
    }));
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `Journal overflows a phone viewport: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.proofCount, 1, `Expected one reviewed visual proof: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.figureWidths.every(width => width > 0 && width <= 390), `Visual proof does not fit a phone viewport: ${JSON.stringify(metrics)}`);
  } finally {
    await browser.close();
  }
  console.log('personal website journal browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
