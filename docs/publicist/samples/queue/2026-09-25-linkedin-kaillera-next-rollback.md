---
id: kaillera-next-c-level-rollback-li
source: kaillera-next-c-level-rollback
platform: linkedin
slot: 2026-09-25T09:30-04:00
kind: backfill
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-c-level-rollback
media: src/assets/projects/kaillera-next/rollback-tick.svg
status: draft
---
A debugging story from kaillera-next, my browser-based retro netplay project.

Rollback netplay hides lag by guessing the other player's next input and rewinding when the guess is wrong. Ours let a phone and a desktop drift apart, even with identical inputs.

The clue: plain lockstep, which never guesses, ran for over 30 minutes with no desync. The emulator was fine. The problem was everything the browser did between replayed frames.

The fix was to move the rewind into the emulator's own C code and replay missed frames in one tight loop.

The full note, with a diagram: https://thesuperhuman.us/building/kaillera-next#kaillera-next-c-level-rollback
