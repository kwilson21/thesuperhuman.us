const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwrightPath = process.env.PW_SKILL_DIR
  ? path.join(process.env.PW_SKILL_DIR, 'node_modules/playwright')
  : 'playwright';
const { chromium } = require(playwrightPath);

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4321';
const artifactDir = process.env.PW_ARTIFACT_DIR || '/tmp';
const pageRoot = path.resolve('src/pages');
const staticRoutes = readdirSync(pageRoot, { recursive: true })
  .filter(file => typeof file === 'string' && file.endsWith('.astro'))
  .filter(file => !file.includes('[') && !file.startsWith('owner/'))
  .map(file => file
    .replace(/\.astro$/, '')
    .replace(/(^|\/)index$/, '')
    .replace(/^/, '/'));
const routes = [...new Set([...staticRoutes, '/music/old-news'])].sort();

(async () => {
  const { BARE_LINK_LANDINGS } = await import('../../scripts/screenshots/config.mjs');
  const landingStatuses = new Map(BARE_LINK_LANDINGS.map(({ path, status }) => [path, status]));
  const allRoutes = [...new Set([...routes, ...landingStatuses.keys()])].sort();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(targetUrl).origin,
    });
    for (const route of allRoutes) {
      const response = await page.goto(new URL(route, targetUrl).href, { waitUntil: 'domcontentloaded' });
      if (landingStatuses.has(route)) {
        assert.equal(response?.status(), landingStatuses.get(route), `${route} must refuse a bare one-time link`);
      } else if (route !== '/404') assert.ok(response && response.status() < 400, `${route} did not load successfully`);
      await page.locator('h1').first().waitFor();
      const uncovered = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const results = [];
        let node;
        while ((node = walker.nextNode())) {
          if (!/\bKazon(?: Wilson)?\b/.test(node.textContent || '')) continue;
          const parent = node.parentElement;
          if (!parent || parent.closest('[data-personal-name]')) continue;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
          results.push((node.textContent || '').trim());
        }
        return results;
      });
      assert.deepEqual(uncovered, [], `${route} has visible unstyled name text`);
      const invalidStyles = await page.locator('[data-personal-name]').evaluateAll(elements =>
        elements.flatMap(element => {
          const style = getComputedStyle(element);
          const nameStyle = element.getAttribute('data-name-style');
          const expectedFamily = nameStyle === 'display'
            ? 'Kazon Name Display'
            : nameStyle === 'inherit'
              ? getComputedStyle(element.parentElement).fontFamily
              : 'Kazon Name Text';
          const value = element.textContent || '';
          const expectedValue = element.getAttribute('data-personal-name') === 'full'
            ? 'Kazon Wilson'
            : 'Kazon';
          const familyMatches = nameStyle === 'inherit'
            ? style.fontFamily === expectedFamily
            : style.fontFamily.includes(expectedFamily);
          return familyMatches
            && style.textTransform === 'none'
            && value === expectedValue
            ? []
            : [{ value, family: style.fontFamily, transform: style.textTransform, expectedFamily, expectedValue }];
        }),
      );
      assert.deepEqual(invalidStyles, [], `${route} overrides the custom name font or ordinary text`);
    }

    await page.goto(pathToFileURL(path.resolve('scripts/og.html')).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    assert.match(
      await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily),
      /Libron/,
      'default social card does not use Libron for its serif text',
    );
    assert.equal(await page.evaluate(() => document.fonts.check('400 34px Libron')), true);
    const socialName = page.locator('h1');
    assert.match(
      await socialName.evaluate(element => getComputedStyle(element).fontFamily),
      /Kazon Name Display/,
      'default social card does not use the font-native name mark',
    );
    assert.equal(await socialName.textContent(), 'Kazon Wilson');

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('400 16px Libron')), true);
    assert.equal(await page.evaluate(() => document.fonts.check('400 96px "Kazon Name Display"')), true);
    assert.equal(await page.getByRole('heading', { name: 'Kazon Wilson', exact: true }).count(), 1);
    const displayName = page.locator('[data-personal-name][data-name-style="display"]').first();
    await displayName.waitFor();
    const family = await displayName.evaluate(element => getComputedStyle(element).fontFamily);
    assert.match(family, /Kazon Name Display/);
    const selectedName = await displayName.evaluate(element => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString().replace(/\s+/g, ' ').trim();
      });
    assert.equal(selectedName, 'Kazon Wilson');
    const selectedFirstName = await displayName.evaluate(element => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element.firstChild);
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
    });
    assert.equal(selectedFirstName, 'Kazon');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText, 'Kazon');
    assert.equal(clipboardText.includes('\u0304'), false);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    assert.equal(await displayName.textContent(), 'Kazon Wilson');
    assert.equal((await displayName.textContent()).includes('\u0304'), false);
    await displayName.screenshot({ path: path.join(artifactDir, 'personal-name-display.png') });
    await page.locator('.site-name [data-personal-name]').screenshot({ path: path.join(artifactDir, 'personal-name-text.png') });
    await page.screenshot({ path: path.join(artifactDir, 'personal-name-desktop.png'), fullPage: true });

    await page.goto(new URL('/music/old-news', targetUrl).href, { waitUntil: 'domcontentloaded' });
    const inheritedName = page.locator('.music-consent [data-name-style="inherit"]');
    await inheritedName.waitFor();
    assert.equal(
      await inheritedName.evaluate(element => getComputedStyle(element).fontFamily),
      await inheritedName.evaluate(element => getComputedStyle(element.parentElement).fontFamily),
      'inline personal name should inherit the surrounding form typeface',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('400 96px "Kazon Name Display"')), true);
    await page.screenshot({ path: path.join(artifactDir, 'personal-name-mobile.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  console.log('personal name browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
