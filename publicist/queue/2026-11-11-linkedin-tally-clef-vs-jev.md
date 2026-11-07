---
id: tally-clef-vs-jev-li
source: tally-clef-vs-jev
platform: linkedin
slot: 2026-11-11T09:30-05:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-clef-vs-jev
media: src/assets/projects/tally/clef-vs-jev-chart.webp
alt: Chart of right picks, middle confidence and transactions sorted at the 80% cutoff, for Jev, Clef and Clef-flash with 7 and 50 categories, on 36 invented demo transactions.
status: draft
---
Clef picked categories about as well as Jev, but its middle confidence was 41% to Jev's 91%. So Jev stays in Tally.

Cloudflare released Clef, a decision model that answers in the same format as Jev, the AI classifier Tally uses to sort transactions. Switching would remove one outside service and one secret, so I wanted numbers first.

A small tool that is never deployed asked Jev, Clef and Clef-flash Tally's own request about 36 invented demo transactions, with 7 categories and with 50.

At Tally's 80% cutoff, Clef would sort 6 transactions to Jev's 14, and none with 50 categories.

Claude Code built the tool to my design, and I reviewed it.
