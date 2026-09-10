# Website agent instructions

Read the existing [CLAUDE.md](CLAUDE.md) for repository guidance.
For code changes, follow [docs/coding-approach.md](docs/coding-approach.md).
For public output, apply [docs/publication-agent-protocol.md](docs/publication-agent-protocol.md).
For generated or AI-edited website images, follow [docs/generated-image-qa.md](docs/generated-image-qa.md). Layout approval does not replace production asset QA.
General philosophy is permitted; private operational recipes remain excluded.
Existing checks, permissions, and review requirements still apply.

## Project journal continuity

Read `docs/project-journal.md`. At task start and after compaction, run
`python3 scripts/development_journal.py status`. At meaningful outcomes and before
finishing, append a checkpoint without requiring an explicit logging prompt.
Keep the existing project startup, roadmap, shutdown and publication rules.
A fresh chat is not required each day. Daily thematic names belong to the day
record; conversation titles remain independent browsing labels.

Use actual timestamps in America/New_York. A conversation is not a day: record
known provider/ID and any verified private conversation URL; several conversations
may contribute to one day and a conversation may span many days. Never fabricate
links, scrape transcripts or rename chats to establish chronology.

Choose grounded themes when the outcome supports them. Leave series and season
null until enough recorded history supports coherent groupings; never require
names at bootstrap or invent a phase to fill a field. Review accumulated outcomes
over time, then record the reasoning for inferred series/seasons and update
`docs/journal-context.json` for future checkpoints. These are development groupings,
never curriculum seasons or claimed completion. Preserve earlier classifications
and uncertainty in history; correct by appending.

Nominate meaningful artifact files in checkpoint context, including dependencies
needed to reopen an interactive artifact. The logger saves private copies and
hashes, then rebuilds its day/conversation/theme/series/season index. Save actual
code references, tests, limitations and next work; don't manufacture evidence.

When the date changes during work, finish the bounded task or checkpoint a safe
pause, summarize the prior observed day and carry unfinished work forward. Do not
mark another agent's work complete or create entries for inactive days. If the
project has `journal_hooks.py`, use its existing day-reconciliation protocol.

Private journaling is separate from public publication. Use only the existing
reviewed publication transport, revision checks and receipts. Never publish raw
chat links, journal files or artifacts merely because they were saved. Preserve
corrections/withdrawals and retry the exact accepted identity as required there.

Do not claim hooks, timers, ChatGPT memory or a prompt guarantee automatic durable
writes. Report observed runtime capabilities and pending delivery honestly.
