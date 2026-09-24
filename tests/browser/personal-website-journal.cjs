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
    for (const name of [
      /Let the A\/B player keep playing on iPhone/i,
      /Make the A\/B controls fit the song/i,
      /Keep owner-page explanations inside the screen/i,
    ]) {
      await page.getByRole('button', { name }).click();
      await page.getByRole('heading', { name }).waitFor();
      const activeProof = page.locator('article[data-panel]:not([hidden]) .timeline-visual-proof');
      await activeProof.waitFor();
      const widths = await activeProof.locator('figure').evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().width)));
      assert.deepEqual(widths, [342, 342], `Opened visual proof does not fit a phone viewport: ${JSON.stringify({ name: String(name), widths })}`);
    }
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      proofCount: document.querySelectorAll('.timeline-visual-proof').length,
      proofLinkCount: document.querySelectorAll('.timeline-visual-proof a').length,
    }));
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `Journal overflows a phone viewport: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.proofCount, 4, `Expected the existing study and all three mobile repairs to have visual proof: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.proofLinkCount, 8, `Each proof image needs a full-size link: ${JSON.stringify(metrics)}`);
  } finally {
    await browser.close();
  }
  console.log('personal website journal browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
