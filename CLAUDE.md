# Claude Code: The Superhuman Group LLC Website Agent

## Who You Are Working With

You are working on the personal website of **Kazon Wilson**, who also operates **The Superhuman Group LLC**, a Wyoming LLC through which he can undertake independent work. His current direction is software engineering: shaping and building useful software, using modern tools carefully.

The September 2026 redesign direction in [docs/website-direction.md](docs/website-direction.md)
and [docs/website-content-model.md](docs/website-content-model.md) supersedes the
original contractor-only positioning. The site introduces the person, interests,
and evidence of work. Kazon works independently, through contracts and projects,
and is selective about full-time roles. The [system plan](docs/website-system-plan.md)
describes the implementation in the redesign PR stack; deployment is a separate decision. All generated website imagery must
pass [image QA](docs/generated-image-qa.md).

## About Kazon

- **7+ years** professional software engineering experience
- **Background:** Lyft, Sure (Toggle homeowners insurance), Axuall/Vendorpass (contract), Scotch Inc.
- **Current direction:** building useful software, with room to shape solutions, prototype, iterate, and stay close to how people use the result. He welcomes ideas from collaborators; choosing the original idea is not a requirement.
- **Professional background:** Python, ETL pipelines, data engineering, backend API development. This establishes credibility; do not advertise data engineering as his desired next specialization.
- **Regulated industry experience:** Healthcare credentialing, insurance document systems
- **Website design:** Page structure, visual storytelling and responsive implementation. The personal website redesign is the current portfolio example; do not imply a history of client design projects.
- **Also works in:** Ruby on Rails, TypeScript, Django, Flask, PostgreSQL, AWS
- **Infrastructure depth:** Docker Swarm, Traefik, Tailscale, Cloudflare, OPNsense, self-hosted everything
- **Side projects:** Kaillera-next (retro gaming netplay platform), Kova (custom ETL programming language), Frigate NVR, personal home cluster
- **Audio engineering:** Undergraduate degree in audio production from MTSU, still actively practiced (RME Babyface Pro, Sennheiser HD 650s, UAD Luna + Pro Tools)
- **Location:** Use current owner-confirmed evidence. Do not revive a relocation plan from historical guidance.
- **Contracting style:** Async-first, deliverable-focused, fixed-price engagements, full tool discretion (he chooses the stack)

## About the Website

- **URL:** thesuperhuman.us
- **Stack:** Astro 5, TypeScript, Tailwind CSS, Cloudflare Workers + Static Assets, Resend, Turnstile, Cloudflare KV
- **Resume delivery:** Approval-gated. PDFs stored in Cloudflare KV, emailed only after operator approval
- **New resume requests use the general variant only.** The public version picker and incoming DoD requests are retired in the local redesign. Approval and delivery still support stored legacy requests through `pdf:general` and `pdf:dod`; neither stored requests nor PDFs were migrated or deleted.

See `README.md` for environment variables, KV bindings, the full resume request flow, deployment commands, and OG image regeneration. Don't duplicate that information here.

## Positioning & Brand Voice

