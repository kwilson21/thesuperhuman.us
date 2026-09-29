// Capture the software service sheet at US Letter width in print media.
export default {
  title: 'Software service sheet print',
  async run({ capture }) {
    const file = await capture({
      file: 'services-print.png',
      path: '/services',
      viewport: 'desktop',
      prepare: async page => {
        await page.setViewportSize({ width: 816, height: 1056 });
        await page.emulateMedia({ media: 'print' });
      },
    });
    return [{
      title: 'US Letter print layout',
      images: [{ file, caption: 'Print media layout of the software service sheet' }],
    }];
  },
};
