# Asset: controller-v1

- Purpose and placement: decorative illustration; About play chapter and Building Kaillera Next row.
- Reviewer: Codex agent, September 10, 2026. This is agent QA, not owner acceptance of the implemented page.
- Reference basis: Existing interests-v1 production illustration. Original generated artwork already selected by the owner; no third-party photo or logo. The visual study is a style reference, not production evidence.
- Source original: `docs/design-concepts/2026-09-10/production/controller-v1.png`. Prompt: `primary-page-prompts.json` in the same directory.
- Native-resolution inspection: pass. Gray shell, cross D-pad, two center buttons, and four terracotta face buttons retain the accepted identity. Perspective, shell seam, button depth, and contact shadow are coherent. No cable or false branding.
- Delivery: WebP quality 86, 1536 × 1024, 50,928 bytes. Same aspect ratio; no alternate crop or runtime transformation.
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
      "path": "src/assets/site/controller-v1.webp",
      "sha256": "f57fbce2d282e5dcb8539b5f4b23cab30fc9bfe5d13e8304d440c2d0ff7c97b3",
      "width": 1536,
      "height": 1024,
      "bytes": 50928
    }
  ]
}
```

Built-preview verification: the same additional placement passed at 1440px, 800px, 390px (2× density), and 320px (2× density) in the locally bundled Worker on port 4362. HTTP image bytes and SHA-256 matched the source file. Evidence: `docs/design-concepts/2026-09-10/primary-pages/results.json`.
