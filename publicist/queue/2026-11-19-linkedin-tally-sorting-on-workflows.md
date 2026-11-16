---
id: tally-sorting-on-workflows-li
source: tally-sorting-on-workflows
platform: linkedin
slot: 2026-11-19T17:30-05:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-sorting-on-workflows
media: src/assets/projects/tally/sorting-workflow-diagram.webp
alt: Diagram of what starts a sort in Tally, one Workflow run, groups of 25, and the read, reserve, ask and save steps with their retries.
status: draft
---
After a bank sync, Tally's AI sorted at most 50 new transactions, because the sync had already used most of its database queries. A new bank's import waited for the night.

Now every sync and every "ask again" hand all their waiting transactions to Cloudflare Workflows, which sorts them in groups of 25.

Each group reads once, asks Jev about each transaction as its own step, and saves every answer in one batch, all or none. Workflows keeps each answer for 3 days, so a step that runs again never asks Jev twice, and one group sorts at a time.

I chose Workflows over a queue. Claude Code built it, and I reviewed it. Built and tested.
