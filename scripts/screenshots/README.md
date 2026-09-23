# Screenshots

CI runs these on pull requests that touch the UI, in two workflows:

- `screenshots.yml` runs the pull request's code with a read-only token. It captures the pages and scenarios and uploads the PNGs and `manifest.json` as an artifact.
- `screenshots-publish.yml` runs after it via `workflow_run`, always from the default branch. It finds the pull request from run metadata, accepts only PNG files with plain names, sanitizes the manifest, pushes the images to the `screenshots` branch and writes the table into the PR description.

Because `workflow_run` workflows only run from the default branch, a change to the publish step takes effect after it merges.

Run locally:

```sh
npm run screenshots:preview
MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json npx astro dev --port 4321 --host 127.0.0.1
npm run screenshots   # in a second terminal; images land in screenshots/
```

The preview uses local D1, KV and R2, Turnstile's test keys, and a throwaway Access issuer on `127.0.0.1:9911`, so owner pages render through the real JWT check. Nothing reaches production.

## Pages

`config.mjs` lists every page. `tests/scripts/screenshots.test.ts` fails when a new page file is neither listed in `PAGES` nor explained in `NOT_PAGES`.

## Scenarios

Pages that need seeded data are listed in `SCENARIO_PAGES` in `config.mjs` with the scenario that captures them; the coverage test checks that scenario captures the route.

A scenario captures a stateful flow step by step. Add `scripts/screenshots/scenarios/<name>.mjs`:

```js
export default {
  title: 'Client journey',
  async run({ base, capture, sql, ownerFetch }) {
    sql("INSERT INTO owner_requests(...) VALUES(...)"); // seed only what needs an outside service
    await ownerFetch('/api/owner/requests/<id>', { action: 'review' }); // then drive the real routes
    return [{ title: 'Request reviewed', images: [
      { file: await capture({ file: 'journey-01-desktop.png', path: '/owner/requests/<id>', owner: true }), caption: 'Owner view' },
    ] }];
  },
};
```

`capture` takes `path`, `file`, `viewport` (`desktop` or `phone`), `owner`, `cookie` (for a studio session), `selector` (one section) and `status`. Seed only what depends on an outside service (Turnstile, Stripe webhooks, email codes) and say so in the step title or caption.
