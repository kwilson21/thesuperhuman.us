---
id: tally-jev-categorization-li
source: tally-jev-categorization
platform: linkedin
slot: 2026-09-30T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-jev-categorization
media: src/assets/projects/tally/jev-categorization-diagram.webp
alt: Diagram of Tally's nightly categorization: merchant rules first, then Jev, with answers applied only at 80% confidence or higher and never over a person's choice.
status: draft
---
Tally has one rule for AI: it suggests, code calculates, and people decide.

Each night, after merchant rules run, Tally asks Jev, an AI classifier, about up to 40 transactions that still need a category. Code applies an answer only when Jev is at least 80% sure, and never over a choice a person or a rule already made. The edit panel shows "Picked by Jev · 93% sure", so you can change it.

After Jev's first run on the demo, Household had turned into a catch-all. So I added a "None of these fit" answer.

Built with Claude Code. The journal entry: https://thesuperhuman.us/building/tally#tally-jev-categorization
