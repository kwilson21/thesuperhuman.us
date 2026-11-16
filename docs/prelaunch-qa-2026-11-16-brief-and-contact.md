# Project brief guidance and contact hold release gate

Date: November 16, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/festive-lamport-czr07s`, merged with `origin/main` at `d04fcfef` (a merge commit, never a rebase)
Pull request: [#286](https://github.com/kwilson21/thesuperhuman.us/pull/286)
Revision: the branch head that carries this record.
Target: production `https://thesuperhuman.us` after merge: `/software/start` (the project brief) and Home's contact form.
Decisions and merge authorization: Kazon Wilson, in conversation: the copy approved as it is, the AI suggestions fix approved, the hold-and-undo instead of giving out an address for typos, and "yes" to merging on November 16, 2026. Implementation and independent review passes were done with Claude Code.
Rollback revision: `d04fcfef`, `origin/main`'s tip when it was merged into the branch. Re-check at merge time; the merge message records the actual one. The PR adds no migration, binding, secret or dependency, and changes no server route.

## Scope

- Project brief (`src/scripts/software-inquiry.ts`, `src/pages/software/start.astro` and its script): a "See example answers" toggle on each written question with three short example answers, an example for the optional second question, and the budget labelled in US dollars. Answers stay free text; paths, drafts, review and sending are unchanged.
- Brief suggestions (`src/scripts/brief-suggestion-pass.ts`): the pass renders its invisible Turnstile widget directly instead of calling `turnstile.ready()`, which throws when Turnstile's script is loaded with `defer`. Before this, the pass was never requested and suggestions never ran.
- Home's contact form (`src/scripts/contact-form.ts`, `src/components/ContactForm.astro`, `src/scripts/home-contact.ts`): Send message holds the message in the browser for 15 seconds with Undo and edit and Send now; leaving or hiding the page sends at once with `keepalive`; nothing reaches the server during the hold. The confirmation names the reply address and says a short confirmation email should arrive.
- Tests: `tests/scripts/contact-confirmation.test.ts`, `tests/scripts/brief-flow.test.ts` and related; screenshot scenarios `home-contact` and `brief-examples`.

## Checklist

### 1. Purpose and content
- Project, branch, instructions and authorization: PASS. The owner authorized the merge.
- Approved design and truthful claims: PASS. Copy approved by the owner; the example answers are marked as examples and are fictional; no reply time is promised.
- Explanatory copy and resume parity: PASS for the explanations (the hold says who replies and what happens on leaving; the confirmation names the reply address). No professional claims change.
- First screen and CTA: N/A. Unchanged.
- Navigation, footer, contact and external links: PASS. The contact route is the same approval-gated route.

### 2. Search and sharing
- N/A. No head, route or metadata change.

### 3. Accessibility and responsive behavior
- Names and states: PASS. The hold panel has a fixed accessible name and a `role="timer"` count; Undo returns focus to the email field; the examples toggle is a button with its list marked up as a list.
- Forms: PASS. Labels unchanged; the budget field names its currency; failures show their message and take focus.
- Keyboard: PASS. Undo and Send now work by keyboard (checked in a real-time browser run).
- Widths: PASS at 320, 360, 390 and 1280px (the Undo button stays at one position through the countdown on phones; the brief at 1280×800, 390×844 and 320×640 with the examples open and closed).
- 200% text zoom: UNVERIFIED for these changes.
- Second browser and real device: UNVERIFIED. Chromium only.

### 4. Performance and resilience
- Client code: PASS. No new dependency; the browser bundle guard passes.
- Measured Web Vitals: UNVERIFIED. Not measured.
- Async recovery: PASS. A refused or failed send returns to the form with its message; the sent address survives an edit during sending; a second submit during the hold is ignored.

### 5. Forms and sensitive flows
- Server validation, origin checks and rate limits: PASS. No server change.
- Invalid input, verification token, failure and retry: PASS in tests. The hold is skipped when the browser's field checks refuse the form or no security token exists yet, so the server answers those at once.
- Without JavaScript: N/A. Unchanged from `main`.
- Delivery in the intended environment: UNVERIFIED. No test message was sent to production from this session; the owner can send one test message after deploy.
- Approval-gated flows: PASS. Unchanged.
- Inline confirmation: PASS.

### 6. Privacy, legal and measurement
- Processors: PASS. Suggestions now run as designed: the brief's answer text goes to Cloudflare Workers AI, within the existing caps (300 a day per visitor, 10,000 site-wide) and minute limits. `wrangler.jsonc` has the `AI` binding and `SOFTWARE_SUGGESTIONS_ENABLED` set to "true". The privacy page already describes exactly this, including the fields never sent and how to turn suggestions off.
- The contact hold keeps the message in the page only; nothing new is stored.

### 7. Release and final QA
- Type, test, asset and build checks: PASS. See Evidence below.
- Diff review: see Evidence below.
- Production bindings and headers: PASS. No change.
- Rollback: PASS. `d04fcfef`, re-checked at merge time.
- Live verification after deploy: UNVERIFIED until the deploy; recorded in the pull request once checked.
- Receipt: this record.

### 8. Private owner center, and software agreement signing
- N/A. Not touched.

## Evidence and limits

- Local checks on the tree merged with `origin/main` at `d04fcfef`: lint, `pnpm run check` (0 errors), format, design and copy checks pass; `pnpm run build` succeeds; the full `pnpm test` with `REQUIRE_CLIENT_BUNDLE=1` passes (351 files, 14,027 tests, 1 skipped). The only conflict in the merge was `scripts/screenshots/config.mjs`, where both sides added scenario mappings; both are kept.
- Earlier evidence on the branch before the merge: lint, format, copy, design and type checks; the full suite (299 files at the time); real-time browser runs of the hold (sends at 15 seconds, Undo by keyboard, switching away sends within 5 ms, a refused send shows its message, focused); the brief on all three paths at three sizes; a Hallmark audit; independent reviews on every commit up to the last review round, and Codex's.
- Limits: Chromium only; no real device; no field data; no production delivery test.
