# Portable project journal

A small Python checkpoint logger and agent protocol, independent of a product's
own persistence. Python 3.9+ on macOS/Linux; standard library only. Keep it separate
from learner data, application checkpoints and personal reflections.

The agent runs `python3 scripts/development_journal.py status` at startup and after
compaction. It saves meaningful outcomes with `checkpoint` and JSON stdin, then
uses the private Markdown index at `.private/development/journal/index/index.md`.
`index` returns the same projection as JSON. Existing legacy checkpoints remain
readable; unsupported historical classifications and chat links stay unknown.

## One record, several ways to find it

- **Day:** the logger's actual recording date in America/New_York. A late recap
  states the original work date in its summary; it does not backdate its timestamp.
- **Theme:** a descriptive topic, chosen by the agent from the outcome. A day can
  have several themes; a theme can span days. The day's closing title can summarize
  its arc without renaming the chats.
- **Series:** a continuing development effort.
- **Season:** a meaningful phase inside that effort. No automatic calendar cutoff.
- **Conversation:** provider + stable ID, with optional title and HTTPS URL.
  Multiple chats can link to one day; one chat can link to multiple days. Titles
  are labels, never keys. Only days with a recorded checkpoint are associated.
- **Artifact:** explicitly nominated file, its private snapshot, SHA-256 and the
  checkpoint explaining it. Changed working files cannot rewrite that snapshot.

Series/season start as `null` in `docs/journal-context.json`; bootstrap needs no
name decisions. Agents infer groupings only after enough accumulated outcomes
reveal a coherent effort or phase, record their reasoning, then update defaults.
Until then, logging proceeds with unassigned groups and optional themes. No deterministic script can infer a meaningful
season boundary or validate a thematic interpretation. Explicit checkpoint context
preserves the grouping used then; old records are never silently recategorized.

## Checkpoint input

```json
{
  "id": "stable-outcome-id",
  "title": "Return to a saved method",
  "summary": "What changed, why it helps, and any important limitation.",
  "decisions": [],
  "current": "Current state",
  "next": "Next concrete step",
  "evidence": ["source/file.ts:42 at commit SHA"],
  "verification": ["Name the check actually performed"],
  "context": {
    "series": null,
    "season": null,
    "themes": ["Continuity"],
    "conversations": [],
    "artifacts": [
      {"id":"return-demo","path":"design/return.html","kind":"interactive","caption":"Returning to the saved method"}
    ]
  }
}
```

`context` is optional for backwards compatibility. For CLI checkpoints, absent
context uses current configured working labels. When `CODEX_THREAD_ID` is exposed
by the runtime, the CLI records it automatically, without inventing a URL or
assuming the ID can be opened in another product. A supplied conversation can be
`{"provider":"chatgpt","id":"actual-id","title":"Finding the thread","url":"https://chatgpt.com/c/actual-id"}`.
Use an actual URL from the application, not that example. No URL is required when
unavailable. The index retains observed titles and URLs; changing a title does not
change identity. A retry of the same checkpoint retains its original context and
runtime ID, even in another chat or day.

Nominate all local dependencies of an HTML artifact (CSS, JS, images) as additional
artifact references. Relative paths are preserved under the checkpoint snapshot.
The logger does not discover dependencies, fetch external resources or scan files.
Use source references instead of copying a whole repository. A file must exist
inside the project and be at most 50 MiB. Snapshots are private and never execute
as part of checkpointing. `index` is read-only; the saved index is rebuilt after
every successful checkpoint/retry. JSON checkpoints are authoritative.

## Day transitions and public delivery

Clock grouping is automatic when a checkpoint is written. Reflection, roadmap
reconciliation, thematic naming and seasonal boundaries are agent responsibilities
at safe task boundaries. This does not run when no agent is active. An active hook
can remind the agent, but installation and actual observed events are separate.
The existing TED hook pilot requires owner trust and currently is not activated.

Public updates are an audience-reviewed projection through each project's existing
publication protocol, not a mirror of this private log. Preserve pending payload,
stable event ID, expected revision and verified receipt there. Artifact snapshots
are not public uploads. If the transport lacks artifact references, prepare the
bundle and coordinate the minimal schema change; never send unsupported fields.

## ChatGPT and transfer

ChatGPT Projects can organize chats and supply shared project instructions. That
alone is not evidence of a durable external journal write. In a chat without local
repository tools, use an authorized connected write tool or produce a checkpoint
handoff for the coding agent. Confirm its receipt before calling it saved. No
ChatGPT hook parity, automatic chat-URL discovery or background publisher is assumed.
See [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt),
[apps](https://help.openai.com/en/articles/11487775-apps-in-chatgpt), and
[Codex hooks](https://learn.chatgpt.com/docs/hooks). Checked September 9, 2026.

To bootstrap another project, run the installer from a repository containing this
kit: `python3 scripts/bootstrap_project_journal.py /path/to/project`.
It copies the logger, this guide and an initially unassigned grouping config, adds the private ignore
rule, and appends the protocol to AGENTS.md. It refuses conflicting existing files;
it does not activate hooks, copy journal data, create credentials or publish anything.
For another machine, transfer `scripts/development_journal.py`,
`scripts/bootstrap_project_journal.py`, and `templates/project-journal/` together.

## This website

Installed September 10, 2026 using the kit from The Engineer's Daily commit
`21f3ecb`. This repository contains the installed logger and companion guidance;
the bootstrap installer itself remains in the source kit. No hooks or publisher
were activated. The first checkpoint is an explicitly retrospective record.

The owner authorized `.private/` for local storage and a separate Cloudflare D1
database for backup. Follow [backup and recovery](journal-backup.md) after meaningful
checkpoint batches. A checkpoint is saved locally first; report a cloud backup as
verified only after its readback succeeds. No automatic background backup runs.
