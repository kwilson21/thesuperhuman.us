---
id: kaillera-next-recovery-syncs-bsky
source: kaillera-next-recovery-syncs
platform: bluesky
slot: 2026-09-30T13:00-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-recovery-syncs
media: src/assets/projects/kaillera-next/recovery-syncs-diagram.webp
alt: Diagram of how Kaillera Next brings a drifted player back with a resync from the host.
status: skipped
skip_reason: retired in the 2026-11-07 queue refresh (owner, in conversation, 2026-11-07: "I'd find a way to convert the ones that have potential for high engagement and convert them to a higher engagement format")
---
When a Kaillera Next player drifts or freezes, the host sends a fresh copy of its game state. Now it waits until its own state is final and the connection is open, and retries a skipped send.
