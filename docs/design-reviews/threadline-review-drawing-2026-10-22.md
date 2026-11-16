# Asset: Threadline review drawing (paper redraw)

Image QA record per [generated-image-qa.md](../generated-image-qa.md), explanatory diagram. The drawing is HTML and CSS in
`src/components/PayloadReviewIllustration.astro`, not an image file, so it has no record in `docs/asset-reviews/`
(that inventory covers files in `src/assets/site` and `public/og`).

- Purpose and placement: explains the change in the approved journal entry `threadline-inspect-before-sending-20260905`
  on `/building/threadline`. It appears only when the published feed carries that entry, inside its journal panel.
  It is an explanation, not product evidence: the label under it reads “Illustration, not a Threadline screenshot.”
- Decision: the owner's pick D6.2-C (Hallmark follow-up board, October 22, 2026), with D4.4-B for its type. It replaces
  the dark drawn editor (mock tab, title bar and fifteen local colours) with the same three steps drawn on paper.
- Reference basis: the selected study `docs/design-concepts/2026-09-09/threadline-detail-v2.png` (before and after,
  with Play change, Next step and Reset) and the approved entry text in `src/data/project-stories/threadline-review.json`.
  No real Threadline screenshot exists yet; a real capture is the planned replacement.
- Existing site assets used for consistency: the plain panels of `src/components/BuildingIllustration.astro` (a quiet
  panel edge, ink-edged cards, accent for the one primary action). Colours are site tokens only (`--paper`, `--ink`,
  `--muted`, `--accent`, `--field-border`, and mixes of them); type is Libron at 14px or more. There are no small
  uppercase labels, so the Inter label face (D4.2-C) has nothing to set here.
- Reviewer and date: Claude Code agent, October 22, 2026. Not human approval.
- Relationships, checked against the entry and the study: pass.
  - Step 1, “Before: the editor is blocked”: a light veil covers the whole document and the dialog sits over it, so
    the document is visibly out of reach. The dialog offers Generate Recap and Cancel.
  - Step 2, “Change: use a nonblocking notification”: the veil and dialog fade out and the notification rises into the
    lower right. The document's lines are fully readable and not covered by the notification at any tested width.
  - Step 3, “After: inspect, then decide”: the document's two middle lines are selected, showing it is usable, while
    the notification still offers the same two choices, so sending still needs an explicit decision.
  - Three steps, matching the phase line, the caption and the counter (1 / 3 to 3 / 3). The text is unchanged from the
    previous drawing apart from dropping the “Drawn editor · Illustrative steps” bar, as the board specified.
- Meaning: pass. It claims no recording, release or measured improvement; the entry's own “What was checked” text
  says the same. Example text only; no project data.
- Page inspection: pass at 1280 × 800, 390 × 844 and 320 wide, every step, with motion and with reduced motion. No
  horizontal overflow; the dialog and notification stay inside the panel; the fake buttons fit on one line; the
  caption and phase line reserve their longest wrap, so the controls and panel do not jump between steps.
- Accessibility: the drawn buttons are hidden from screen readers; the real controls are 44px tall with
  `--field-border` edges (3.4:1) and a 3px accent focus ring; accent on paper is 4.78:1. The caption is a polite live
  region, as before. The faded document text in step 1 is part of the picture (it shows the blocked state).
- Motion: veil, notification and selection change over 400ms on `--ease-site`; Play change advances every 1.8 seconds
  and stops at step 3. With reduced motion the steps change at once and Play moves one step. A mid-transition frame
  (veil half faded, notification rising) shows no broken or detached parts.
- Correction made and rechecked: on a journal with a single entry, the journal picker's script took the drawing's
  Next step button for its own (both used `data-next`) and disabled it. The drawing's button now uses
  `data-review-next`; Next step works with one entry or many.
- Outcome: ready for production as a labelled illustration. Deployment is a separate step.
