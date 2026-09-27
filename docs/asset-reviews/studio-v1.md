# Asset: studio-v1

- Purpose and placement: Quiet-studio hero, Home prototype.
- Reviewer: Codex agent visual review, September 10, 2026. Not human production approval.
- Reference basis: `docs/design-concepts/2026-09-09/home-quiet-studio-v2.png`. Owner-selected original generated illustration; no third-party product photograph or logo. No exact real-world product identity asserted.
- Source original: `docs/design-concepts/2026-09-10/production/studio-v1.png`.
- Delivery: WebP quality 86, 1536 × 1024, 77,884 bytes. Imported directly and served unchanged; no runtime image transformation.
- Detail and physical-logic inspection: pass. Monitor, stand, keyboard, controller, headphone cups/headband, notebook binding, and plant support inspected at 1536 × 1024. Coherent scale, contact shadows, and joints. No visible wiring or generated text. Generic equipment is illustrative, not a claim about owned products.
- Corrections and recheck: Desktop hero initially clipped the headphone headband. Reduced width and moved the composition inward; the final silhouette fits. Mobile uses the same scene below the introduction.
- In-page inspection: pass on 1440px desktop, 800px tablet, and 390px/320px mobile in both development and the locally bundled Worker; complete intended content, no distorted resizing or unreadable required image text.
- Accessibility: decorative image has empty alternative text. Links have visible text or explicit accessible names; meaning is provided in the surrounding HTML.
- Motion: artwork is static. Link-arrow feedback is disabled for reduced motion. No hidden surfaces or disconnected animated parts. (Superseded for Home by the animated layer recorded below, September 27.)
- Publication: no private information, personal portrait, false product evidence, or generated credit. The illustration does not claim a real studio photograph.
- Delivery verification: production HTTP response SHA-256 matches this exact source file. See `docs/design-concepts/2026-09-10/home-prototype/production-results.json`.
- Outcome: ready for production asset use within this prototype. Deployment is a separate step.

Exact delivered-file record:

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/studio-v1.webp",
      "sha256": "762c8f408ce1c7b1881157cdbbf43c635c70fa52ced0d9aa246a0a59a7a05ca2",
      "width": 1536,
      "height": 1024,
      "bytes": 77884
    }
  ]
}
```

## Derived social card, September 10 positioning update

Native HTML composition rendered from `scripts/og.html` to `public/og-image.png`
(1200 × 630, 324,898 bytes; SHA-256 `2b0e7cb6e481c17288adbe61692150f3c66f678ec13ad129a67acc4b5ab58786`).
It reuses the unchanged studio-v1 artwork; no new generated objects or raster
edits were introduced. Codex agent inspected the rendered card at native size:
copy is legible, imagery preserves proportions, soft masks remove rectangular
edges, and the right-edge crop retains recognizable headphones without an
implausible visible connection. No private information or new product evidence.
Outcome: ready for the local preview. The automated source-asset gate still
checks studio-v1; this derived public card has the separate manual review and
hash above. Regeneration requires inspecting the output again.

## Derived social card, September 20 typography update

Regenerated `public/og-image.png` from `scripts/og.html` after switching the
name to the scoped Kazon Name Display font (1200 × 630, 324,671 bytes; SHA-256
`fc54d403540955337ececac09b370a8fdcb72a5a3885ed4bef95945d41d40a4c`). The
horizontal mark is visibly centered over the lowercase `z`, the name remains
legible at social-card scale, and the line breaks, studio artwork, masks,
proportions, and edge crops remain intact. No new generated objects, private
information, or product claims were introduced. Outcome: ready for production
asset use; deployment remains separate.

## Animated layer, September 27

`src/components/home/StudioLife.astro` draws an inline SVG over the unchanged
studio-v1 file, in the image's own 1536 × 1024 coordinates and inside the same
mask. No raster edit and no new generated object; the hash above still applies.

- Monitor: four screen-coloured masks (`#1d1f20`, sampled from the artwork) sit
  over the last four existing code rows, sloped to the screen's perspective, and
  step off to the right behind a caret. No new code is drawn. At every step the
  uncovered part is the artwork's own row; no partial bar or mask edge showed at
  2x on desktop.
- Headphones: three thin terracotta ellipses leave the front ear cup and fade.
  At their widest they cross the headband and desk inside the mask's soft edge;
  they read as a drawn effect, not part of the object.
- Notepad: a terracotta trail starting at the pen tip and a small sun, drawn on
  the page through an affine transform that matches its perspective. A first
  version with hills read as a rotated letter and was replaced. This is the only
  part of the layer in the resting frame.
- Resting state, motion extremes, phone (390px), tablet (900px) and desktop
  (1280px) placements, and the reduced-motion view inspected by Claude Code agent
  visual review, September 27, 2026, and again after a fix that keeps each
  sound ring invisible during its start delay. Not human production approval. With reduced
  motion or without JavaScript the artwork shows unchanged apart from the trail.
- Meaning: the typing re-plays existing illustrated code and asserts nothing; the
  rings and trail are symbolic of sound and sketching, not product evidence.
- Outcome: ready for production use within the Home motion layer; the owner kept
  the trail in the resting frame (September 27). Deployment is a separate step.

Archive note: source PNGs, prompts and raw browser-evidence paths above refer to the private recovery archive. The committed production file and hash record are authoritative for the asset gate; see [the evidence index](../design-concepts/README.md).
