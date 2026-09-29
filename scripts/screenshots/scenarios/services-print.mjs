export default {
  title: 'Software service sheet print',
  async run({ capture }) {
    return [{ title: 'US Letter print layout', images: [{ file: await capture({ file: 'services-print.png', path: '/services', viewport: 'desktop', prepare: page => page.emulateMedia({ media: 'print' }) }), caption: 'Print media layout of the software service sheet' }] }];
  },
};
