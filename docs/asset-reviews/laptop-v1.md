# Asset: laptop-v1

- Purpose and placement: decorative illustration; About software chapter.
- Reviewer: Codex agent, September 10, 2026. This is agent QA, not owner acceptance of the implemented page.
- Reference basis: Approved About personal-path study. Original generated artwork already selected by the owner; no third-party photo or logo. The visual study is a style reference, not production evidence.
- Source original: `docs/design-concepts/2026-09-10/production/laptop-v1.png`. Prompt: `primary-page-prompts.json` in the same directory.
- Native-resolution inspection: pass. Laptop screen, hinge, base, regular key grid, trackpad, and plant have plausible proportions and support. No cables or additional hardware. Screen uses a symbolic code mark, not a product screenshot; tiny key legends carry no information. No exact real-world model is asserted.
- Delivery: WebP quality 86, 1536 × 1024, 50,684 bytes. Same aspect ratio; no alternate crop or runtime transformation.
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
      "path": "src/assets/site/laptop-v1.webp",
      "sha256": "268ded88717eff298eea792eda12483ed8b765b90a2e9a312a52b647181ec08f",
      "width": 1536,
      "height": 1024,
      "bytes": 50684
    }
  ]
}
```

Built-preview verification: the same additional placement passed at 1440px, 800px, 390px (2× density), and 320px (2× density) in the locally bundled Worker on port 4362. HTTP image bytes and SHA-256 matched the source file. Evidence: `docs/design-concepts/2026-09-10/primary-pages/results.json`.

Archive note: source PNGs, prompts and raw browser-evidence paths above refer to the private recovery archive. The committed production file and hash record are authoritative for the asset gate; see [the evidence index](../design-concepts/README.md).

## Animated layer, September 27

Drawn by `src/components/ObjectLife.astro` as an inline SVG in the image's own 1536 × 1024 coordinates, inside the same mask; the file and hash above are unchanged. It plays once when at least half of it is on screen and rests within five seconds; nothing is drawn in the resting frame, so reduced motion, no-JS and print show the untouched art. Inspected at 2x mid-scene on desktop (1280px) and in the phone placement (390px) by Claude Code agent visual review, September 27, 2026, and again after a fix that keeps every ring and glow invisible during its start delay. Not human production approval.

- About (Software chapter): a soft cream glow rises and fades behind the `</>` on the screen (centre 712, 427), and a caret beside it blinks twice. No new glyph or interface is drawn; the glow stays inside the screen. (Superseded October 22, below.)
- Outcome: ready for production use within the motion layer. Deployment is a separate step.

## Animated layer, October 22: the glyph is typed again

The owner picked "Re-type the glyph" (Hallmark design-audit board D2.4-C), so the caret belongs to something being typed. `src/components/ObjectLife.astro` still draws in the image's own coordinates, inside the same mask; the file and hash above are unchanged, and no new glyph, interface or raster is added.

- Layer: three covers, one per character of the existing `</>` ("<" at x 633 to 682, "/" at 693 to 731, ">" at 743 to 790, all within y 373 to 480, measured on the file), filled with a linear gradient fitted to the screen pixels around the glyph (from `#26241f` at 625, 490 to `#37342f` at 809, 335: the file's colours multiplied by the page paper, as the page shows the art). When the scene plays, the covers hide the glyph and the caret (the same cream bar as before) starts at its left edge; the covers lift at 0.9, 1.2 and 1.5 seconds, each as the caret steps past its character; the caret then blinks twice and leaves at 2.7 seconds, and the scene ends at 3.1 seconds. The glow plays as before. Nothing is drawn in the resting frame, so reduced motion, no-JS and print show the untouched art.
- In-page inspection (Claude Code agent visual review, October 22, 2026; not human production approval): the scene captured at 2x density mid-play and at rest on desktop (1280 × 800) and in the phone placement (390 × 844): the moment the covers go up, each character's arrival, the caret's last position, both blinks and the resting frame. No cover edge, rectangle or colour step was visible against the screen at either size, with or without the glow over it; each cover hides its whole character, antialiased edge included; the caret sits after each character in turn and never over one. Reduced-motion view: the untouched art. The scene rests within about three seconds.
- Meaning: the typing re-plays the artwork's own symbolic code mark and asserts nothing.
- Outcome: ready for production use within the motion layer. Deployment is a separate step.
