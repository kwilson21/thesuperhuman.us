---
id: kaillera-next-remix-freezes-x
source: kaillera-next-remix-freezes
platform: x
slot: 2026-10-02T13:00-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-remix-freezes
media: src/assets/projects/kaillera-next/remix-freezes-diagram.webp
alt: Diagram of the two Smash Remix freezes and their fixes.
status: skipped
skip_reason: retired in the 2026-11-07 queue refresh (owner, in conversation, 2026-11-07: "I'd find a way to convert the ones that have potential for high engagement and convert them to a higher engagement format")
---
Smash Remix in Kaillera Next could freeze at match start and on pause. Claude Code fixed both, and the rollback engine now waits for late inputs before it shuts down, so a wrong guess can't quietly leave the games different. v0.53.4.
