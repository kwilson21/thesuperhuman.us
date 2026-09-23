# Private review note: template

Structure only. Filled notes live in the private publicist repository at
`review-notes/<project>/<entry-id>.md` and never in this repository, website
content, social posts or public PRs. See [the design](README.md#3-private-review-gate).

The publicist drafts every answer from repository evidence. The owner reviews each
answer and sets its status. A public claim may use only `verified` or `corrected`
answers.

```markdown
---
entry: <entry-id>                 # same ID the public entry and posts will use
project: tally | kaillera-next
tier: shipped | exploration       # from publicist/config.json; the owner can override
kind: new | backfill
work_dates: YYYY-MM-DD to YYYY-MM-DD
sources: [PR #, commits, spec/plan/decision paths, intent-log entries, export note IDs]
drafted: YYYY-MM-DD by publicist
reviewed: null                    # the owner sets YYYY-MM-DD
---

## 1. What changed
<answer> · status: unverified | verified | corrected

## 2. How it works, at a high level
Whiteboard level: the parts, how data or control moves between them, and what each
part is responsible for. No line-by-line detail.
<answer> · status: unverified

## 3. Why this approach
The decision, the alternatives considered and why they lost, with the source that
records it.
<answer> · status: unverified

## 4. Misuse and failure cases
How someone could abuse it, what breaks under bad input, load or network loss, and
what limits the damage. For exploration work: known shortcuts taken for speed.
<answer> · status: unverified

## 5. Status at the time
Planned, built, tested or available, as of the work dates, with evidence. Not
today's status unless the entry is new.
<answer> · status: unverified

## 6. Sources checked
Each source with what it supports. Mark anything that could not be opened.

## 7. Unresolved
Questions only the owner can answer, and which public claims wait on each.

## Owner review
Filled in by the owner only.
- Corrections: <text or none>
- Whiteboard defense: ready | not yet (shipped tier) · not applicable (exploration tier)
- Publish: yes | hold | no
```

Rules:
- The publicist never fills in "Owner review" and never marks an answer verified.
- "No evidence found" is a valid answer. It stays `unverified` until the owner
  answers it.
- A note can be verified with a `hold` decision; the entry then stays unpublished.
- A `shipped` note clears the gate only with readiness `ready`; `not yet` holds it.
  An `exploration` note needs `not applicable`. Any other combination holds it.
