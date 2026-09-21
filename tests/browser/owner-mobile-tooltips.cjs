const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PW_SKILL_DIR, 'node_modules/playwright'));

const css = readFileSync('src/styles/owner.css', 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
    await page.setContent(`<style>:root{--paper:#fbf8f2;--ink:#161311;--muted:#5b5855;--rule:#e4ded4;--accent:#b85b35}body{margin:0}${css}</style><main class="owner-shell owner-main"><section class="owner-section"><div class="section-heading-line"><div><h2>How far people listened</h2></div><details class="metric-definition" open><summary>?</summary><div>These milestones follow an ordered browser sequence bounded by server time.</div></details></div></section><section class="owner-section supporting-evidence"><div><h2>Where listening gathers</h2><details class="metric-definition" open><summary>?</summary><div>Cloudflare supplies an approximate network location.</div></details></div></section></main>`);
    const bounds = await page.locator('.metric-definition > div').evaluateAll(elements => elements.map(element => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    }));
    for (const tooltip of bounds) {
      assert.ok(tooltip.left >= 0 && tooltip.right <= 430, `tooltip is clipped: ${JSON.stringify(tooltip)}`);
    }
  } finally {
    await browser.close();
  }
  console.log('owner mobile tooltip browser checks: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
