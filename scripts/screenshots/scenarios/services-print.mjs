export default {
  title: 'Software service sheet print',
  async run({ capture }) {
    const file = await capture({
      file: 'services-print.png',
      path: '/services',
      viewport: 'desktop',
      prepare: page => page.emulateMedia({ media: 'print' }),
    });
    return [{
      title: 'US Letter print layout',
      images: [{ file, caption: 'Print media layout of the software service sheet' }],
    }];
  },
};
