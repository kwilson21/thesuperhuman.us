# Asset: studio-corner-v1

- Purpose and placement: decorative closing illustration under the private studio sign-in form (`src/pages/studio/sign-in.astro`). It sets a quiet studio mood; it explains nothing and depicts no real room, product or client.
- Reviewer: Claude Code agent visual review, September 23, 2026. Not human production approval.
- Reference basis: owner-supplied GPT generation from the studio sign-in layout study. No third-party photograph, logo or product identity. No recognizable equipment requiring a reference is kept.
- Source and corrections: the 2000 × 667 generation also drew an acoustic guitar on a stand, a crate, books and a window edge, which the prompt excluded. The guitar's strings were indistinct at native resolution, so it could not pass reference accuracy; the right side was cropped away (kept region x 0–1545, y 140–667). Kept objects: a potted plant, a wooden stool, a music stand with blank pages, and a patterned rug on a plank floor. Channel levels were shifted by one or two values so the ground is exactly the site paper, #FBF8F2.
- Detail and physical-logic inspection: pass. Stool legs, rungs and seat meet plausibly; the music stand's tripod, shaft clamps and desk are coherent and its pages carry no notation; the plant pot, leaves and stems are complete; every object rests on the floor with light contact shading; the rug lies flat with fringe at both ends. No text, letters, logos, cables, people or duplicated parts.
- Delivery: WebP quality 86, 1545 × 527, 83976 bytes. Imported directly and served unchanged.
- In-page inspection: pass at 1280px desktop and at 390px phone (2× density) in local `astro dev`. CSS masks fade the top and both side edges into the page so no rectangle shows. On phones the image crops to the plant, stool and stand with `object-fit: cover` anchored left-bottom, keeping them legible.
- Accessibility: decorative; empty alternative text. It sits after the form and never overlaps controls, headings or status text.
- Motion: static.
- Publication: no private information. The drawing does not claim to show the owner's studio.
- Outcome: ready for production asset use on the studio sign-in page. Deployment is a separate step.

Exact delivered-file record:

```json
{
  "outcome": "ready for production",
  "files": [
    {
      "path": "src/assets/site/studio-corner-v1.webp",
      "sha256": "600798ad13b38f2652936aea5d0469e107129843b8040bf83acc49403b9d7d32",
      "width": 1545,
      "height": 527,
      "bytes": 83976
    }
  ]
}
```
