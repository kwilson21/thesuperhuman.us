---
id: kaillera-next-remix-freezes-li
source: kaillera-next-remix-freezes
platform: linkedin
slot: 2026-10-05T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-remix-freezes
media: src/assets/projects/kaillera-next/remix-freezes-diagram.webp
alt: Diagram of two Smash Remix freezes in Kaillera Next, at match start and on pause, and the shutdown hold that waits for late inputs.
status: draft
---
Two Smash Remix freezes in Kaillera Next, both traced from one session's logs.

At match start, each player waited 5 seconds a frame for menu inputs that had already been used and deleted. On pause, one player's frame count reset while the other's didn't, so their inputs never lined up again.

Claude Code fixed both, then made the rollback engine wait for late inputs before it shuts down on a pause or match end, so a wrong guess can't quietly leave the two games different. Code review by Greptile caught follow-up issues along the way.

Released in v0.53.4: https://thesuperhuman.us/building/kaillera-next#kaillera-next-remix-freezes
