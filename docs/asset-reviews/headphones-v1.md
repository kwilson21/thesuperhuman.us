# Asset: headphones-v1

- Purpose and placement: decorative illustration; About audio chapter.
- Reviewer: Codex agent, September 10, 2026. This is agent QA, not owner acceptance of the implemented page.
- Reference basis: Existing interests-v1 production illustration (retired 2026-09-26; last present at 8a44c76). Original generated artwork already selected by the owner; no third-party photo or logo. The visual study is a style reference, not production evidence.
- Source original: `docs/design-concepts/2026-09-10/production/headphones-v1.png`. Prompt: `primary-page-prompts.json` in the same directory.
- Native-resolution inspection: pass. Two earcups, bronze rings, headband, and hinges retain the accepted design and credible proportions. Both cups join the band; no cables or extra equipment. Decorative generic headphones, not a representation of the owner’s exact equipment.
- Delivery: WebP quality 86, 1536 × 1024, 39,920 bytes. Same aspect ratio; no alternate crop or runtime transformation.
- Page inspection: pass at 1440px desktop and 390px/320px mobile in the development preview, with 800px layout checks. See primary-pages visual evidence. Images retain proportions, stay separate from copy and controls, and blend against the paper background.
- Corrections: CSS edge masks keep rectangular backgrounds out of decorative placements. Building’s small controller received an additional soft edge mask; the image itself is unchanged.
- Accessibility and motion: empty alternative text, with meaning in adjacent HTML. Static artwork; link feedback respects reduced motion. No autoplay. (Superseded by the animated layer recorded below, September 27.)
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

## Animated layer, September 27

Drawn by `src/components/ObjectLife.astro` as an inline SVG in the image's own 1536 × 1024 coordinates, inside the same mask; the file and hash above are unchanged. It plays once when at least half of it is on screen and rests within five seconds; nothing is drawn in the resting frame, so reduced motion, no-JS and print show the untouched art. Inspected at 2x mid-scene on desktop (1280px) and in the phone placement (390px) by Claude Code agent visual review, September 27, 2026, and again after a fix that keeps every ring and glow invisible during its start delay. Not human production approval.

- About (Audio chapter) and the Audio hero: three thin terracotta rings leave the front ear cup (centre measured at 700, 585) and fade. At their widest they pass over the headband and desk inside the soft mask; they read as a drawn effect, not part of the object.
- Outcome: ready for production use within the motion layer. Deployment is a separate step.
