const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PW_SKILL_DIR, 'node_modules/playwright'));

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4321';
const artifactDir = process.env.PW_ARTIFACT_DIR || '/tmp';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.route('**/api/music-interest', async route => {
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          errors: {
            ...(payload.consent ? {} : { consent: 'Check the box to confirm I may email you about your selection.' }),
            turnstileToken: 'Complete the verification and try again.',
          },
        }),
      });
    });
    await page.goto(new URL('/music/old-news', targetUrl).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#release-interest').evaluate(form => {
      form.dataset.available = 'true';
      form.querySelector('button[type="submit"]').disabled = false;
    });
    await page.getByLabel('Email', { exact: true }).fill('listener@example.com');
    await page.getByRole('button', { name: 'Register interest' }).click();

    const consentError = page.getByText('Check the box to confirm I may email you about your selection.', { exact: true });
    const verificationError = page.getByText('Complete the verification and try again.', { exact: true });
    await consentError.waitFor();
    await verificationError.first().waitFor();
    assert.equal(await consentError.count(), 1, 'consent guidance should appear once');
    assert.equal(await verificationError.count(), 1, 'verification guidance should appear once');

    const checkbox = page.getByRole('checkbox', { name: /may email me about availability/i });
    assert.equal(await checkbox.getAttribute('aria-invalid'), 'true');
    assert.equal(await checkbox.evaluate(element => element === document.activeElement), true, 'consent checkbox should receive focus');
    assert.equal(await page.getByRole('status').textContent(), 'Please check the highlighted fields.');

    await checkbox.check();
    await page.getByRole('button', { name: 'Register interest' }).click();
    await verificationError.waitFor();
    assert.equal(await verificationError.count(), 1, 'verification-only guidance should still appear once');
    assert.equal(
      await verificationError.evaluate(element => element === document.activeElement),
      true,
      'verification-only guidance should receive focus',
    );

    const nameFont = await page.locator('.music-consent [data-name-style="inherit"]').evaluate(element => getComputedStyle(element).fontFamily);
    const sentenceFont = await page.locator('.music-consent > span').evaluate(element => getComputedStyle(element).fontFamily);
    assert.equal(nameFont, sentenceFont, 'inline personal name should inherit the form typeface');

    await page.locator('#release-interest').screenshot({ path: path.join(artifactDir, 'interest-form-mobile-errors.png') });
  } finally {
    await browser.close();
  }
  console.log('music interest browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
