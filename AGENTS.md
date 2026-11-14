# Website agent instructions

Read the existing [CLAUDE.md](CLAUDE.md) for repository guidance.
For code changes, follow [docs/coding-approach.md](docs/coding-approach.md).
For public output, apply [docs/publication-agent-protocol.md](docs/publication-agent-protocol.md).
For generated or AI-edited website images, follow [docs/generated-image-qa.md](docs/generated-image-qa.md). Layout approval does not replace production asset QA.
General philosophy is permitted; private operational recipes remain excluded.
Existing checks, permissions, and review requirements still apply.
UI pull requests follow the screenshot rule in [CLAUDE.md](CLAUDE.md): review the CI screenshots, and add a scenario in `scripts/screenshots/scenarios/` for any new stateful flow.

Every pull request follows the review rule in [CLAUDE.md](CLAUDE.md): without a Greptile review of the current head, run independent review agents on the diff. Whichever reviewer ran, fix each verified finding and review the new head again until a pass finds nothing, then merge with CI green. Never merge publicist pull requests (hard rule 1 below), and follow the Website deployment gate, because merging to `main` deploys production. Findings that need a product or design decision go to the owner.

## Design standard

UI work follows [Hallmark](https://github.com/nutlope/hallmark) (MIT, by Together AI and the Hallmark contributors), vendored unmodified at `.agents/skills/hallmark/` with its `VENDORED.md`. The root [design.md](design.md) overrides its defaults. Before asking for review of a UI pull request, run `hallmark audit` read-only on the changed pages and fix the defects it finds; design-choice findings go to the owner as alternatives. Follow [docs/design-standard.md](docs/design-standard.md). For future projects, copy this approach and add this instruction to their existing agent guidance.

## Website deployment gate

Before deploying a website, follow [the reusable pre-launch Definition of Done](docs/prelaunch-checklist.md). Record PASS, FAIL, UNVERIFIED, or justified N/A for every applicable check. Code completion is separate from deployment and live verification. For future website projects, copy this checklist and add this instruction to their existing agent guidance.

## Project journal continuity

Read `docs/project-journal.md`. At task start and after compaction, run
`python3 scripts/development_journal.py status`. At meaningful outcomes and before
finishing, append a checkpoint without requiring an explicit logging prompt.
Keep the existing project startup, roadmap, shutdown and publication rules.
A fresh chat is not required each day. Daily thematic names belong to the day
record; conversation titles remain independent browsing labels.

Use actual timestamps in America/New_York. A conversation is not a day: record
known provider/ID and any verified private conversation URL; several conversations
may contribute to one day and a conversation may span many days. Never fabricate
links, scrape transcripts or rename chats to establish chronology.

Choose grounded themes when the outcome supports them. Leave series and season
null until enough recorded history supports coherent groupings; never require
names at bootstrap or invent a phase to fill a field. Review accumulated outcomes
over time, then record the reasoning for inferred series/seasons and update
`docs/journal-context.json` for future checkpoints. These are development groupings,
never curriculum seasons or claimed completion. Preserve earlier classifications
and uncertainty in history; correct by appending.

Nominate meaningful artifact files in checkpoint context, including dependencies
needed to reopen an interactive artifact. The logger saves private copies and
hashes, then rebuilds its day/conversation/theme/series/season index. Save actual
code references, tests, limitations and next work; don't manufacture evidence.

When the date changes during work, finish the bounded task or checkpoint a safe
pause, summarize the prior observed day and carry unfinished work forward. Do not
mark another agent's work complete or create entries for inactive days. If the
project has `journal_hooks.py`, use its existing day-reconciliation protocol.

Private journaling is separate from public publication. Use only the existing
reviewed publication transport, revision checks and receipts. Never publish raw
chat links, journal files or artifacts merely because they were saved. Preserve
corrections/withdrawals and retry the exact accepted identity as required there.

Do not claim hooks, timers, ChatGPT memory or a prompt guarantee automatic durable
writes. Report observed runtime capabilities and pending delivery honestly.

## Back-end rules

Owner decisions, 2026-11-12; the full text is "Back-end rules" in [CLAUDE.md](CLAUDE.md).

- Business logic does not live in SQL strings. A rule is XState alone (states and moves, asked through `next()`), the `@xstate/effect` bridge (a move that waits on Stripe, Resend or R2), or Effect alone (no states), as in kwilson21/tally. SQL keeps only the compare-and-set guard.
- Effect `Schema` is the single server input validator. Many files still import Zod today; when the conversion is finished, Zod remains only in `src/lib/publication/mcp.ts`, `src/pages/api/mcp-probe.ts` and `src/content/config.ts`, where a library requires it. The validators the browser and the server share (the audio intake, the software inquiry and the agreement client details) are Effect Schema through `src/lib/fields.ts`, and so are the owner agreement schemas (the details, the contractor's details and the owner's agreement requests, through `src/lib/readers.ts` and `src/lib/agreement-owner-input.ts`); `tests/server/validators-differential.test.ts` holds each to the Zod 3 schema it replaced (frozen in `tests/fixtures/legacy-validators/`).
- Only Effect Schema reaches the browser, through the shared field helpers in `src/lib/fields.ts` and for synchronous decoding only (no `Effect.gen`, service or `Layer`); the rest of Effect, `src/server/**` and the server-only packages never do. What is enforced: the source walker fails on any effect module not on `ALLOWED_BROWSER_EFFECT_MODULES` and, from the syntax tree in every reachable file and entry, on any use of a Schema function named `decode*`, `encode*`, `validate*`, `asserts*` or `make*Effect` that is not on `ALLOWED_SCHEMA_RUNNERS` (`decodeUnknownResult`, `decodeUnknownSync`, `decodeResult`, `decodeSync`, `decodeUnknownOption`, `decodeOption`, `is`, `asserts`; the combinators `decode`, `decodeTo`, `encode`, `encodeTo` and `encodeKeys` build a schema and are not refused), reached by a named import, an alias, the namespace by name or by string literal, a re-export, a computed member, the namespace used as a value, or a dynamic `import()` or `require`, and on `toStandardSchemaV1`, `toStandardJSONSchemaV1`, `toEncoderXml` and any `["~standard"]` access (a standard schema's `validate` can answer with a Promise; the other `to*` converters build a schema, formatter or equivalence and are allowed); and the bundle test fails on the Layer, Scope and Deferred runtime. What stays convention: a schema that carries an effect through an allowed module (for example `SchemaGetter.transformEffect`), and `Effect.gen` or services inside a module the walker allows, are not detected; review them. The `src/lib` modules browser code imports are pure, and a module that mixes in invoicing, mail, sessions or storage is split first. `tests/architecture/client-graph.test.ts` walks the source import graph from every browser entry (`src/scripts/**` and every `.astro` file with a `<script>`, including its `src=`) through relative paths, `tsconfig.json` `paths` aliases (every target of each), `package.json` `imports`, `import.meta.glob` and `new URL(..., import.meta.url)`, and fails on a load of an effect module that `ALLOWED_BROWSER_EFFECT_MODULES` (`tests/helpers/client-graph.ts`) does not name (it names `effect/Schema`, `effect/SchemaGetter`, `effect/SchemaIssue`, `effect/Result` and `effect/Predicate`; the bare `effect`, `effect/Effect`, `effect/Layer` and `effect/Context` fail), `@effect/*`, `@xstate/effect`, `xstate`, `zod` (any version, `astro/zod` and `astro:schema` included), `stripe`, `resend`, `pdf-lib` or `src/server/**`, on a load it cannot resolve statically, on a bare specifier that is not a package under `node_modules`, and on an imported package whose `dependencies`, `peerDependencies` or `optionalDependencies` (followed transitively) include any of those packages. A root-relative `<script src="/x.js">` is read from `public/`. It also fails when the set of `src/lib` modules a browser entry reaches differs from the reviewed allowlist `BROWSER_MODULES` (`tests/helpers/browser-modules.ts`, plus the files it reaches that the bundler drops) (split a server module that leaks in), when any package but `effect` is reached, when the effect modules reached source imports differ from `ALLOWED_BROWSER_EFFECT_MODULES`, when any reached file or browser entry loads a Node built-in (`node:*` or a bare name such as `fs`), `cloudflare:*` or `astro:env/server`, and when one names `D1Database`, `R2Bucket` or `KVNamespace` or makes a `.prepare(` call (read from the syntax tree, so comments, strings, property keys and member names never count; a package named like a Node built-in such as `events` or `buffer` fails on purpose and needs an explicit allowance, an Astro virtual module such as `astro:transitions/client` fails as unresolved today, and the `.prepare(` check flags any `.prepare(` call in browser-reachable code by design). The reached set includes data files a reached module imports (JSON, or `?raw` and `?url` imports such as `.txt`, `.svg` and `.css`), and a file of an installed package reached by a relative path or alias into `node_modules` counts as that package. Any `client:*` hydration directive in an `.astro` file fails outright (read as an attribute name on a tag with Astro's compiler, so text, attribute values, comments and script blocks never count), because a hydrated component is browser code the walk does not read and the site has no UI framework (extend the walk before introducing one). The allowlist covers the modules under `src/lib` and `src/data`; the other checks cover every reached file and every entry. A D1 handle typed through some other interface and run through a method other than `.prepare(` is not found, so a module added to the allowlist must be read for server work. `tests/architecture/client-bundle.test.ts` is the guarantee: the client build itself, through the Vite plugin `scripts/client-bundle-manifest.mjs`, records every module it puts in each browser chunk (the small page scripts Astro inlines into pages included) in `.astro/client-bundle-manifest.json`, which is gitignored and outside `dist/`, so it is neither served nor deployed. The test requires every repository file in that list other than the browser entries (`src/scripts/**` and `.astro` files), not only `src/lib` and `src/data` modules but also a `package.json`, `src/styles/global.css`, a `public/` svg or a `?raw` JSON import, to equal `BROWSER_MODULES` and the installed packages to equal `BROWSER_PACKAGES` and the virtual module ids (`\0...`, `astro:...`, `virtual:...`) to equal `BROWSER_VIRTUAL_MODULES` (all in `tests/helpers/browser-modules.ts`; today `effect` and no virtual module), and fails on `@effect/*`, `@xstate/effect`, `xstate`, `stripe`, `resend`, `pdf-lib`, `zod` (any version), any `src/server/**` file, any `node:` or `cloudflare:` module, and a file outside the repository. Each module label carries the installed version of its own package directory, so every version that supplied code is checked (Zod 3 and Zod 4 both fail). A manifest that does not match `dist/` fails: every `.js` or `.mjs` file under `dist/` outside `dist/_worker.js/` must match a manifest chunk by hash or be a copied public script listed with its hash in `PUBLIC_SCRIPTS` (none today); every chunk Astro inlined into a page must match, by hash of its full text, an entry of the server manifest's `inlinedScripts`, and every such entry must match a recorded chunk; and with `dist/` present but no manifest the test fails. The manifest check allows the whole `effect` package (`effect` is in `BROWSER_PACKAGES` and the prefix `npm:effect@` is in `ALLOWED_FORBIDDEN_PREFIXES` in `tests/helpers/client-manifest.ts`), because `effect/dist/Schema.js` imports about 68 other effect modules; which effect modules browser code may import stays a source-level rule that the walker carries. The same file also checks every built browser script under `dist/` (`.js` and `.mjs`, including scripts copied from `public/`, but not the server output `dist/_worker.js/`) for any `~effect/<Name>` type id that an Effect Schema bundle does not hold (23 are allowed; `~effect/Layer`, `~effect/Scope` and `~effect/Deferred` fail), `EffectFailure`, `api.stripe.com`, `Stripe-Version`, `$ZodType` (Zod 4), and `ZodString` and `ZodEffects` (Zod 3). It skips without a build, so run `pnpm run build` first; CI runs it in a step after the build with `REQUIRE_CLIENT_BUNDLE=1`, which makes a missing `dist/` fail. The source walker is a fast approximation that runs in plain `pnpm test`; it can differ from what the bundler includes (it reaches a file the bundler tree-shakes away), so when the two disagree the bundler's manifest is right, with one limit: Vite builds a Web Worker in a separate Rollup run the plugin is not part of, so the manifest fails outright on any `?worker` or `?sharedworker` import or any chunk that constructs a `Worker` or `SharedWorker`, and the guard must be extended before workers are introduced.
- Import each Effect module by its own path (`effect/Effect`, `effect/Schema`), never from `effect`; `tests/architecture/effect-imports.test.ts` fails on a bare `effect` import.
- Where code goes, for every area after the first (the contact and resume routes are the model; the full text is in CLAUDE.md). (a) A decision over facts that are all read before it is a pure rule in `src/server/rules/`, written with `rule({ given, refusals, writes })` from `src/server/terms.ts`, with no effects. (b) A sequence that must act between decisions (rate-limit count, then captcha, then send, then delete) is a separate Effect program in `src/server/flows/`, which only calls services and pure rules and builds no response text. (c) Storage or an outside call whose failure the route must answer goes through a named service using `Effect.tryPromise` with a `Data.TaggedError`; `Effect.promise` only where a defect (an unanswered 500) is intended, with a comment saying so. (d) The route maps every refusal with `Effect.catchTags`, so the program reaches `runRoute` with error type `never`. (e) Only `catchTags` and `Effect.ignore` on named failures; never a catch-all. (f) A `Data.TaggedError` never has a field named `name`, `message`, `stack` or `cause` (`tests/architecture/tagged-errors.test.ts`) and carries no HTML; text is escaped where the page is built. (g) `legacyBindingsOrDefect` is only for the three contact and resume routes (`tests/architecture/legacy-bindings.test.ts`); later routes use `bindingsOrUnavailable`.
- Rule files, stores and answers (the public music routes are the model; the full text is in CLAUDE.md). A rule file in `src/server/rules/` opens with a comment on what it decides, from which facts and which guard re-checks it at write time, exports its refusals as `Data.TaggedError` classes with a `say` sentence, and is built by `rule({ name, given, nothingToDoIf, refusals, writes, writesText })` (or `alwaysWrites({ name, given, refusals, writes, writesText })` when there is always something to write); it reads no clock, store or random id (time and ids are inputs). Storage is one store file per area (`src/server/music-store.ts`): one function per statement over the binding service, `Effect.tryPromise`, plain SQL, a rejection becomes `...StoreFailed`; a unique constraint a rule's facts depend on becomes `ChangedSinceRead` so `decideAndSave` reads again. Owner decision 2026-11-14: an unexpected store failure answers 500 with the route's fixed sentence (never the error's text, mapped explicitly in `catchTags`), a lost race or stale version is 409, 503 only for a missing binding or a known unavailable dependency. Outside effects are services (`OwnerAlert`, `Turnstile`, `Mail`); a rate limit count with a named failure is `countRequest` in `src/server/flows/rate-limit.ts`. A route's fixed answers (`musicUnavailable`, `musicFailed`) live next to `musicRequest` in `src/lib/music-request.ts`; a converted route passes `{ route, answer }` as the third argument of `runRoute` so a defect is logged once through `logUnexpected` and answered with the same fixed sentence. A converted area freezes its Zod schemas in `tests/fixtures/legacy-validators/` (`tests/architecture/legacy-validators.test.ts` asserts the directory's exact file list) and adds a differential block.
- Golden fixtures: a conversion may re-record a fixture only when `pnpm run golden:neutral` passes, in its own commit. Neutral: identical responses, identical digests (per table of both databases, R2 and KV after each step; both databases and the set of tables written at the response and at every outside effect) and non-D1 effects in order; only D1 statements differ. A conversion pull request carries the `conversion` label and its CI (`Golden neutrality`, which runs the base revision's copy of the tool) fails unless every case is neutral, though the check is not a required status check unless the owner makes it one and it does not see a write that changes no row moved across an effect, or an effect moved past a read only; a behaviour fix does not carry it, explains each changed case, and goes in its own pull request first (CI judges the whole pull request, and there is no allowance for an effect whose state differs). The three older recorder fixtures (contact, resume-request, resume-approve) carry no digests. A declared failure or race that never fires fails its case. See `tests/golden/README.md`.
- No ratchets or legacy lists: an area is converted completely. Five database triggers still write (issue #242); each is named in its area's rule file until moved.
- Design-time verification ([docs/verification.md](docs/verification.md)): new features and plans use XState diagrams. A new flow where order or timing matters (webhooks, queues, read-then-write) gets a Quint model before its code. A pure money rule gets a LemmaScript contract. A model's mutants (the real bugs, kept in the model) must fail in CI, and the driver fails if a property has no mutant, so a new property needs a mutant that breaks it. Run the manual Apalache check (`pnpm run verify:quint:exhaustive`) before changing a modelled rule.
- Pins, exact: `effect` 4.1.4, `@xstate/effect` 1.0.0-alpha.12, `xstate` 6.0.0-beta.1, `@informalsystems/quint` 0.33.1, `lemmascript` 0.6.6 (dev only).

<!-- publicist:hard-rules:start (generated by pnpm run publicist:sync; edit .agents/skills/publicist/SKILL.md instead) -->
## Publicist hard rules

Apply these whenever work touches publicist journal entries, `publicist/`, or social posts. Full instructions: `.agents/skills/publicist/SKILL.md`.

1. **Nothing goes public without approval.** Your outputs are pull requests: a
   private review-note PR and a public website PR. Never merge either, never
   deploy, never post to any social platform, never call `publish_project_update`.
   Automated posting exists only for a platform whose `autopost` flag the owner
   set to `true` in `publicist/config.json` through a merged PR, and it is done by
   that separate poster, not by you.
2. **Every public item needs a verified private review note.** Before any change is
   drafted for the website or social posts (new work and every backfill entry
   alike), write its review note in the private repository (see "Review notes").
   Publish an entry only from the note's Draft entry once the owner has marked it
   `verified` or `corrected`, and only when the owner's decision on the note is
   `publish: yes` and its whiteboard-defense readiness fits its tier (`shipped`
   needs `ready`; `not yet` holds the entry; `exploration` needs
   `not applicable`). The public entry is the approved draft, changed only for
   formatting, and posts say no more than it. A claim the owner struck or that
   appears only in the detailed answers is held, not published and not softened
   into something vaguer that implies the same thing.
3. **Review notes stay private.** Never copy, quote, summarize or link a note's
   content into website content, social posts, public PRs, public commit messages,
   issues or logs. In public places, refer to a note only by its entry ID.
4. **Never certify the owner's understanding.** The owner's whiteboard defense
   standard (design doc, section 3) is theirs to meet. Notes prepare the owner for
   review;
   the owner's own review and words are the review. Do not write, in any note or
   public text, that the owner can explain, defend or has reviewed something unless
   the owner's own words say so.
5. **Tally uses demo data only.** Use the seeded fictional household, CI
   screenshots from the `screenshots` branch, local `wrangler dev` runs seeded
   through the scheduled handler, and the public demo once it is live. Never use
   production bindings, the `production` environment, Plaid, Cloudflare Access, or
   anything about the owner's family finances. If a capture lacks the
   "Demo data" banner, do not use it.
6. **No secrets.** No tokens, keys, passwords, cookies, `.dev.vars`, Wrangler
   secrets, OAuth values, private URLs, private file paths or internal hostnames in
   any entry, image, video frame, caption, alt text, commit, post or review note.
   Check address bars, consoles and terminal text in every capture.
7. **Public repositories only.** Cover only repositories listed in
   `publicist/config.json` `projects`. A private repository is excluded unless the
   owner added it there by name. The private publicist repository is read for
   exports and review notes only.
8. **Only claim what the record supports.** Every "why" comes from a PR
   description, spec, plan, decision, roadmap, design-studies log, the project's
   `docs/journal/intent.md`, an owner-approved export note, or the owner's own
   statements recorded in a review note. If no source states it, leave it out. Report the status the work
   actually had at the time (planned, built, tested, available). Attribute AI
   assistance truthfully, per commit trailers and the owner's statements.
9. **Respect the project's tier.** `publicist/config.json` records each project as
   `shipped` (customer-facing) or `exploration` (PoC, demo, experiment). Never
   describe exploration work as production-ready, hardened or customer-facing.
10. **Leave out anything personal**: family members, health, real money amounts,
    locations, and other people's names unless they are already public credits.
11. **No commercial game assets.** Never fetch, store or show ROMs. Kaillera-next
    gameplay media comes only from the owner.
12. **Music needs verified rights.** Sound videos and releases use the release note
    in the template. Nothing about a recording is published until its credits and
    rights to publish are verified. Use only music the owner has the right to
    publish, including for background beds.
13. **Unreleased videos stay private.** A video's script, captions, metadata,
    thumbnail and preview go only to the private repository and a private bucket
    with expiring links. Nothing about it enters a public PR until the owner has
    released the video.
14. **One publicist, per-channel playbooks.** Follow `docs/publicist/channels/`
    for each channel's format and cadence. Never operate a platform's website or
    app on the owner's behalf; where there is no API, prepare a checklist for the
    owner.
<!-- publicist:hard-rules:end -->
