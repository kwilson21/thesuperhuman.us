# Fast-scroll contact docking

## Scoped Hallmark audit

One execution defect: the visible action follows the footer through main-thread
scroll callbacks. Compositor scrolling can advance before the next callback, so
the fixed action catches up in steps. This is a timing defect, not a new design.
Keep the approved 15rem pill, 52px tap height, typography, arrow and colours.

## Change

A native sticky action now travels inside a body-relative track ending at the
footer slot. Its bottom clearance stays constant when main content reflows, so
the track follows document-height changes without a JavaScript callback.
JavaScript refreshes the clearance on layout changes, not on scrolling.
The browser can scroll/dock the same action without waiting for an animation frame.
Only the decorative backdrop flag changes on scroll. The footer fallback retains
its geometry and no-JS/desktop behavior; focus ownership, suppression and print
behavior remain. No new easing, autonomous attention loop, package or route.

## Verification checkpoint

- 46 focused script/component tests pass; scoped lint, format and design gates pass.
- Astro check: 0 errors, 0 warnings.
- Regression requires synchronous geometry after large down/up scroll jumps in the
  same browser task, without waiting for scroll handlers or animation frames.
- Hosted Chromium and WebKit pass 56 same-task jumps across 320/375/390/414px
  widths with zero geometry error (run 43904638103). Each jump blocks the main
  thread before another callback can run.
- The first document-height candidate failed WebKit at 320px after page reflow;
  the body-relative endpoint corrects that regression.
- Actual 390px Chromium recording inspected across rapid down/up wheel bursts.
  This is mobile-viewport emulation, not a physical iPhone/address-bar test.
- Final-head full CI remains pending.
- Local Chromium is blocked by sandbox socket permissions; no local rendered pass.
- No merge/deployment approval for this follow-up.
