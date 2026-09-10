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

Archive note: source PNGs, prompts and raw browser-evidence paths above refer to the private recovery archive. The committed production file and hash record are authoritative for the asset gate; see [the evidence index](../design-concepts/README.md).
