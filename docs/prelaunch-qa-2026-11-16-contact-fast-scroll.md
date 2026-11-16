# Fast-scroll contact docking

## Scoped Hallmark audit

One execution defect: the visible action follows the footer through main-thread
scroll callbacks. Compositor scrolling can advance before the next callback, so
the fixed action catches up in steps. This is a timing defect, not a new design.
Keep the approved 15rem pill, 52px tap height, typography, arrow and colours.

## Change

A native sticky action now travels inside a document-space track ending at the
footer slot. JavaScript measures the track on layout changes, not on scrolling.
The browser can scroll/dock the same action without waiting for an animation frame.
Only the decorative backdrop flag changes on scroll. The footer fallback retains
its geometry and no-JS/desktop behavior; focus ownership, suppression and print
behavior remain. No new easing, autonomous attention loop, package or route.

## Verification checkpoint

- 105 focused script/component tests pass; scoped lint, format and design gates pass.
- Regression requires synchronous geometry after large down/up scroll jumps in the
  same browser task, without waiting for scroll handlers or animation frames.
- Hosted browser proof, final-head full CI and real-motion inspection pending.
- Local Chromium is blocked by sandbox socket permissions; no local rendered pass.
- No merge/deployment approval for this follow-up.
