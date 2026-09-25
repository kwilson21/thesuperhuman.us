---
id: tally-demo-environment-li
source: tally-demo-environment
platform: linkedin
slot: 2026-10-02T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-demo-environment
media: src/assets/projects/tally/demo-environment-diagram.webp
alt: Diagram of Tally's demo: the same code deployed a second time with its own database, a nightly reset, and a guard that refuses to run where bank credentials exist.
status: draft
---
I wanted to try each change to Tally on my phone or laptop without running anything locally.

So the demo is the same code deployed a second time, with its own database, a single public address and only fictional data. Every night it resets to that fictional household.

The reset erases every table. So at my request it also checks for bank credentials, which the real app always has, and refuses to run if it finds any.

Claude Code built the setup and a test that pins those safety settings. Deploying stays a step I run myself. More here: https://thesuperhuman.us/building/tally#tally-demo-environment
