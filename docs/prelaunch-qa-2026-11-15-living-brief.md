# The living brief: release gate

The project brief at `/software/start` gains a board beside its written questions: as a visitor writes, Cloudflare's
Workers AI sketches an outline (what it is for, who it is for, pages or features or steps, open questions), and the
visitor keeps, edits, answers, sets aside or adds cards while it works. Design: `docs/plans/2026-11-living-brief.md`.

Date: November 15, 2026, updated November 16, 2026 for the merge to `main`
Repository: the personal website repository
Branch: `claude/fervent-edison-51jxrn`, first stacked on PR #286 (example answers and the contact confirmation), which
merged on November 16, 2026; then merged with `origin/main` at `01f0433d` (merge commits, never a rebase). `main` had
converted `/api/software-inquiry` to the Effect form in the meantime, so the outline now reaches the store through
`submitInquiry` (`src/server/flows/software-inquiry.ts`), which adds it to the brief's details only when there is one.
Target: production, behind `SOFTWARE_BOARD_ENABLED` (`"false"` in `wrangler.jsonc`). With the switch off, the page,
the inquiry route and the privacy notice behave for visitors as before, except the privacy paragraph's new sentences
about the board.
Reviewer: built by Claude Code (the owner's agent); independent Claude reviews on the diff (below).
Rollback revision: `01f0433d` (`main` before this merge; re-check at merge time), or turn the switch off.

## Owner decisions

Decided November 16, 2026: the owner, in conversation, told Claude Code to decide the open questions on this stack
and to merge it. The decisions taken:

- **The switch stays off.** The board is not turned on until the model has been measured against the route's 8 s
  timeout on real requests. That needs a Cloudflare token with Workers AI permission; the environment's token has none
  (a Workers AI run answers 401), so nothing has been measured yet.
- **The model stays `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for now**, to be revisited with the measurements.
- **The design choices below stay as built**, and so does showing a suggestion that arrives without a reason (the open
  Codex finding).

The questions as they were first put to the owner:

1. **The AI spending envelope** (plan, section 6), and then the switch. Live interpretation calls
   `@cf/meta/llama-3.3-70b-instruct-fp8-fast` in JSON Mode: about 120 neurons a call, at most about 231. Limits: 40 a
   visitor a day, 150 for the site a day, 24 a page. Worst case at the site limit is about $0.38 a day before the
   10,000 free daily neurons, at most about $12 a month (about $16 if every brief were in a script that takes more
   tokens per character). Until the owner approves, the switch stays off.
2. **The model.** JSON Mode supports `llama-3.3-70b-instruct-fp8-fast` and `llama-3.1-8b-instruct` (the cheaper 8B
   fp8-fast model is not on Cloudflare's JSON Mode list). The 70B costs about 1.6 times the 8B per call and was chosen
   for quality; neither has been tried against real briefs here.
3. **Design choices from the audit** (below): the small-capital origin label on every card, the board's heading
   without a rule under it, and the two-column layout on wide screens.

## Checks

| Check | Result | Evidence |
|---|---|---|
| 1. Purpose and content: truthful claims, explain who does what | PASS | The board says the AI sketches the outline and that suggestions are dashed until kept; the review lists each outline item's origin. No prices, durations or promises in cards (refused in code, server and browser). |
| 1. Professional claims or resume | N/A | None changed. |
| 2. Search and sharing | N/A | No new page, title or metadata. |
| 3. Semantics, headings, names | PASS | Board is an `aside` with an `h2`, lanes are `section`s with `h3`s; every action is named with its card (`Keep: Shows`). axe (wcag2a/aa, 2.1, 2.2, best practice) found nothing on the page at 1280, 390 and 320 px. |
| 3. Keyboard, focus, no traps | PASS | Playwright: Tab reaches the board after Next; Enter and Escape in editors; Ctrl+Z undoes inside the board only; focus returns to the action after saving and moves to a neighbour after Not this. |
| 3. Status announcements, colour not alone | PASS | One polite live region, throttled; origin in words on every card as well as solid or dashed outline. |
| 3. Contrast, targets, 200% text, reduced motion | PASS | Board buttons at least 44 px tall at three widths; 200% text at 390 px: no sideways scroll, no clipped control; reduced motion: no card animation. Field text is 16 px. |
| 3. 320 px to desktop, no overflow | PASS | 1280, 390 and 320 px: no horizontal overflow; no label wraps on any path at 320 or 390 px. |
| 3. Another browser and a real device | UNVERIFIED | Chromium only. Firefox, Safari and a real phone not tried. |
| 4. Client code and dependencies | PASS | No new dependency. The browser bundle check passes (Schema only, no Effect runtime markers) after the board's readers were rewritten field by field. |
| 4. Async UI: timeout, offline, malformed, server error | PASS | Playwright with the route answered 429, 503 off, 503 busy, a network failure and malformed JSON: the answer box is untouched, the status says what happened, a busy failure backs off 20 s, a limit or off stops asking. The pass is renewed once on 403. |
| 4. Performance measurement | UNVERIFIED | No lab or field measurement of the page with the board. |
| 5. Server validation, origin, abuse protection, rate limits | PASS | Board route: Effect Schema input, origin and size checks, the autocomplete's Turnstile pass, two Cloudflare rate limits, a daily reservation guarded in one batch (tested against real SQL, including a race for the last place). Inquiry route: the outline is read with schemas and its passages checked against the answers sent. |
| 5. Empty, invalid, 429, 500, timeout, retry, duplicate | PASS | 34 route tests for the board route; 6 new inquiry route tests; the inquiry's golden corpus and validator differential pass unchanged. |
| 5. Alternative without JavaScript or AI | PASS | The board is hidden without JavaScript (the intake already needs it); "Turn off" stops its AI; "Use the plain form" hides it; with the switch off nothing changes. |
| 5. Owner readback | PASS | Local preview, through the real Access JWT check with the screenshot tool's local issuer: the owner's request page shows "Brief outline" with each item's origin, line by line. |
| 5. Delivery and receipt in the real environment | UNVERIFIED | The owner notice and the visitor's copy include the outline in tests only; no real email was sent. |
| 5. Approval-gated flows intact, explicit review and submission | PASS | Nothing is sent until Send brief; the review lists the outline; no price, booking or commitment is made. |
| 6. Data inventory and privacy notice | PASS | The privacy paragraph now says what the board sends to Workers AI (written answers and board cards, never contact details, timing, budget, link or existing-content notes), that it is saved in the browser with the draft, and that its outline is stored only with a sent brief. Same IP-derived daily counters. |
| 6. New paid service or account | N/A | Workers AI is already used; the spending envelope is decision 1. |
| 7. Type, test, lint, build | PASS | After the merge with `main` (`e1b14b2b`, Node 26): `pnpm run check` 0 errors 0 warnings; `pnpm test` 360 files, 14,482 passed (its one failure was `client-bundle.test.ts` reading an older `dist/`; after `pnpm run build` it passes, 27 tests, with `REQUIRE_CLIENT_BUNDLE=1`); `pnpm run lint` no findings; `copy:check` and `design:check` pass; `verify:quint:all` passes with the brief-board model registered beside `main`'s. An independent review of the merge found no correctness defect. |
| 7. Diff, generated files, secrets | PASS | No secrets, no generated assets; local preview files stay in gitignored folders. |
| 7. Production bindings | UNVERIFIED | Uses existing bindings (`AI`, `MUSIC_DB`, the two rate limits, the Turnstile secret) and the existing `brief_suggestion_budget` table; no migration. Not checked against production. |
| 7. Deploy and live verification | UNVERIFIED | Not deployed. Merging deploys production; the switch keeps the board off. |
| Live model behaviour | UNVERIFIED | No Workers AI call was made: the environment's Cloudflare token has no Workers AI permission (checked November 16, 2026). Quality, latency, JSON Mode reliability and real cost are unmeasured. Browser tests and screenshots use a scripted stand-in (`scripts/screenshots/brief-board-script.mjs`). |
| Size of a brief with an outline | Known limit | A brief's details are capped at 16,000 characters (`src/server/intake-store.ts`). With the switch on, the largest valid answers plus a full outline can pass the cap, and the visitor is told to keep the brief shorter. `main`'s test that a valid body never reaches that answer holds with the switch off only. To settle before the switch is turned on. |

## Verification

- `verification/brief-board.qnt`: seven properties, eight mutants, 20,000 random runs in CI. It caught a hole in the
  first design (an Undo made while a request was in flight could be silently reverted), kept as the `SeenOnly` mutant.
- `tests/lib/brief-board-walk.test.ts`: the same properties on the real code, 400 seeded walks of 80 steps with an
  adversarial model; planting two mutants in the real code makes it fail.
- Browser checks (Playwright, local preview, scripted model): 36 checks for overlapping and stale replies, rejected
  ideas, Undo in flight, deleted words, Pause, a path change, keyboard, axe, widths and a reload; plus the failure
  answers and 200% text. The screenshot scenario `software-board` repeats the key ones in CI.

## Hallmark audit (read-only, on the board's markup, styles and renders)

- Defects fixed: a left accent stripe on newly arrived cards and an accent rule beside quoted passages (the
  side-stripe tell) became an all-round accent outline for a moment and plain muted quotes; the board's inline fields
  were 14.4 px (design.md asks 16 px, and iOS zooms in below it).
- Design choices for the owner, unchanged: the small-capital origin label on every card (Hallmark defaults eyebrows
  off; design.md D4.1-D keeps labels that carry a fact, and the origin is the fact the visitor needs); the board's `h2`
  has no rule under it (design.md asks for one under section headings; the lanes carry rules); the two-column layout on
  wide screens is new to the intake family.
- False positive: no Hallmark stamp, by this site's design standard.
