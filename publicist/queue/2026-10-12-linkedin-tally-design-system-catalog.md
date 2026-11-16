---
id: tally-design-system-catalog-li
source: tally-design-system-catalog
platform: linkedin
slot: 2026-10-12T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-design-system-catalog
media: src/assets/projects/tally/design-system-catalog-annotated.webp
alt: The top of Tally's design system catalog on demo data, with numbered pointers to the tiers, sections and the proposals link.
status: skipped
skip_reason: retired in the 2026-11-07 queue refresh (owner, in conversation, 2026-11-07: "I'd find a way to convert the ones that have potential for high engagement and convert them to a higher engagement format")
---
The money input in Tally had drifted from my design, and there was nowhere to see and approve a component on its own.

So Tally now has a catalog at /design-system, in the demo and development only. It renders the app's real components with sample data, so it can't show a copy that has drifted, and marks each one Visual, Interactive or Flow. Claude Code built it, with tests that fail on colors, radii or shadows outside the design tokens.

I then wrote a design brief, and each built screen was audited against it. I decided six proposals by seeing each beside today's version, and each ships in its own PR, so undoing one is a single revert.
