# Kaillera-next drawing on /building: controller redraw review

Recorded the way [generated-image QA](../generated-image-qa.md) asks for explanatory
diagrams. The drawing is inline HTML and SVG, not a file in `src/assets/site`, so it
has no hash record under `docs/asset-reviews/`.

- Purpose and placement: the Kaillera-next row's explanatory drawing on `/building`.
  It shows one game room joined by two players and one spectator. Decorative and
  hidden from screen readers; the row's text carries the meaning.
- Final file: `src/components/BuildingIllustration.astro` (the `kaillera` drawing). No
  raster and no new text.
- Decision: the owner kept the browser windows (Hallmark design-audit board D6.1-A,
  October 22, 2026) and added that the controller could be redrawn to look better.
  The board's other D6.1 options were references only. They reuse the same person
  and controller marks, so the redraw is new work.
- Reference basis: a generic game controller, drawn as a symbol and not as any real
  product. It has a rounded body, two grips, a d-pad and two face buttons. It uses
  the person mark's line weight (1.7 in the 100 × 55 frame, with round caps and
  joins) and the drawing's own colour (`currentColor`, the ink token). The face
  buttons are filled dots so they stay visible at phone size.
- Reviewer and date: Claude Code agent visual review, October 22, 2026. Not human
  production approval.
- Detail inspection: pass. The earlier mark was an uneven outline with a single
  grip. The new mark is symmetric and reads as a controller at
  every size checked, including 320px at 1x, where it is about 24px wide. The
  person mark is unchanged. Each player frame's view box moved so that the person
  and controller pair stays centred in its window.
- Relationships (explanatory diagram): pass, and unchanged by the redraw. Three
  dashed lines run from the game room to Player 1, Player 2 and the Spectator. The
  accent two-way arrow joins Player 1 and Player 2. The room lists the same three
  members and Invite friends. Only the two players have a controller; the
  spectator does not and is labelled Watch only. This matches the row's lines
  "Create a room and invite friends.", "Play together or watch a game." and "Use a
  controller or touch controls."
- Desktop and mobile page inspection: pass. Checked in the development preview at
  1440, 800, 390 and 320px wide, at 2x density, in the resting frame with reduced
  motion. The 320px view was also checked at 1x. No overflow and no console errors.
  Each mark stays inside its window and clear of the frame edges and the labels.
- Motion: the controller has no motion of its own. The panels no longer rise in
  turn. That stagger went with the owner's pick D3.3-C ("Show the flow", which
  includes D3.3-B: the drawing arrives with its row). In its place, when the
  drawing is seen, its dashed lines reach out from the room to each player in
  turn. The peer line then joins Player 1 and Player 2. Frames were checked at
  1280 and 320px. Paper-coloured covers hide each line completely before it
  draws. With reduced motion, without JavaScript and in print, the finished
  drawing shows. A keyboard user who tabs into the row also sees it finished.
- Accessibility: the drawing stays `aria-hidden`, and the "Illustration" caption is
  unchanged.
- Corrections made and rechecked: the first redraw sat about 6px from the person's
  shoulder at desktop size. The controller moved right and the frame was
  recentred. Rechecked at all four widths.
- Outcome: ready for production.
- Not covered here: the `/building` link-preview video
  (`scripts/og-video/scenes/building.html`, reviewed in
  [link-previews.md](../asset-reviews/link-previews.md)) still draws its own copy
  of the old controller mark. Updating it means re-rendering that video and
  reviewing it again.
