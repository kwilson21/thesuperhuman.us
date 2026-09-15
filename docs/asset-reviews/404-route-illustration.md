# Asset: 404 route illustration

- Purpose and placement: decorative route motif around the error code on the missing-page screen. Symbolic, not a map or product evidence.
- Final source: inline SVG in `src/pages/404.astro`, viewBox 640 × 500; scales without a separate asset request.
- Reference basis: original simple vector paths and typographic error code. Existing site colors and serif typography retained.
- Reviewer: Codex, September 15, 2026.
- Detail inspection: pass. Continuous deliberate curves, clear open endpoint, and deliberate route gap. No raster generation artifacts.
- Physical/reference accuracy: not applicable; abstract route illustration.
- Desktop/mobile inspection: pass at 1280 × 900 and 390 × 844. Text and controls stay separate from decoration; art stacks above content on mobile.
- Accessibility/optimization: decorative SVG container is aria-hidden; real HTML states 404 / Page not found. No animation, additional client script, or image request. Recovery links remain absolute for alternate-host compatibility.
- Outcome: ready for visual review; not deployed.

Source SHA-256: `eb2d5f81ea71218cd452621c4a72cb31dcaa71cb78aca5710b9e983744f6fa9e`
