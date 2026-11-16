# Contact handoff refinement

Hallmark component audit and scoped refinement. Design-system reference: design.md.
Pre-emit critique: Philosophy 5, Hierarchy 4, Execution 4, Specificity 5,
Restraint 5, Variety 4. Execution is conditional on hosted rendered QA.

## Audit findings

0 critical · 0 major · 2 minor component consistency findings:
- Abrupt handoff: display removal provides no visual continuity between fixed and
  footer actions. Replace only that handoff with a brief token-timed fade and 4px
  settle; reduced motion remains immediate.
- Inconsistent action geometry: the phone footer action is content-width while
  the pinned action fills a wider gutter. Use the same phone horizontal bounds
  and arrow on both links, preserving desktop layout.

No new palette, typography, panel, card, decorative imagery or attention loop.
The existing deliberate hover arrow nudge is enough; no bounce, pulse or shimmer.
The CTA is navigation, so artificial loading/error/success states do not apply.

## Implementation and accessibility

The hidden pinned container becomes inert immediately, preventing an invisible
duplicate from remaining clickable or keyboard-focusable during the fade.
The normal footer remains available without JavaScript. Menu/input-focus/print
suppression is preserved. Only motion-enabled visitors get the transition.
Both phone actions use identical outer-plus-panel inset math and retain reflow
for enlarged text. Contact and intake destinations remain quiet.

## Verification

- 111 focused tests passed; lint, formatter, whitespace and design gates passed.
- Astro check and final-head hosted CI/rendered review pending at this checkpoint.
- Screenshot scenario now checks matching x/width at 320/375/414px, existing 768px
  suppression, and hide/return/inert under both reduced and normal motion.
- Prior task established local Chromium cannot create its required socket.
  Use hosted capture; do not treat source inspection as a rendered motion pass.
- No merge or publication authorized for this refinement. Previous #350
  approval applied only to that release.
- No data, routes, forms, consent, payments, assets or dependencies changed.
