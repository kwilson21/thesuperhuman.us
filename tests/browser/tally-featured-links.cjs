const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4321';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const response = await page.goto(new URL('/building/tally', targetUrl).href, { waitUntil: 'load' });
    assert.ok(response && response.status() < 400, 'Tally project page did not load successfully');

    const featuredDemo = page.getByRole('link', { name: 'A safe public demo' });
    await featuredDemo.click();
    const active = page.locator('article[data-panel]:not([hidden]) h3');
    await active.waitFor();
    assert.equal(await active.textContent(), 'A demo that cleans up after itself');

    await page.getByRole('button', { name: /A catalog for Tally’s design system/ }).click();
    assert.equal(await active.textContent(), 'A catalog for Tally’s design system');
    const hashBeforeRepeat = new URL(page.url()).hash;
    assert.equal(hashBeforeRepeat, '#tally-demo-environment', 'Selecting a milestone should leave the featured fragment unchanged');

    // Clicking the same featured fragment must reselect it, even though the browser emits no
    // hashchange event when the URL already has that fragment.
    await featuredDemo.click();
    assert.equal(await active.textContent(), 'A demo that cleans up after itself');
    assert.equal(new URL(page.url()).hash, hashBeforeRepeat, 'The repeated link should keep the current fragment');
  } finally {
    await browser.close();
  }
  console.log('Tally featured-link browser check: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
