# Screenshots

CI runs these on pull requests that change the UI, and on the same changes once merged to `main` (see the `paths` list in `screenshots.yml`; server-only code, migrations and config don't trigger it), in two workflows:

- `screenshots.yml` runs the pull request's code with a read-only token. It captures the pages and scenarios and uploads the PNGs and `manifest.json` as an artifact.
- `screenshots-publish.yml` runs after it via `workflow_run`, always from the default branch. It finds the pull request from run metadata and skips the run if the PR has moved on to a newer commit. It accepts only PNG files with plain names that `verify-png.mjs` fully decodes, sanitizes the manifest, pushes the images to the `screenshots` branch and writes the table into the PR description, checking the PR head once more just before it writes.

Because `workflow_run` workflows only run from the default branch, a change to the publish step takes effect after it merges.

Run locally:

```sh
npm run screenshots:preview
MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json npx astro dev --config scripts/screenshots/dev.config.mjs --port 4321 --host 127.0.0.1
npm run screenshots   # in a second terminal; images land in screenshots/
```

`dev.config.mjs` is the site's Astro config plus a dev-only `/__screenshots/deps` endpoint that lists the server's module graph. Capture reads it to learn which source files each scenario used.

## Reusing unchanged images

CI keeps each run's images and `cache.json` in the Actions cache, and the next run on the same branch (or, failing that, the latest run on `main`) restores them into `.screenshots/reference`. `cache.mjs` decides what can be copied from there instead of captured:

- **A page** at one size is reused when every same-origin response it loaded (its HTML, CSS, scripts, images and data requests) is byte-identical when fetched again. A change anywhere in its code, content, data or Tailwind output changes one of those responses.
- **A scenario** is reused on the same day, in both UTC and New York time (scenarios seed dates from the clock), when its script, the source files behind every route it requested (from the module graph, plus all of `src/content/` if it reads content collections) and the static files it loaded are unchanged. Requests an endpoint serves, such as owner-only images from an API route, count as routes, not static files. If a scenario was removed since the earlier run, every scenario runs. Scenarios share one database, so a scenario that changed the stored state is a writer: a scenario that runs first reruns every writer before it, and once a run writes differently from before, every later scenario runs.
- **Everything** is captured when the capture scripts, the dependencies, `astro.config.mjs`, `tsconfig.json`, `wrangler.jsonc`, the migrations, this workflow, Node or Chromium changed, when there is no earlier run, or when `SCREENSHOTS_FULL=1` is set. In a pull request, adding the `full-screenshots` label sets it.

A reused image skips that page's console and status checks; its inputs are the same as in the run that passed them. Locally, nothing is reused unless you copy an earlier `screenshots/` folder to `.screenshots/reference`.

The preview config is built from `wrangler.jsonc`: the same compatibility settings, vars and binding names, with local D1, KV and R2 in place of every production resource. `PREVIEW_OVERRIDES` in `config.mjs` lists the only vars it changes, and why: Turnstile's test keys, a throwaway Access issuer on `127.0.0.1:9911` so owner pages render through the real JWT check, a local studio code key, and the client portal flag turned on so gated pages can be reviewed before launch. Nothing reaches production.

## Pages

`config.mjs` lists every page. `tests/scripts/screenshots.test.ts` fails when a new page file is not in `PAGES`, `REDIRECTS`, `SCENARIO_PAGES` or `NOT_PAGES`. Capture requests each redirect without following it and fails unless the status and location match.

## Scenarios

Pages that need seeded data are listed in `SCENARIO_PAGES` in `config.mjs` with the scenario that captures them. The coverage test runs each scenario with a recording `capture`, and capture itself fails when the scenario rendered no page under the route with the expected status.

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

`capture` takes `path`, `file`, `viewport` (`desktop` or `phone`), `owner`, `cookie` (for a studio session), `selector` (one section), `status`, and optional `prepare: async page => {}`. The callback runs after load and fonts settle, before capture. Seed only what depends on an outside service (Turnstile, Stripe webhooks, email codes) and say so in the step title or caption.

If `prepare` throws, capture saves `_failure-<scenario>-<shot>.png` (full page) and a matching `.txt` with the URL, original error and every status element's text, then rethrows. CI retains these in the separate `screenshot-failures` artifact. They are excluded from the published gallery.

The software-signing scenario and PDF test default to the committed fictional
`fixtures/sample-agreement-templates.json` (`msa` and `sow` text). CI needs no
private templates. The sample includes all supported fields, numbered sections,
paragraphs and a list to exercise rendering, blank checks and PDF layout.
Set `AGREEMENT_TEMPLATE_FILE` to explicitly use another template JSON locally.
The separate real-v1 PDF test runs only when `.private/signing/templates.json`
exists and is skipped otherwise. Never commit the real agreement clauses.
