// A long development journal at its newest page, then the next older page, at both widths.
const VIEWPORTS = ['desktop', 'phone'];
const PATH = '/building/kaillera-next';

export default {
  title: 'Development journal pagination',
  async run({ capture }) {
    const steps = [];
    const shot = async (title, name, prepare) => {
      const images = [];
      for (const viewport of VIEWPORTS) {
        images.push({ file: await capture({ file: `journal-pagination-${name}-${viewport}.png`, path: PATH, viewport, selector: '[data-timeline]', prepare }), caption: title });
      }
      steps.push({ title, images });
    };
    await shot('First page, newest entries first', 'newest');
    await shot('After choosing Older', 'older', async page => {
      await page.locator('[data-page-next]').click();
      await page.waitForFunction(() => document.querySelector('[data-page-position]')?.textContent?.startsWith('Page 2'));
    });
    return steps;
  },
};
