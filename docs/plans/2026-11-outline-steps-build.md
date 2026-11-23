# The outline as its own steps: build plan

Status: built. The design now lives in sections 1, 2 (rule 6) and 4 of `docs/plans/2026-11-living-brief.md`; this plan is
kept as the record of how it was built.

**Goal:** move the living brief's outline from a board beside the answer box to four lane screens inside the
step-by-step brief at `/software/start`, and remove two wordy explanations.

**Spec:** `docs/plans/2026-11-living-brief.md`, sections 1, 2 (rule 6) and 4 (approved by the owner on November 22,
2026), which replaced the board beside the answer box that this plan started from.

**Approach:** the formal model changes first, then the pure library that mirrors it, then the page. One pull request,
one commit per task. The route, the model call, the limits and what is stored on the server do not change.

## Global constraints

- Tests first in every task: write the failing test, see it fail, then the code.
- `CLAUDE.md` in full. In particular: no em-dashes in copy; browser code stays plain TypeScript and imports only the
  modules `tests/helpers/browser-modules.ts` allows; `src/lib/brief-board.ts` stays pure and reads fields with
  `src/lib/fields.ts`; no ratchets, baselines or disabled lint findings.
- Copy is exactly what section 1 of the design gives (headings, hints, "Skip these, no AI outline", "Add the outline back",
  "Reading your answers…", "New since you last looked"). Any other new visitor-facing sentence is listed in the task's
  report so the owner can approve it.
- New UI uses the existing intake classes and tokens (`intake-*`, `board-card*`, `site-button`); no new colours, fonts
  or radii. See `design.md`.
- Before each commit: `pnpm run format`, `pnpm run lint`, `pnpm run check`, `pnpm test`.
- Committed text describes AI help at a high level only: no model names, no mention of subagents or reviewers.

## Review focus

1. The visitor edits the first answer, presses Next at once, and the reply lands two screens later: nothing on the
   lane on screen changes or leaves; other lanes update; the review step lists unseen cards read from the answers.
2. The visitor deletes the sentence a kept card quotes: the card stays, and the brief sends without the server's
   refusal.
3. A draft restored from localStorage that was saved by the old page (no last-seen lists, a `plain` flag, a step index
   from the old plan): it opens on a valid step with its cards intact.
4. "Skip these, no AI outline" on the third lane screen, then Back: the visitor lands on the last written question,
   the dots count drops by four, and no request is sent afterwards.
5. A lane at its limit when Undo or "Bring back" adds a card: the existing "is full" sentence still appears after the
   control.

## Task 1: the model

**Files:** `verification/brief-board.qnt`, and whatever `scripts/verify-quint.mjs` reads to list properties and mutants.

- Add the lane on screen to the state: a visitor action moves it between "none" and one lane; ideas belong to lanes.
- Replace today's held state and visible-board condition with section 4 and section 2 rule 6 of the design: `send` no longer needs the
  board visible; `deliver` applies in full to lanes not on screen; on the lane on screen it only adds cards, and its
  changes and withdrawals for that lane apply when the visitor leaves it (still subject to rules 2, 4 and 5 at that
  moment).
- New property `onScreenStable`: no card listed on the lane on screen is changed or withdrawn by a delivery. Add a
  mutant that applies the whole reply to the lane on screen; the driver must show the mutant fails the property.
- Every existing property and mutant still holds or fails as before.
- Run `pnpm run verify:quint:all` and `pnpm run verify:quint:exhaustive`; put both outputs in the report.

**Produces:** the names of the model's new actions and the deferred-apply mechanism, which Task 2 mirrors.

## Task 2: the library

**Files:** `src/lib/brief-board.ts`, `tests/lib/brief-board.test.ts`, `tests/lib/brief-board-walk.test.ts`,
`docs/plans/2026-11-living-brief.md` (rewrite sections 1, 2.6, 4 and 9 to match the lane-screen design).

**Produces (exact names, used by Task 3):**

- `Board` gains `seen: Partial<Record<Lane, readonly string[]>>`: the ids of the cards a lane listed (not set aside)
  when the visitor last left it. `emptyBoard()` gives `{}`; `readSavedBoards` reads a board saved without it as `{}`.
