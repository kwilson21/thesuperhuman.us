const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PW_SKILL_DIR, 'node_modules/playwright'));

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:4321';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

    // "Mobile needed the same sense of flow" is an authored story chapter (2026-09-09); the Sept 21
    // journal plan moves it off the bounded main page and onto the project story.
    const storyResponseEarly = await page.goto(new URL('/building/personal-website/story', targetUrl).href, { waitUntil: 'commit' });
    assert.ok(storyResponseEarly && storyResponseEarly.status() < 400, 'Personal Website project story did not load successfully');
    await page.getByRole('button', { name: /Mobile needed the same sense of flow/i }).click();
    const storyProof = page.locator('.timeline-visual-proof');
    await storyProof.first().waitFor();
    const storyProofWidths = await storyProof.first().locator('figure').evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().width)));
    assert.deepEqual(storyProofWidths, [342, 342], `Story chapter's visual proof does not fit a phone viewport: ${JSON.stringify(storyProofWidths)}`);

    const response = await page.goto(new URL('/building/personal-website', targetUrl).href, { waitUntil: 'commit' });
    assert.ok(response && response.status() < 400, 'Personal Website journal did not load successfully');
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
    assert.equal(metrics.proofCount, 3, `Expected all three mobile repairs (Latest work) to have visual proof: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.proofLinkCount, 6, `Each proof image needs a full-size link: ${JSON.stringify(metrics)}`);

    // --- September 21 journal plan (Tasks 1-3): bounded Latest work, separate story and archive ---
    await page.goto(new URL('/building/personal-website', targetUrl).href, { waitUntil: 'networkidle' });
    const bounded = await page.evaluate(() => {
      const rect = element => element ? element.getBoundingClientRect() : null;
      const scoped = selector => document.querySelectorAll(`[aria-labelledby="personal-website-updates-title"] ${selector}`);
      const nextAction = document.querySelector('[data-testid="journal-next-action"]');
      return {
        heading: document.getElementById('personal-website-updates-title')?.textContent ?? null,
        headingTop: rect(document.getElementById('personal-website-updates-title'))?.top ?? null,
        pickCount: scoped('[data-pick]').length,
        panelCount: scoped('[data-panel]').length,
        showAllPresent: scoped('[data-all]').length > 0,
        storyLinkText: nextAction?.querySelector('a[href="/building/personal-website/story"]')?.textContent ?? null,
        archiveLinkText: nextAction?.querySelector('a[href="/building/personal-website/archive"]')?.textContent ?? null,
        currentState: rect(document.querySelector('[data-testid="journal-current-state"]')),
        latestChange: rect(document.querySelector('[data-testid="journal-latest-change"]')),
        nextAction: rect(nextAction),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.equal(bounded.heading, 'Latest work', 'Personal Website’s default journal view must be headed "Latest work"');
    assert.ok(bounded.pickCount > 0 && bounded.pickCount <= 5, `Latest work must offer at most five choices, got ${bounded.pickCount}`);
    assert.equal(bounded.panelCount, bounded.pickCount, 'Latest work must render only the bounded set of panels, never the full history inline');
    assert.equal(bounded.showAllPresent, false, '"Show all entries" must not be a primary action in the Personal Website bounded view');
    assert.ok(bounded.storyLinkText, 'Missing a "View project story" link out of Latest work');
    assert.ok(bounded.archiveLinkText, 'Missing a "Browse archive" link out of Latest work');
    assert.equal(bounded.scrollWidth, bounded.clientWidth, `Bounded Latest work view overflows a phone viewport: ${JSON.stringify(bounded)}`);
    assert.ok(bounded.currentState, 'Missing the current-state landmark (data-testid="journal-current-state")');
    assert.ok(bounded.latestChange, 'Missing the latest-change landmark (data-testid="journal-latest-change")');
    assert.ok(bounded.nextAction, 'Missing the next-action landmark (data-testid="journal-next-action")');
    const twoScreenBudget = 2 * 844; // the Sept 21 spec's guardrail at a 390x844 viewport
    // Owner amendment, September 26, 2026: the Sept 26 audit (S10) places "What changed, page by
    // page" above the journal, so current-state (in the shared project header, above every journal
    // surface) keeps its budget from the document top, while latest-change and next-action are
    // measured from the top of the "Latest work" section instead, within the same budget.
    assert.ok(bounded.currentState.bottom <= twoScreenBudget,
      `The current-state landmark must end within ${twoScreenBudget}px of the document top, ends at ${bounded.currentState.bottom}`);
    assert.ok(bounded.headingTop !== null, 'Missing the "Latest work" heading to measure the other two landmarks from');
    const latestChangeFromHeading = bounded.latestChange.bottom - bounded.headingTop;
    const nextActionFromHeading = bounded.nextAction.bottom - bounded.headingTop;
    assert.ok(latestChangeFromHeading <= twoScreenBudget,
      `The latest-change landmark must end within ${twoScreenBudget}px of the "Latest work" heading, ends at ${latestChangeFromHeading}px`);
    assert.ok(nextActionFromHeading <= twoScreenBudget,
      `The next-action landmark must end within ${twoScreenBudget}px of the "Latest work" heading, ends at ${nextActionFromHeading}px`);

    // A moved entry's old fragment still resolves, without JavaScript, to a link at its new location.
    const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    try {
      const noJsPage = await noJsContext.newPage();
      await noJsPage.goto(new URL('/building/personal-website#website-start-with-the-reader', targetUrl).href, { waitUntil: 'load' });
      const movedTarget = noJsPage.locator('#website-start-with-the-reader');
      await movedTarget.waitFor({ state: 'visible' });
      assert.equal(await movedTarget.getAttribute('href'), '/building/personal-website/story#website-start-with-the-reader',
        'A story entry moved off the main page must anchor to its old ID and link to its new location');
      const panelCountNoJs = await noJsPage.locator('[aria-labelledby="personal-website-updates-title"] [data-panel]').count();
      assert.ok(panelCountNoJs > 0 && panelCountNoJs <= 5,
        `Without JavaScript, Personal Website must show at most five Latest work entries, got ${panelCountNoJs}`);

      // The story and archive links are plain hrefs, so they must stay reachable with no script at
      // all: the Sept 21 spec requires the archive link to follow the five updates without JavaScript.
      const noJsHome = await noJsContext.newPage();
      await noJsHome.goto(new URL('/building/personal-website', targetUrl).href, { waitUntil: 'load' });
      const nextActionNoJs = noJsHome.locator('[data-testid="journal-next-action"]');
      await nextActionNoJs.waitFor({ state: 'visible' });
      assert.ok(await nextActionNoJs.locator('a[href="/building/personal-website/story"]').isVisible(),
        'Without JavaScript, "View project story" must still be reachable');
      assert.ok(await nextActionNoJs.locator('a[href="/building/personal-website/archive"]').isVisible(),
        'Without JavaScript, "Browse archive" must still be reachable');
    } finally {
      await noJsContext.close();
    }

    // The project story reads chronologically; the archive reads newest first. Neither loses an entry.
    const panelDays = async targetPage => targetPage.evaluate(() =>
      [...document.querySelectorAll('[data-panel]')].map(article => article.querySelector('p.meta time')?.getAttribute('datetime')));

    const storyPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const storyResponse = await storyPage.goto(new URL('/building/personal-website/story', targetUrl).href, { waitUntil: 'networkidle' });
    assert.ok(storyResponse && storyResponse.status() < 400, 'Personal Website project story route did not load successfully');
    const storyDays = await panelDays(storyPage);
    assert.ok(storyDays.length >= 2, 'The project story should hold more than one authored chapter');
    assert.deepEqual(storyDays, [...storyDays].sort(), 'The project story must read in the order it happened, oldest first');

    const archivePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const archiveResponse = await archivePage.goto(new URL('/building/personal-website/archive', targetUrl).href, { waitUntil: 'networkidle' });
    assert.ok(archiveResponse && archiveResponse.status() < 400, 'Personal Website archive route did not load successfully');
    const archiveDays = await panelDays(archivePage);
    assert.ok(archiveDays.length >= 1, 'The archive should hold at least the one entry bumped past Latest work’s limit');
    assert.deepEqual(archiveDays, [...archiveDays].sort().reverse(), 'The archive must read newest first');

    // Repeat the bounded-choice and overflow checks at 1440px.
    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktopPage.goto(new URL('/building/personal-website', targetUrl).href, { waitUntil: 'networkidle' });
    const desktopBounded = await desktopPage.evaluate(() => {
      const visible = element => { if (!element) return false; const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const nextAction = document.querySelector('[data-testid="journal-next-action"]');
      return {
        pickCount: document.querySelectorAll('[aria-labelledby="personal-website-updates-title"] [data-pick]').length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        storyLinkVisible: visible(nextAction?.querySelector('a[href="/building/personal-website/story"]')),
        archiveLinkVisible: visible(nextAction?.querySelector('a[href="/building/personal-website/archive"]')),
      };
    });
    assert.ok(desktopBounded.pickCount > 0 && desktopBounded.pickCount <= 5, `Desktop Latest work must also cap at five, got ${desktopBounded.pickCount}`);
    assert.equal(desktopBounded.scrollWidth, desktopBounded.clientWidth, `Bounded Latest work view overflows at 1440px: ${JSON.stringify(desktopBounded)}`);
    assert.ok(desktopBounded.storyLinkVisible, '"View project story" must be visible at 1440px');
    assert.ok(desktopBounded.archiveLinkVisible, '"Browse archive" must be visible at 1440px');
  } finally {
    await browser.close();
  }
  console.log('personal website journal browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
