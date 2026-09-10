# Asset: headphones-v1

- Purpose and placement: decorative illustration; About audio chapter.
- Reviewer: Codex agent, September 10, 2026. This is agent QA, not owner acceptance of the implemented page.
- Reference basis: Existing interests-v1 production illustration. Original generated artwork already selected by the owner; no third-party photo or logo. The visual study is a style reference, not production evidence.
- Source original: `docs/design-concepts/2026-09-10/production/headphones-v1.png`. Prompt: `primary-page-prompts.json` in the same directory.
- Native-resolution inspection: pass. Two earcups, bronze rings, headband, and hinges retain the accepted design and credible proportions. Both cups join the band; no cables or extra equipment. Decorative generic headphones, not a representation of the owner’s exact equipment.
- Delivery: WebP quality 86, 1536 × 1024, 39,920 bytes. Same aspect ratio; no alternate crop or runtime transformation.
- Page inspection: pass at 1440px desktop and 390px/320px mobile in the development preview, with 800px layout checks. See primary-pages visual evidence. Images retain proportions, stay separate from copy and controls, and blend against the paper background.
- Corrections: CSS edge masks keep rectangular backgrounds out of decorative placements. Building’s small controller received an additional soft edge mask; the image itself is unchanged.
- Accessibility and motion: empty alternative text, with meaning in adjacent HTML. Static artwork; link feedback respects reduced motion. No autoplay.
- Publication check: no private content, generated factual labels, claims about a real studio photograph, or unsupported product evidence.
- Outcome: ready for production asset use in the local prototype. Deployment is separate.

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/headphones-v1.webp",
      "sha256": "8f0b69d178192dca33595377c9c06e32ef34983dd0372fabc5376adeafd80eb6",
      "width": 1536,
      "height": 1024,
      "bytes": 39920
    }
  ]
}
```

Built-preview verification: the same additional placement passed at 1440px, 800px, 390px (2× density), and 320px (2× density) in the locally bundled Worker on port 4362. HTTP image bytes and SHA-256 matched the source file. Evidence: `docs/design-concepts/2026-09-10/primary-pages/results.json`.

September 10 Audio placement review (Codex agent): Audio hero reuses the same exact WebP. Inspected final built desktop (1440px) and phone (390px at 2×) composition, with 800px/320px layout checks. Existing soft edge masking blends the background; the objects remain fully visible at their intrinsic aspect ratio. No new crop, equipment, physical connection, proportion or texture defect. Empty alt marks decorative artwork. Native SVG service icons were separately checked for consistent strokes and adjacent text labels. Static/reduced-motion presentation; no autoplay. Evidence: `docs/design-concepts/2026-09-10/audio-contact/`.

Archive note: source PNGs, prompts and raw browser-evidence paths above refer to the private recovery archive. The committed production file and hash record are authoritative for the asset gate; see [the evidence index](../design-concepts/README.md).
