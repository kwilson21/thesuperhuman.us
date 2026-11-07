---
id: kaillera-next-reconnects-and-input-audit-li
source: kaillera-next-reconnects-and-input-audit
platform: linkedin
slot: 2026-11-09T13:00-05:00
kind: new
link: https://thesuperhuman.us/building/kaillera-next#kaillera-next-reconnects-and-input-audit
media: src/assets/projects/kaillera-next/reconnects-diagram.webp
alt: Diagram of a Kaillera Next reconnect mid-match before and after the fix, why the server ran out of memory, and the input audit sent as deltas and compared by frame.
status: draft
---
When Kaillera Next's room server restarted mid-match, both players kept playing, alone.

Each player's browser got a new server ID while the game and the direct connection between players kept running. The game took that new ID for a stale player, closed the working connection and waited for a new one that never came.

Now it keeps a live connection and sends messages to the player's new ID.

The restart itself came from running out of memory: a burst of desync logs, each carrying the whole match's input record, piled up on the server. Now each player queues just one upload, and uploads carry only new input records.

Claude Code built the fixes, and I reviewed them. Released in v0.64.1 to v0.65.1.