- **Person and interests first.** Show what Kazon cares about, makes, and contributes. Make professional evidence easy to assess. Present independent work (contracts and projects) as the default and full-time as selective: roles where he owns the work end to end, either fully remote or in person near Roanoke, Virginia. Don't turn every page into a services pitch.
- **Tone:** Direct, confident, technically specific. No fluff, no buzzwords
- **Explain actions where understanding matters.** Follow the [copy and resume parity rules](docs/website-content-model.md#copy-explain-the-action-when-visitors-need-to-understand-the-work): explain who does what in introductions, offers and project summaries. Keep useful labels and preserve the purpose of personal or creative writing. Compare shared professional facts with the current approved resume; richer verified website detail is allowed.
- **Audience:** curious visitors, potential collaborators, recruiters, and hiring managers
- **Key differentiators:**
  - Lyft pedigree
  - Regulated industry experience (healthcare, insurance)
  - Production engineering experience, with modern tools used carefully
  - Async-first, results-focused working style
  - Interest in shaping solutions and seeing ideas become useful software

### Clearance posture

No active security clearance, but open to pursuing one for the right engagement. The redesign retires the DoD-focused resume option. Never write copy that implies current cleared status (e.g., "TS/SCI cleared engineer," "active clearance"). If a client asks about clearance in a request, route them to the contact form. That's an operator-handled conversation.

## Working Principles

- **Privacy.** Kazon's personal home address never appears in public-facing content. The business address is The Superhuman Group LLC's Wyoming registered agent address.
- **Engagement model.** All contracts are **fixed-price, deliverable-based**, never hourly. Never add hourly rate copy anywhere.
- **AI stance.** Kazon is not "pro AI"; he keeps up with how the field is changing and must never read as a careless "vibe coder." His approved standard line (2026-10-20): "I use Claude Code to keep up with how the field is changing, but I treat it like a junior pair: I make the design decisions, read every line it writes, and nothing ships without tests." Summary lines say he makes the design decisions and reviews every change, and Claude Code helps with implementation. Never write that AI writes or builds the work on its own. The Work page and project journals describe AI collaboration at a high level. Keep attribution truthful without publishing private operational recipes.
- **Async communication is preferred.** Reflect this in contact/engagement copy.

## Rate Context

Software rate context lives in `CLAUDE.local.md` (gitignored). Keep software rates private. The owner approved public audio starting prices: $150 two-track vocal mixing, $75 mastering and $200 vocal mix plus master. Custom audio work is quoted after review.

## Historical capabilities

These describe prior capabilities, not a service menu to promote. Lead with the current building direction and preserve specific experience as supporting evidence.

1. **ETL Pipeline Architecture & Development**: Python, multi-source ingestion
2. **Backend API Development**: Django, Flask, Python, REST, gRPC
3. **Data Systems & Infrastructure**: PostgreSQL, MySQL, AWS, data platform builds
4. **Healthcare & Regulated Industry Systems**: credentialing pipelines, insurance document systems
5. **Full Product Builds**: end-to-end backend and data layer for MVPs and full products
6. **Audio Engineering**: mixing, mastering, production (separate service line under the LLC)

## Repository Structure

- `src/`: Astro pages, components, layouts, content collections
- `public/`: Static assets and `_headers`
- `docs/superpowers/`: Design specs and implementation plans from the original build (`specs/`, `plans/`)
- `scripts/`: OG image generation and utilities
- `wrangler.jsonc`: Cloudflare Worker config, KV bindings, non-secret env vars

## Publicist

Publicizing Tally, Kaillera-next and website work follows the design in
[docs/publicist/README.md](docs/publicist/README.md). Its rules are always loaded:

@.agents/skills/publicist/SKILL.md

## Design standard

[Hallmark](https://github.com/nutlope/hallmark) (MIT, by Together AI and the Hallmark
contributors) is the standard for UI work. It is vendored unmodified at
`.agents/skills/hallmark/`, credited in README.md, and reached through the
`.claude/skills/hallmark/` pointer. The root [design.md](design.md) is this site's locked
system and overrides Hallmark's defaults. Before asking for review of a UI PR, run
`hallmark audit` read-only on the changed pages and fix the defects it finds.
Design-choice findings go to Kazon as alternatives; never change them silently.
[docs/design-standard.md](docs/design-standard.md) has the triage, where records go and
how to update the vendored copy.

## Back-end rules

Owner decisions, 2026-11-12. The back end is being converted, one complete area at a time, to the form in kwilson21/tally (its `docs/decisions.md` rows 170, 190, 192 to 196, 201, 206 and 209 say why). The shared helpers are in `src/server/`.

- Business logic does not live in SQL strings. A rule is written in one of three styles: XState alone where the rule is states and moves (asked through `next()` in `src/server/machines/next.ts`), the `@xstate/effect` bridge where a move waits on outside work (Stripe, Resend, R2), and Effect alone where there are no states (`rule` in `src/server/terms.ts`). SQL keeps only the compare-and-set guard.
- Effect `Schema` is the single input validator on the server. Many files still import Zod today; each area is moved to `Schema` as it is converted. When the conversion is finished, Zod remains only where a library requires it: `src/lib/publication/mcp.ts` and `src/pages/api/mcp-probe.ts` (the MCP SDK) and `src/content/config.ts` (Astro content collections). The validators the browser and the server share (the audio intake, the software inquiry and the agreement client details) are Effect Schema through `src/lib/fields.ts`, and so are the owner agreement schemas (the details, the contractor's details and the owner's agreement requests, through `src/lib/readers.ts` and `src/lib/agreement-owner-input.ts`); `tests/server/validators-differential.test.ts` holds each to the Zod 3 schema it replaced (frozen in `tests/fixtures/legacy-validators/`).
- Only Effect Schema reaches the browser, through the shared field helpers in `src/lib/fields.ts` and for synchronous decoding only (no `Effect.gen`, service or `Layer`); the rest of Effect, `src/server/**` and the server-only packages never do. What is enforced: the source walker fails on any effect module not on `ALLOWED_BROWSER_EFFECT_MODULES` and, from the syntax tree in every reachable file and entry, on any use of a Schema function named `decode*`, `encode*`, `validate*`, `asserts*` or `make*Effect` that is not on `ALLOWED_SCHEMA_RUNNERS` (`decodeUnknownResult`, `decodeUnknownSync`, `decodeResult`, `decodeSync`, `decodeUnknownOption`, `decodeOption`, `is`, `asserts`; the combinators `decode`, `decodeTo`, `encode`, `encodeTo` and `encodeKeys` build a schema and are not refused), reached by a named import, an alias, the namespace by name or by string literal, a re-export, a computed member, the namespace used as a value, or a dynamic `import()` or `require`, and on `toStandardSchemaV1`, `toStandardJSONSchemaV1`, `toEncoderXml` and any `["~standard"]` access (a standard schema's `validate` can answer with a Promise; the other `to*` converters build a schema, formatter or equivalence and are allowed); and the bundle test fails on the Layer, Scope and Deferred runtime. What stays convention: a schema that carries an effect through an allowed module (for example `SchemaGetter.transformEffect`), and `Effect.gen` or services inside a module the walker allows, are not detected; review them. `src/scripts/**` and `.astro` script blocks stay plain TypeScript, and the `src/lib` modules they import are pure (constants, types, validators, formatting): a module that mixes those with invoicing, mail, sessions or storage is split first, and the browser imports the pure part. Two tests guard it. `tests/architecture/client-graph.test.ts`, a fast approximation, walks the source import graph from every browser entry (`src/scripts/**` and every `.astro` file with a `<script>`, including its `src=`) and fails on any load (static import, re-export, `import()`, `require`, `import.meta.glob`, `new URL(..., import.meta.url)`, a `tsconfig.json` `paths` alias with any of its targets, a `package.json` `imports` entry) of an effect module that `ALLOWED_BROWSER_EFFECT_MODULES` (`tests/helpers/client-graph.ts`) does not name (it names `effect/Schema`, `effect/SchemaGetter`, `effect/SchemaIssue`, `effect/Result` and `effect/Predicate`; the bare `effect`, `effect/Effect`, `effect/Layer` and `effect/Context` fail), `@effect/*`, `@xstate/effect`, `xstate`, `zod` (any version, `astro/zod` and `astro:schema` included), `stripe`, `resend`, `pdf-lib` or `src/server/**`, on a load it cannot resolve statically, on a bare specifier that is not a package under `node_modules`, and on an imported package whose `dependencies`, `peerDependencies` or `optionalDependencies` (followed transitively) include any of those packages. A root-relative `<script src="/x.js">` is read from `public/`. The same test fails when the set of `src/lib` modules a browser entry reaches differs from the reviewed allowlist `BROWSER_MODULES` (`tests/helpers/browser-modules.ts`, plus the files it reaches that the bundler drops) (a server module that leaks in fails with a message to split it), when any package but `effect` is reached, when the effect modules reached source imports differ from `ALLOWED_BROWSER_EFFECT_MODULES`, when any reached file or browser entry loads a Node built-in (`node:*` or a bare name such as `fs`), `cloudflare:*` or `astro:env/server`, and when one names `D1Database`, `R2Bucket` or `KVNamespace` or makes a `.prepare(` call (read from the syntax tree, so comments, strings, property keys and member names never count; a package named like a Node built-in such as `events` or `buffer` fails on purpose and needs an explicit allowance, an Astro virtual module such as `astro:transitions/client` fails as unresolved today, and the `.prepare(` check flags any `.prepare(` call in browser-reachable code by design). The reached set includes data files a reached module imports (JSON, or `?raw` and `?url` imports such as `.txt`, `.svg` and `.css`), and a file of an installed package reached by a relative path or alias into `node_modules` counts as that package. Any `client:*` hydration directive in an `.astro` file fails outright (read as an attribute name on a tag with Astro's compiler, so text, attribute values, comments and script blocks never count), because a hydrated component is browser code the walk does not read and the site has no UI framework (extend the walk before introducing one). The allowlist covers the modules under `src/lib` and `src/data`; the other checks cover every reached file and every entry. A D1 handle typed through some other interface and run through a method other than `.prepare(` is not found, so a module added to the allowlist must be read for server work. `tests/architecture/client-bundle.test.ts` is the guarantee: the client build itself, through the Vite plugin `scripts/client-bundle-manifest.mjs`, records every module it puts in each browser chunk (the small page scripts Astro inlines into pages included) in `.astro/client-bundle-manifest.json`, which is gitignored and outside `dist/`, so it is neither served nor deployed. The test requires every repository file in that list other than the browser entries (`src/scripts/**` and `.astro` files), not only `src/lib` and `src/data` modules but also a `package.json`, `src/styles/global.css`, a `public/` svg or a `?raw` JSON import, to equal `BROWSER_MODULES` and the installed packages to equal `BROWSER_PACKAGES` and the virtual module ids (`\0...`, `astro:...`, `virtual:...`) to equal `BROWSER_VIRTUAL_MODULES` (all in `tests/helpers/browser-modules.ts`; today `effect` and no virtual module), and fails on `@effect/*`, `@xstate/effect`, `xstate`, `stripe`, `resend`, `pdf-lib`, `zod` (any version), any `src/server/**` file, any `node:` or `cloudflare:` module, and a file outside the repository. Each module label carries the installed version of its own package directory, so every version that supplied code is checked (Zod 3 and Zod 4 both fail). A manifest that does not match `dist/` fails: every `.js` or `.mjs` file under `dist/` outside `dist/_worker.js/` must match a manifest chunk by hash or be a copied public script listed with its hash in `PUBLIC_SCRIPTS` (none today); every chunk Astro inlined into a page must match, by hash of its full text, an entry of the server manifest's `inlinedScripts`, and every such entry must match a recorded chunk; and with `dist/` present but no manifest the test fails. The manifest check allows the whole `effect` package (`effect` is in `BROWSER_PACKAGES` and the prefix `npm:effect@` is in `ALLOWED_FORBIDDEN_PREFIXES` in `tests/helpers/client-manifest.ts`), because `effect/dist/Schema.js` imports about 68 other effect modules; which effect modules browser code may import stays a source-level rule that the walker carries. The same file also checks every built browser script under `dist/` (`.js` and `.mjs`, including scripts copied from `public/`, but not the server output `dist/_worker.js/`) for any `~effect/<Name>` type id that an Effect Schema bundle does not hold (23 are allowed; `~effect/Layer`, `~effect/Scope` and `~effect/Deferred` fail), `EffectFailure`, `api.stripe.com`, `Stripe-Version`, `$ZodType` (Zod 4), and `ZodString` and `ZodEffects` (Zod 3). It skips without a build, so run `pnpm run build` first; CI runs it in a step after the build with `REQUIRE_CLIENT_BUNDLE=1`, which makes a missing `dist/` fail. The source walker is a fast approximation that runs in plain `pnpm test`; it can differ from what the bundler includes (it reaches a file the bundler tree-shakes away), so when the two disagree the bundler's manifest is right, with one limit: Vite builds a Web Worker in a separate Rollup run the plugin is not part of, so the manifest fails outright on any `?worker` or `?sharedworker` import or any chunk that constructs a `Worker` or `SharedWorker`, and the guard must be extended before workers are introduced.
- Import each Effect module by its own path (`effect/Effect`, `effect/Schema`), never from `effect`; `tests/architecture/effect-imports.test.ts` fails on a bare `effect` import.
- Where code goes, for every area after the first (the contact and resume routes are the model). (a) A decision over facts that are all read before it is a pure rule in `src/server/rules/`, written with `rule({ given, refusals, writes })` from `src/server/terms.ts`, with no effects. (b) A sequence that must act between decisions (for example rate-limit count, then captcha, then send, then delete) is a separate Effect program in `src/server/flows/`, which only calls services and pure rules and builds no response text. (c) Storage or an outside call whose failure the route must answer goes through a named service using `Effect.tryPromise` with a `Data.TaggedError`; `Effect.promise` is used only where a defect (an unanswered 500) is intended, with a comment saying so. (d) The route maps every refusal with `Effect.catchTags`, so the program reaches `runRoute` with error type `never`. (e) Only `catchTags` and `Effect.ignore` on named failures; never a catch-all. (f) A `Data.TaggedError` never has a field named `name`, `message`, `stack` or `cause` (`tests/architecture/tagged-errors.test.ts` fails on one) and carries no HTML; text is escaped where the page is built. (g) `legacyBindingsOrDefect` in `src/server/services.ts` is only for `src/pages/api/contact.ts`, `resume-request.ts` and `resume-approve.ts`, whose current answer to a missing binding is a 500 at first use; every later route uses `bindingsOrUnavailable` (`tests/architecture/legacy-bindings.test.ts` fails on any other importer).
- Golden fixtures and conversions: a fixture is recorded from the old code and a converted route that differs from it is wrong. A re-record for a conversion is allowed only when `pnpm run golden:neutral` passes between the fixture before and after, in a commit of its own. Neutral means byte-identical responses (status, headers, cookies, body), identical dumps and identical digests (per table of both databases, R2 and KV after each step; both databases and the set of tables written at the response and at every outside effect, so the state an email went out in is compared), and identical non-D1 effects in order (including a trigger-hit marker naming the operation and table an injected failure hit); only the D1 statements (SQL text, binds, count, batches, results) may differ. A pull request that converts a route carries the `conversion` label, and its CI (the `Golden neutrality` workflow, which runs the base revision's copy of the tool, not the pull request's own) then fails unless every case is neutral; the check is not a required status check unless the owner makes it one, and it cannot see a write that changes no row moved across an outside effect, or an effect moved past a read only; a behaviour fix does not carry the label, explains each changed case, and goes in its own pull request before the conversion, because CI judges the whole pull request and an effect whose state differs has no allowance. The three older recorder fixtures (contact, resume-request, resume-approve) carry no digests (they use the older record shape and only KV and fetch). A failure or race a golden case declares must fire (or the case lists it as optional or must-not-fire with a reason), or the case fails. `tests/golden/README.md` has the full rule and its limits.
- No ratchets and no legacy lists. An area is converted completely, or it is not started.
- Five database triggers still write (tracked in issue #242). Each is named in its area's rule file until it is moved.
- Design-time verification ([docs/verification.md](docs/verification.md)): new features and plans use XState diagrams. A new flow where order or timing matters (webhooks, queues, read-then-write) gets a Quint model before its code. A pure money rule gets a LemmaScript contract. A model's mutants (the real bugs, kept in the model) must fail in CI, and the driver fails if a property has no mutant, so a new property needs a mutant that breaks it. Run the manual Apalache check (`pnpm run verify:quint:exhaustive`) before changing a modelled rule.
- Pins, exact: `effect` 4.1.4, `@xstate/effect` 1.0.0-alpha.12, `xstate` 6.0.0-beta.1, `@informalsystems/quint` 0.33.1, `lemmascript` 0.6.6 (dev only). This is an owner-approved exception to the rule in [docs/coding-approach.md](docs/coding-approach.md) against new dependencies.

## Things to Never Do

- Never display Kazon's personal home address anywhere on the site
- Never display software rates publicly; audio starting prices above are approved
- Never imply contract exclusivity or a blanket rejection of full-time opportunities; follow the agreed personal-site direction
- Never use buzzwords: *passionate*, *innovative*, *guru*, *ninja*, *rockstar*
- Never use em-dashes (` — `) in user-facing prose, email bodies, subjects, or any new copy. They read as AI-generated. Use periods, colons, commas, semicolons, or parentheses instead. The middle-dot (` · `) is fine as a separator in metadata lines. This rule applies to `src/`, `public/`, README.md, and CLAUDE.md. Historical design specs in `docs/superpowers/specs/` are frozen and exempt, and so is the vendored third-party Hallmark skill in `.agents/skills/hallmark/`, which stays byte for byte as upstream.
- Never add hourly rates; all engagements are fixed price
- Never add non-compete or exclusivity language to any copy
- Never commit resume PDFs to the repository; they live in KV only
- Never write copy implying current security clearance

## Things to Always Do

- Keep tone direct, technically specific, and confident
- Reflect async-first, results-focused working style in all engagement copy
- Describe AI use per the AI stance above: careful, owner-led, never AI-first
- Keep privacy front of mind: registered agent address for business, never personal
- Ensure all contact flows go through the approval-gated system
- Keep Tailwind classes clean and consistent with existing design system
- Run `pnpm run check` before committing any Astro changes
- Run `pnpm test` before committing any TypeScript logic changes
- UI PRs need screenshots. The Screenshots workflow captures every page at 1280×800 and 390×844 and writes them into the PR description; look at them before asking for review. A PR that adds a stateful flow (sign-in, a multi-step owner action, a client journey) adds a scenario in `scripts/screenshots/scenarios/` so CI captures each step. Stacked PRs only get the workflow once their branch contains it, so merge main into the bottom of the stack
- Every PR gets a code review before it merges. If Greptile has not reviewed the PR's current head, run independent review subagents on the diff (for example, one for correctness and security, one for UI, copy and the rules in this file). Whichever reviewer ran, verify each finding against the code, fix the real ones, push, and review the new head again. Repeat until a pass finds nothing, then merge once CI is green. Two exceptions: never merge publicist PRs (publicist hard rule 1), and since merging to `main` deploys production, follow the Website deployment gate in AGENTS.md. Findings that need a product or design decision go to Kazon instead of being fixed silently