- `applyReply` takes the lane on screen (`Lane | null`) and follows the model: additions only for that lane, the rest
  deferred. `leaveLane(board: Board, lane: Lane, answers: string): Board` applies what was deferred for that lane and
  records `seen[lane]`.
- `laneChanges(board: Board, lane: Lane): { added: number; removed: number }`: against `seen[lane]`; zeros when the
  lane has not been visited.
- `laneChangesLine(changes): string`: "" for no change, otherwise in the form "1 new, 1 removed since you edited your
  answer" (only the non-zero parts).
- `unseenFromAnswers(board: Board, answers: string): BoardCard[]`: open cards read from the answers, still grounded,
  whose id is not in their lane's `seen`.
- `laneQuestions: Record<SoftwarePath, Record<Lane, string>>` with section 1's twelve headings, and
  `LANE_HINT = "From your answers. Keep, change or add your own."`, `LANE_HINT_EMPTY = "Add your own, or go on."`.
- `OUTLINE_CHANGED` reworded: "Your brief outline no longer matches your answers. Go back to the outline screens, check
  them and send again."

**Tests to add** (beside the existing ones, which keep passing): each function above; review focus 1 and 2 as library
walks; a saved board without `seen`; a reply for the lane on screen that rewords one listed card, withdraws another and
adds a third (only the third appears until `leaveLane`).

## Task 3: the page

**Files:** `src/pages/software/start.astro`, `src/components/BriefBoard.astro`, `src/scripts/software-inquiry.ts`,
`src/scripts/brief-board.ts`, `src/scripts/brief-board-core.ts`, `src/styles/software-intake.css`,
`src/pages/privacy.astro`, `tests/scripts/brief-flow.test.ts`, `tests/scripts/screenshots.test.ts`,
`tests/pages/software-offer.test.ts`, `scripts/screenshots/scenarios/software-board.mjs`, `software-brief.mjs`,
`website-brief.mjs`, `scripts/screenshots/brief-board-script.mjs`, `tests/helpers/browser-modules.ts` only if a reached module changes.

- Remove the footnote sentence for every path (page and `configureQuestions`), keeping "See example answers". Remove
  the board's explanation paragraph, the side column and its sticky layout, "Your brief so far", the pulse link, "Show
  the outline", "Pause the outline" and "Use the plain form".
- Plans, with the outline in the brief: website `[0, 1, L1, L2, L3, L4, 7, 8, 3, 4, 5, 6]`, web app and workflow
  `[0, 1, 2, L1, L2, L3, L4, 3, 4, 5, 6]`, where `L1` to `L4` are four new `data-step` sections in lane order. Without
  it (the server switch off, or after "Skip these, no AI outline") the plans are today's. The progress dots render for
  the longest plan and hide the rest, as today.
- A lane screen: `h1` from `laneQuestions`, the hint, the status line (`laneChangesLine`, or "Reading your answers…"
  while a request waits or is in flight, in a `role="status"` element), the cards in a list with a bounded height that
  scrolls inside, Add, the lane's set-aside list, Undo, and "Skip these, no AI outline". Card markup and actions are
  the existing template's.
- Requests per section 4; replies per section 2 rule 6, calling `leaveLane` whenever the step changes away from a lane
  screen. The "Show updates" button and the pointer and focus holding are deleted.
- Review step: the outline as it will be sent (as today), then, when `unseenFromAnswers` is not empty, "New since you
  last looked" with each card and a link to its lane screen. After a skip, a button "Add the outline back" restores the
  four screens and the cards.
- Section 4 and section 6 for AI off, limits and failures; the existing status sentences are reused.
- An old draft (review focus 3) is read without error: a saved `plain` flag means skipped; a saved step index beyond
  the plan opens the first written question.
- Privacy page: only where it says the outline sits beside the answers.
- `brief-flow.test.ts`: the new plans and dot counts for each path, skip and add back, review focus 3, 4 and 5.
- Screenshot scenario: each lane screen for the website path at both sizes, a go-back-and-edit run showing the
  changed line, the review step with "New since you last looked", and the skipped state.
- Run `pnpm run build`, then `REQUIRE_CLIENT_BUNDLE=1 pnpm test`, then the `hallmark audit` on `/software/start`
  (`docs/design-standard.md`); defects are fixed, design-choice findings are listed in the report.
