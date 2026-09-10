# Generated image quality assurance

Required by the owner, September 10, 2026. Applies to every generated or
AI-edited image intended for the website, including decorative art, covers,
icons, social previews, and responsive variants. This is a production requirement;
the automated inventory/hash checks now run through `npm run assets:check` and
automatically before `npm run build`. They do not perform visual inspection.

An approved layout study establishes a visual direction. It does not clear its
embedded objects or text for production. Existing studies remain concept-only
until their production assets pass this process.

## 1. Define the purpose and reference needs

Before generation, record what the image should communicate, where it will
appear, and whether it is decoration, an explanation, or a representation of
something real. Choose the simplest composition that serves that purpose.

Use a trustworthy real-world reference when recognizable equipment, connectors,
mechanical construction, anatomy, or a specific product must be accurate. Inspect
the reference before using it. If accuracy cannot be established, simplify the
depiction into a clearly symbolic illustration or omit the object. Do not fill
gaps with invented technical detail.

Reuse established site assets when the same object appears elsewhere. For Audio,
preserve the accepted headphone design across pages. The selected composition
uses headphones and a notebook as its two principal objects, with simple line
icons for the service descriptions. This is not a requirement to replace the
headphones with a different model or add realistic equipment to fill space.

## 2. Inspect the generated result

Open the actual output and inspect the full composition, then inspect details
at native resolution. Compare with references and existing site assets where
applicable. A successful generation call is not a successful review.

| Check | Pass condition |
| --- | --- |
| Proportions and construction | Objects have credible relative scale, perspective, thickness, symmetry where expected, and recognizable parts. Headphone cups, hinges, and headband fit together. |
| Physical connections | Cables connect to plausible sockets on electronics. They do not terminate in a notebook, float into solid surfaces, or merge with unrelated objects. A cable exiting the crop is acceptable if its visible route makes sense. |
| Spatial logic | Objects have coherent support, contact shadows, overlap, lighting, and depth. Nothing unintentionally floats, intersects, melts, or changes material. |
| Reference accuracy | Required product details match the chosen reference. Generic illustration does not pretend to document the owner's exact equipment or possessions. |
| Image integrity | No accidental duplicates, warped edges, stray parts, gibberish, false logos, unintended marks, broken transparency, halos, or conspicuous generation artifacts. |
| Site consistency | Repeated objects preserve identity; lighting, palette, texture, detail, and icon strokes belong to the same visual family. |
| Meaning | The image helps the page. It does not imply an unsupported capability, real recording, product state, measured result, or employer artifact. |

For explanatory diagrams, verify the relationships, direction of arrows, and
quantities against their source. Prefer HTML or SVG for labels and exact
geometry. Use real screenshots for product evidence. Generated interfaces may
serve as explicitly identified illustrations, never substitute evidence.

## 3. Inspect the delivered asset in the page

Review the final optimized file in its actual desktop and mobile placement.
Check every delivered crop or separately generated variant. Look for:

- Sharp enough edges and texture at the intended display size and pixel density.
- Crops that preserve meaning, plausible connections, and recognizable objects.
- Clean blending against the actual page background, with no visible rectangle
  or transparency fringe unless a frame is intentional.
- Clear separation from real headings, links, controls, and captions. Essential
  text stays in the page, not baked into artwork.
- Appropriate alternative text for meaningful images, or empty alternative text
  for purely decorative images. Color alone must not carry an explanation.
- Correct intrinsic dimensions and responsive sizing, an appropriate delivery
  format, and file cost within the budget measured for the prototype.

For animated layers, also inspect the resting state, motion extremes, mobile
fallback, and reduced-motion view. Layer separation must not expose missing
surfaces, implausible attachments, or a broken scene.

## 4. Record the result and enforce the boundary

Keep one small review record per production asset at
`docs/asset-reviews/<asset-id>.md`. Record only public-safe reference information;
private source material stays with its owner. Use this template:

```markdown
# Asset: <stable name>

- Purpose and placement:
- Final file(s), dimensions, and SHA-256 for each:
- Reference basis and reuse/rights constraints:
- Existing site asset used for consistency, if any:
- Reviewer and date (identify agent or human accurately):
- Detail inspection: pass / fail, with findings
- Physical logic and reference comparison: pass / fail / not applicable, with reason
- Desktop/mobile page inspection: pass / fail, with viewport sizes
- Accessibility, optimization, and optional motion inspection:
- Corrections made and rechecked:
- Outcome: needs revision / ready for production
```

An agent may perform and record QA; it must actually inspect the images and page.
Do not claim human review unless it happened. Passing ordinary QA does not
require a new owner approval every time. A material change to the selected visual
direction still needs the owner's design decision.

Any failed required check keeps the image out of production. Repair, regenerate,
simplify, or replace it, then inspect the new output again. Cropping and
compression can introduce defects, so review applies to exact delivered files,
not just their originals. A changed file hash invalidates its recorded result.

The lightweight check in `scripts/check-asset-qa.mjs` verifies recorded production
files exist, hashes match, and outcomes are ready. It also requires a record for
every image in `src/assets/site`, the canonical generated-art delivery directory.
Each review includes one fenced JSON object with `outcome` and a `files` array of
`path`/`sha256` entries. Additional dimensions and byte counts aid review.
The record is the single
inventory; do not add a competing approval manifest. Pair the check with review
of added or changed image imports and public assets to catch images placed
outside that directory. Keep generated production artwork in `src/assets/site`.
Automation can catch missing records and stale reviews. Physical plausibility
and visual quality require visual inspection.

Before publication, also apply the [publication protocol](publication-agent-protocol.md)
to the image, caption, metadata, and reference disclosures.
