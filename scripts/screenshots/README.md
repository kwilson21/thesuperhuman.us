# Screenshots

CI runs these on pull requests that change the UI, and on the same changes once merged to `main` (see the `paths` list in `screenshots.yml`; server-only code, migrations and config don't trigger it), in two workflows:

- `screenshots.yml` runs the pull request's code with a read-only token. It captures the pages and scenarios and uploads the PNGs and `manifest.json` as an artifact.
- `screenshots-publish.yml` runs after it via `workflow_run`, always from the default branch. It finds the pull request from run metadata and skips the run if the PR has moved on to a newer commit. It accepts only PNG files with plain names that `verify-png.mjs` fully decodes, sanitizes the manifest, pushes the images to the `screenshots` branch and writes the table into the PR description, checking the PR head once more just before it writes.

Because `workflow_run` workflows only run from the default branch, a change to the publish step takes effect after it merges. `screenshots.yml` also runs every three days on `main`, and on demand, because GitHub deletes caches unused for seven days: that run keeps a recent reference for pull requests to reuse. A newer push waits for the capture in progress, which finishes and saves its images; GitHub keeps only the newest waiting run per group.

Run locally:

```sh
pnpm run screenshots:preview
MUSIC_PREVIEW_CONFIG=.screenshots/wrangler.json pnpm exec astro dev --config scripts/screenshots/dev.config.mjs --port 4321 --host 127.0.0.1
pnpm run screenshots   # in a second terminal; images land in screenshots/
```

`dev.config.mjs` is the site's Astro config plus a dev-only `/__screenshots/deps` endpoint that lists the server's module graph. Capture reads it to learn which source files each scenario used.

## Preview config

The preview config is built from `wrangler.jsonc`: the same compatibility settings, vars and binding names, with local D1, KV and R2 in place of every production resource. `PREVIEW_OVERRIDES` in `config.mjs` sets the vars below, each for the reason given; every other var is copied as it is:

- `SITE_ORIGIN`: the local preview address.
- `PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: Turnstile's always-pass test keys, since the production site key rejects localhost.
- `OWNER_ACCESS_TEAM_DOMAIN`, `OWNER_ACCESS_AUD` and `OWNER_EMAIL`: a throwaway Access issuer on `127.0.0.1:9911`, so owner pages render through the real JWT check.
- `AGREEMENT_RETENTION_BINDING_ID` and `AUDIO_CLIENT_CODE_KEY`: local values, so the agreement retention route is configured and studio codes can be issued.
- `AUDIO_CLIENT_PORTAL_ENABLED`: turned on, so gated pages can be reviewed before launch.

Nothing reaches production. The throwaway Access signing key is kept in `.screenshots/access-key.json` (gitignored), so a dev server that is still running keeps trusting the next run.

## Reusing unchanged images

CI keeps each run's images and `cache.json` in the Actions cache, and the next run on the same branch (or, failing that, the latest run on `main`) restores them into `.screenshots/reference`. `cache.mjs` decides what can be copied from there instead of captured:

- **A page** at one size is reused when every same-origin response it loaded (its HTML, CSS, scripts, images and data requests) is byte-identical when fetched again. A change anywhere in its code, content, data or Tailwind output changes one of those responses. Files Vite serves from `node_modules` are only checked for presence: their bytes vary between server starts, and they come from `pnpm-lock.yaml`, which recaptures everything when it changes.
- **A scenario** is reused when its script, the source files behind every route it requested (from the module graph, plus all of `src/content/` if it reads content collections) and the static files it loaded are unchanged. Scenarios run on the pinned clock (below), so the date a run happens on doesn't change their images. Requests an endpoint serves, such as owner-only images from an API route, count as routes, not static files. If a scenario was removed since the earlier run, every scenario runs. Scenarios share one database, so a scenario that changed the stored state is a writer: a scenario that runs first reruns every writer before it, and once a run writes differently from before, every later scenario runs.
- **Everything** is captured when the capture scripts, the dependencies, `astro.config.mjs`, `tsconfig.json`, `wrangler.jsonc`, the migrations, this workflow, Node or Chromium changed, when there is no earlier run, or when `SCREENSHOTS_FULL=1` is set. In a pull request, adding the `full-screenshots` label sets it.

A reused image skips that page's console and status checks; its inputs are the same as in the run that passed them. Locally, nothing is reused unless you copy an earlier `screenshots/` folder to `.screenshots/reference`.

## Pinned clock

`clock.mjs` freezes time at `CLOCK_BASE`, 12 November 2026 at noon UTC, so the same inputs give the same images on any date. The base is later than every date the scenarios treat as past and earlier than the dates they treat as still ahead. Noon UTC is 7 am in New York in November, so a run never crosses a date line in either zone.

Time only moves when capture moves it, one step at a time. A step is one second (`STEP_MS`), and `stepTime(step)` gives its instant. Every page capture runs at step 0, since pages only read data. Each scenario starts at step 0, and each `capture` and `ownerFetch` call it makes moves on one step before it does anything. A `sql` call moves the step too, but only the capture's own clock; the dev server catches up at its next `capture` or `ownerFetch`. So every time a page shows depends only on the scenario's script and its position in it, not on how long anything took to run. Real elapsed time never reaches the clock, so a slow run and a fast run produce the same images.

The pin covers three processes. The capture process starts frozen at the base, since `clock-install.mjs` is its first import. The dev server does the same (`dev.config.mjs` imports it first), and capture sets it with `POST /__screenshots/clock` (`{ "now": <ms> }`), so the site's server code and the rows it stamps see the step's time. Pages that capture opens on the preview's own origin are frozen at the capture's clock when each page is set up, through an init script (`browserClockScript` in `clock.mjs`), so the page and the server agree. Third-party frames, such as Turnstile's, keep the real clock. The owner token expires one hour after step 0, so a scenario may not go past 50 minutes of steps; capture stops with an error when one would.

Times are ordered only within a scenario, since each scenario starts again at the base time. A scenario's steps must run one after another: the step guard throws when a `capture` or `ownerFetch` starts while another one's clock request is still in flight, and since it does not cover `sql`, scenario code must await each `capture` and `ownerFetch` before its next `capture`, `ownerFetch` or `sql` call. Turnstile's own frames keep the real clock, while its script in the page sees the pinned one. After a run, the dev server stays at the last step's time until it is restarted or set again.

Changing `CLOCK_BASE` recaptures everything, because `scripts/screenshots` is a global input.

What still reads the real clock, and whether it reaches an image:

- Two migrations default a column with SQLite `strftime('now')`: `migrations/music/0023_software_signing.sql` (the signing settings row's `updated_at`) and `migrations/publication/0001_publication_journal.sql` (`published_at`). Neither reaches an image. No page shows the settings timestamp, and no scenario writes publication events, so the journal feed stays empty in the preview.
- R2 `uploaded` times, which the agreement retention sweep reads, come from R2 and use the real clock. No captured page shows them.
- Cookies use `Max-Age` and KV uses `expirationTtl`, both relative. Nothing sets an absolute `Expires` or expiry time from `Date`, so a pinned clock is safe there. Neither reaches an image.
- Turnstile's siteverify answer carries a real timestamp, and the site does not compare it with its clock.
- Intl's date formatting with no argument reads the real clock natively, so the capture process and the browser patch it. No code in the repo calls it that way today.

## Settling before a capture

After a page loads, `settle.mjs` decides when it is ready to photograph. A request counts while it is in flight, and the page is quiet once no counted request has started or finished for 500 ms. Requests to `challenges.cloudflare.com` (Turnstile's script) never count, because that script keeps requesting in the background. A `blob:` URL counts by the host it wraps, so the blobs Turnstile creates on that host are ignored too, while a blob of the preview's own origin counts. `data:` and `about:` URLs count.

If the page has a drawn `.cf-turnstile` widget, settle also waits until every drawn widget has a non-empty `cf-turnstile-response` input (read from the light DOM, since the widget's iframe is not reachable). After the token arrives, the widget's size must hold still through the 500 ms paint pause: the container and its light-DOM descendants are read every 50 ms, and the last 200 ms of the pause must show no change. A change restarts that 200 ms and extends the wait past the pause, so a resize during the pause is seen. The wait ends no earlier than the pause would have. The Turnstile frame can resize as its content loads, so a token alone does not mean the widget has its final size.

The size check has a limit. It measures the widget container's own box and the elements in its light DOM. It cannot see inside a closed shadow root or a cross-origin frame, so a reflow that happens only inside the widget's frame, without changing the container's box, is not detected. The check does not claim more than that.

A widget inside a hidden container (a later form step, a closed `<details>`) is not waited for: it is not in the image, and it may never get a token until someone opens it. Settling never takes more than 5 seconds, counted from its start. At that cap it checks the drawn widgets' tokens once, without waiting, and the capture carries on as it is. `settle` returns its reason:

- `quiet`: the page settled in time.
- `cap: N requests in flight`, followed by `, first <url>, response <status>` or `, first <url>, no response` when a request is pending. The response part says whether the first pending request's response had arrived and its status, so a request that is pending after its response is distinguishable from one that never got one. A blob is named by its origin alone (such as `blob:http://127.0.0.1:4321`); other URLs lose their query string and fragment, and the named URL is at most 120 characters.
- `; turnstile token missing`, added to a cap reason when a drawn widget has no token.
- `cap: turnstile token`: the cap ran out while waiting for a widget's token.
- `cap: turnstile size`: the cap ran out while a widget's box was still changing: it changed within the last 200 ms before the cap.
- `cap: turnstile paint`: the cap ran out with no time left to confirm the box. Either the box never changed, or it changed earlier and held still to the cap. The reason names the time that ran out, not a size change.
- `stopped: <message>`: the page closed or errored while settling.

## Images

Full-page captures include every image's height, so an image that has not loaded or decoded changes the page's pixels. Before each capture, `images.mjs` makes every `img[loading="lazy"]` eager (a property change, so the page is not scrolled), waits until every image is complete, and then decodes the loaded ones. A broken image is complete too, so it does not hold the wait. The wait is capped at 3 seconds, and the decode runs under the same cap (it is raced against the time left, so a decode that never ends cannot hold the capture). At the cap the capture goes on and logs a `Settle images:` line with how many images were still loading and the first one's URL without its query string; a decode that is still running at the cap logs `Settle images: decode still running at cap`. The time is the `images` phase in the timings.

A navigation during the wait only matters when it interrupts one of the wait's page reads; the wait for images to complete carries on through a navigation by itself. When a read is interrupted, the outcome depends on the capture. A capture with no `prepare` step waits for the page's load, logs `Settle images: page navigated during the wait`, and retries the whole image wait once with a fresh cap. A capture with a `prepare` step fails with a message naming it, since a reload would photograph a page that lost its prepared state. A second navigation on the retry, or any other error (such as the page closing), fails the capture with a message naming it too.

The capture log prints its `Settle` lines after the `Timing` lines: one per reason that was not `quiet`, with how many captures hit it and the first file.

## Randomness and generated values

Two sources of variation between runs are fixed in the capture tooling, not in the site:

- `random.mjs` gives the preview's own pages a seeded `Math.random` (mulberry32, one fixed seed), installed before any page script runs. The 404 page picks one of two scenes with `Math.random() < .5`. The default seed's first draw is about .327, so the horizon scene is always photographed. The `not-found-wave` page entry captures the same page with `WAVE_SCENE_SEED`, whose first draw is about .510, so both scenes are covered: `not-found-desktop.png` (horizon) and `not-found-wave-desktop.png` (wave). Other origins (Turnstile's frames) keep real randomness, and `crypto.randomUUID` and `crypto.getRandomValues` in the browser are not touched.
- The server makes new random ids when it builds an agreement, and the SOW number and the SHA-256 of the SOW text depend on them. The site's code is not changed and the server process is not shimmed. Instead, `fixDisplayedAgreementIds` in `agreed-terms.mjs` shows a fixed fictional SOW number (`SOW-00000000-0000-4000-8000-000000000009`) in the guided terms reader. It replaces a document's hash with a fixed hash (`0123456789abcdef` repeated four times) only when that document's own legal text held the generated number. The MSA's text has no SOW number (its template has no `sow.number` field), so its real hash is stable and is left alone; no two documents on screen share a hash. Only the SOW varies, so one fixed hash covers it. The stored agreement is unchanged, and only the image shows the fixed values. Only one capture carries the caption note: `guided-full` in `software-signing.mjs`, which opens every term with the documents' hashes shown. The project scenario's `agreed-full` is signed outside the website, so its image shows no SOW number or hash and has no note. The collapsed review stages show no hash either, so they have no note. A test in `tests/scripts/screenshot-fixed-ids.test.ts` fails if the note moves.
- The SOW's text also appears in the signing page's `pre.agreement-text` (`SoftwareAgreedTerms.astro`), but only inside that page's terms reader, which is closed until a visitor opens it. No capture opens it, so no image shows that text.

## Audio player waits

The studio's project players show `0:00` until the audio's metadata has loaded, then `0:00 / <duration>`. `media.mjs` waits for the metadata first. If the metadata has not loaded within 15 seconds, the capture fails with a message naming the metadata wait. The capture then dispatches the same `loadedmetadata` event the page listens for, so the page's own render runs, and waits until every label shows its duration. If that second wait times out, the capture fails with a message about the label, not the metadata.

This is a workaround for an open site bug, not a fix. `src/scripts/project-player.ts` only renders the label on `loadedmetadata`, `timeupdate` and `ended`. If the metadata loads before the script attaches its listener, the label stays at `0:00`, and the load-error message is hidden by the same race. The owner has not yet decided whether to fix the site, so the workaround stays. The screenshot therefore shows the label a visitor sees when the race does not happen. It does not show the bug.

## Scenario seeds

`sql` in a scenario runs `wrangler d1 execute` against the local D1 database, one wrangler process per statement. Seeds go through wrangler because it is the supported route to the local D1 database; a direct `node:sqlite` write lost a seed row in CI.

## Timings

The capture log ends with `Timing` lines in the order each scope first ran, then a `total` line. Each capture has an `images` phase (the wait in `images.mjs`). The scopes are `pages` (marked `4 at once`: four captures run together, so its phases add up to more than its seconds and it has no `other` entry), then `reuse-check` (deciding which scenarios can be reused), then one line per scenario in file-name order (a reused scenario shows `1 reused` and 0.0s), then `inputs` (working out each scenario's source files). Each line gives seconds, counts such as captures and sql calls, then phases largest first: `goto`, `idle`, `fonts`, `prepare`, `screenshot` and `close` are parts of each capture, and `idle` is the settle wait described above. `context` is browser context and page setup, `sql`, `ownerFetch` and `stateHash` are scenario helpers, `replay` is requesting a page's or a scenario's recorded URLs again and hashing the answers: checking reused images, and hashing newly captured ones so later runs can reuse them, `graph` is reading the dev server's module graph in `inputs`, and `other` is the scenario's wall time that no phase covers.

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
