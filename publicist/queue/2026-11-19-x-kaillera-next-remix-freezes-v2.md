---
id: kaillera-next-remix-freezes-x-v2
source: kaillera-next-remix-freezes
platform: x
slot: 2026-11-19T13:00-05:00
kind: backfill
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-remix-freezes
media: src/assets/projects/kaillera-next/remix-freezes-diagram.webp
alt: Diagram of two Smash Remix freezes in Kaillera Next, at match start and on pause, and the shutdown hold that waits for late inputs.
status: draft
---
Smash Remix players in Kaillera Next waited 5 seconds a frame at match start, for menu inputs already used and deleted. On pause, one player's frame count reset and the other's didn't. Both traced from one session's logs; Claude Code fixed both. v0.53.4.
