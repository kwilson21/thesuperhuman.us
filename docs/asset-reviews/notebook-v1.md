# Asset: notebook-v1

- Purpose and placement: Writing preview, Home prototype.
- Reviewer: Codex agent visual review, September 10, 2026. Not human production approval.
- Reference basis: `docs/design-concepts/2026-09-09/home-quiet-studio-v2.png`. Owner-selected original generated illustration; no third-party product photograph or logo. No exact real-world product identity asserted.
- Source original: `docs/design-concepts/2026-09-10/production/notebook-v1.png`.
- Delivery: WebP quality 86, 1536 × 1024, 82,050 bytes. Imported directly and served unchanged; no runtime image transformation.
- Detail and physical-logic inspection: pass. Binding, page thickness, pen shape, perspective, and contact shadows checked. Drawing is a qualitative landscape/path metaphor with no claimed data or generated labels.
- Corrections and recheck: Soft edge masks blend the background with the site paper. Replaced the first elliptical mask with shallow edge fades to keep notebook corners visible.
- In-page inspection: pass on 1440px desktop, 800px tablet, and 390px/320px mobile in both development and the locally bundled Worker; complete intended content, no distorted resizing or unreadable required image text.
- Accessibility: decorative image has empty alternative text. Links have visible text or explicit accessible names; meaning is provided in the surrounding HTML.
- Motion: artwork is static. Link-arrow feedback is disabled for reduced motion. No hidden surfaces or disconnected animated parts.
- Publication: no private information, personal portrait, false product evidence, or generated credit. The illustration does not claim a real studio photograph.
- Delivery verification: production HTTP response SHA-256 matches this exact source file. See `docs/design-concepts/2026-09-10/home-prototype/production-results.json`.
- Outcome: ready for production asset use within this prototype. Deployment is a separate step.

Exact delivered-file record:

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/notebook-v1.webp",
      "sha256": "2c77274d35650d9130c20bec7ebb54c0999610ee8c60d2bb4e9be85181960d79",
      "width": 1536,
      "height": 1024,
      "bytes": 82050
    }
  ]
}
```

September 10 additional placement review: About’s final chapter inspected at 1440px desktop and 390px/320px mobile, with 800px layout checks. Same exact file, decorative use and static behavior. No new crop, artifact, or proportion issue observed.

Built-preview verification: the same additional placement passed at 1440px, 800px, 390px (2× density), and 320px (2× density) in the locally bundled Worker on port 4362. HTTP image bytes and SHA-256 matched the source file. Evidence: `docs/design-concepts/2026-09-10/primary-pages/results.json`.

September 10 project detail placement review (Codex agent): Daily’s Behind the idea section inspected in the built local Worker at 1440px desktop and 390px/320px phones at 2× density, with 800px overflow/layout checks. Reuses the same exact reviewed WebP with intrinsic aspect ratio and no new crop. Proportions, object support, image edges and text separation passed. Threadline keeps all pins, the thread and the complete spool visible; the notebook remains an illustration, not project evidence. Static reduced-motion presentation and descriptive alternative text retained. Evidence: `docs/design-concepts/2026-09-10/detail-pages/`.

September 10 Audio placement review (Codex agent): Audio Working together reuses the same exact WebP. Inspected final built desktop (1440px) and phone (390px at 2×) composition, with 800px/320px layout checks. Existing soft edge masking blends the background; the objects remain fully visible at their intrinsic aspect ratio. No new crop, equipment, physical connection, proportion or texture defect. Empty alt marks decorative artwork. Native SVG service icons were separately checked for consistent strokes and adjacent text labels. Static/reduced-motion presentation; no autoplay. Evidence: `docs/design-concepts/2026-09-10/audio-contact/`.

Archive note: source PNGs, prompts and raw browser-evidence paths above refer to the private recovery archive. The committed production file and hash record are authoritative for the asset gate; see [the evidence index](../design-concepts/README.md).
