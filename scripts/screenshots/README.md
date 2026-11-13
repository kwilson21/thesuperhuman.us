# Screenshots

CI runs these on pull requests that change the UI, and on the same changes once merged to `main` (see the `paths` list in `screenshots.yml`; server-only code, migrations and config don't trigger it), in two workflows:

- `screenshots.yml` runs the pull request's code with a read-only token. It captures the pages and scenarios and uploads the PNGs and `manifest.json` as an artifact.
- `screenshots-publish.yml` runs after it via `workflow_run`, always from the default branch. It finds the pull request from run metadata and skips the run if the PR has moved on to a newer commit. It accepts only PNG files with plain names that `verify-png.mjs` fully decodes, sanitizes the manifest, pushes the images to the `screenshots` branch and writes the table into the PR description, checking the PR head once more just before it writes.

Because `workflow_run` workflows only run from the default branch, a change to the publish step takes effect after it merges. `screenshots.yml` also runs every three days on `main`, and on demand, because GitHub deletes caches unused for seven days: that run keeps a recent reference for pull requests to reuse. A newer push no longer cancels a capture in progress, so the capture finishes and saves its images.

Run locally:

```sh
pnpm run screenshots:preview
MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json pnpm exec astro dev --config scripts/screenshots/dev.config.mjs --port 4321 --host 127.0.0.1
pnpm run screenshots   # in a second terminal; images land in screenshots/
```

`dev.config.mjs` is the site's Astro config plus a dev-only `/__screenshots/deps` endpoint that lists the server's module graph. Capture reads it to learn which source files each scenario used.

## Reusing unchanged images

CI keeps each run's images and `cache.json` in the Actions cache, and the next run on the same branch (or, failing that, the latest run on `main`) restores them into `.screenshots/reference`. `cache.mjs` decides what can be copied from there instead of captured:

- **A page** at one size is reused when every same-origin response it loaded (its HTML, CSS, scripts, images and data requests) is byte-identical when fetched again. A change anywhere in its code, content, data or Tailwind output changes one of those responses. Files Vite serves from `node_modules` are only checked for presence: their bytes vary between server starts, and they come from `pnpm-lock.yaml`, which recaptures everything when it changes.
- **A scenario** is reused when its script, the source files behind every route it requested (from the module graph, plus all of `src/content/` if it reads content collections) and the static files it loaded are unchanged. Scenarios run on the pinned clock (below), so the date a run happens on doesn't change their images. Requests an endpoint serves, such as owner-only images from an API route, count as routes, not static files. If a scenario was removed since the earlier run, every scenario runs. Scenarios share one database, so a scenario that changed the stored state is a writer: a scenario that runs first reruns every writer before it, and once a run writes differently from before, every later scenario runs.
- **Everything** is captured when the capture scripts, the dependencies, `astro.config.mjs`, `tsconfig.json`, `wrangler.jsonc`, the migrations, this workflow, Node or Chromium changed, when there is no earlier run, or when `SCREENSHOTS_FULL=1` is set. In a pull request, adding the `full-screenshots` label sets it.

A reused image skips that page's console and status checks; its inputs are the same as in the run that passed them. Locally, nothing is reused unless you copy an earlier `screenshots/` folder to `.screenshots/reference`.

## Pinned clock

`clock.mjs` freezes time at `CLOCK_BASE`, 12 November 2026 at noon UTC, so the same inputs give the same images on any date. The base is later than every date the scenarios treat as past and earlier than the dates they treat as still ahead. Noon UTC is 7 am in New York in November, so a run never crosses a date line in either zone.

Time only moves when capture moves it, one step at a time. A step is one second (`STEP_MS`), and `stepTime(step)` gives its instant. Every page capture runs at step 0, since pages only read data. Each scenario starts at step 0, and each `capture` and `ownerFetch` call it makes moves on one step before it does anything. A `sql` call moves the step too, but only the capture's own clock; the dev server catches up at its next `capture` or `ownerFetch`. So every time a page shows depends only on the scenario's script and its position in it, not on how long anything took to run. Real elapsed time never reaches the clock, so a slow run and a fast run produce the same images.

The pin covers three processes. The capture process starts frozen at the base, since `clock-install.mjs` is its first import. The dev server does the same (`dev.config.mjs` imports it first), and capture sets it with `POST /__screenshots/clock` (`{ "now": <ms> }`), so the site's server code and the rows it stamps see the step's time. Pages that capture opens on the preview's own origin are frozen at the capture's clock when each page is set up, through an init script (`browserClockScript` in `clock.mjs`), so the page and the server agree. Third-party frames, such as Turnstile's, keep the real clock. The owner token expires one hour after step 0, so a scenario may not reach 50 minutes of steps; capture stops with an error before it could.

Changing `CLOCK_BASE` recaptures everything, because `scripts/screenshots` is a global input.

What still reads the real clock, and whether it reaches an image:

- Two migrations default a column with SQLite `strftime('now')`: `migrations/music/0023_software_signing.sql` (the signing settings row's `updated_at`) and `migrations/publication/0001_publication_journal.sql` (`published_at`). Neither reaches an image. No page shows the settings timestamp, and no scenario writes publication events, so the journal feed stays empty in the preview.
- R2 `uploaded` times, which the agreement retention sweep reads, come from R2 and use the real clock. No captured page shows them.
- Cookies use `Max-Age` and KV uses `expirationTtl`, both relative. Nothing sets an absolute `Expires` or expiry time from `Date`, so a pinned clock is safe there. Neither reaches an image.
- Turnstile's siteverify answer carries a real timestamp, and the site does not compare it with its clock.
- Intl's date formatting with no argument reads the real clock natively, so the capture process and the browser patch it. No code in the repo calls it that way today.

## Settling before a capture

After a page loads, `settle.mjs` decides when it is ready to photograph. A request counts while it is in flight, and the page is quiet once no counted request has started or finished for 500 ms. Requests to `challenges.cloudflare.com` (Turnstile's script) never count, because that script keeps requesting in the background. A `blob:` URL counts by the host it wraps, so the blobs Turnstile creates on that host are ignored too, while a blob of the preview's own origin counts. `data:` and `about:` URLs count.

If the page has a drawn `.cf-turnstile` widget, settle also waits until every drawn widget has a non-empty `cf-turnstile-response` input (read from the light DOM, since the widget's iframe is not reachable), then 500 ms more so the success state paints. A widget inside a hidden container (a later form step, a closed `<details>`) is not waited for: it is not in the image, and it may never get a token until someone opens it. Settling never takes more than 5 seconds, counted from its start; at that cap it checks the drawn widgets' tokens once, without waiting, adds `; turnstile token missing` to the reason if one has none, and the capture carries on as it is. `settle` returns its reason: `quiet`; `cap: N requests in flight, first <url>`, where a blob is named by its origin alone (such as `blob:http://127.0.0.1:4321`) and other URLs lose their query string and fragment, at most 120 characters; `cap: turnstile token`; or `stopped: <message>` when the page closed or errored while settling. The capture log prints its `Settle` lines after the `Timing` lines: one per reason that was not `quiet`, with how many captures hit it and the first file.

## Scenario seeds

`sql` in a scenario runs `wrangler d1 execute` against the local D1 database, one wrangler process per statement. Seeds go through wrangler, not a direct write to the D1 file, because a direct `node:sqlite` write once lost a seed row in CI.

## Timings

The capture log ends with `Timing` lines in the order each scope first ran, then a `total` line. The scopes are `pages` (marked `4 at once`, since four pages render together), then `reuse-check` (deciding which scenarios can be reused), then one line per scenario in file-name order (a reused scenario shows `1 reused` and 0.0s), then `inputs` (working out each scenario's source files). Each line gives seconds, counts such as captures and sql calls, then phases largest first: `goto`, `idle`, `fonts`, `prepare`, `screenshot` and `close` are parts of each capture, and `idle` is the settle wait described above. `context` is browser context and page setup, `sql`, `ownerFetch` and `stateHash` are scenario helpers, `replay` is the work of hashing the responses of each page: checking reused images, and hashing newly captured ones so later runs can reuse them, `graph` is reading the dev server's module graph in `inputs`, and `other` is the scenario's wall time that no phase covers.

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
