---
id: tally-demo-environment-bsky
source: tally-demo-environment
platform: bluesky
slot: 2026-10-01T13:00-04:00
kind: new
link: https://thesuperhuman.us/building/tally#tally-demo-environment
media: src/assets/projects/tally/demo-environment-diagram.webp
alt: Diagram of Tally's demo: its own database, a nightly reset, and a guard that refuses to run where bank credentials exist.
status: draft
---
Tally's demo resets to a fictional household every night. The reset erases every table, so it also checks for bank credentials, which the real app always has, and refuses to run if it finds any.
