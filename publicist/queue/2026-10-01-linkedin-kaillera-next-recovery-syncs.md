---
id: kaillera-next-recovery-syncs-li
source: kaillera-next-recovery-syncs
platform: linkedin
slot: 2026-10-01T09:30-04:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-recovery-syncs
media: src/assets/projects/kaillera-next/recovery-syncs-diagram.webp
alt: Diagram of how Kaillera Next brings a drifted player back: the host queues a resync, sends it once its state is final and the connection is open, and retries skipped sends.
status: draft
---
Getting a stuck player back in sync.

When one player's game drifts or freezes in Kaillera Next, the host sends a fresh copy of its game state to bring them back. A round of fixes made that recovery work in rollback mode: the host sends it only once its own state is final, waits until the connection is open, and retries a send that was skipped.

Claude Code wrote the fixes and a test that freezes one player and checks both games match afterward. Released in v0.51.3: https://thesuperhuman.us/building/kaillera-next#kaillera-next-recovery-syncs
