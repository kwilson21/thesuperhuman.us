# Private review note: template

Structure only. Filled notes live in the private publicist repository at
`review-notes/<project>/<entry-id>/note.md`, with their images in `images/` beside
them, and never in this repository, website content, social posts or public PRs. See [the design](README.md#3-private-review-gate).

The publicist drafts every answer from repository evidence, condenses them into
the Refresher (study material) and writes the Draft entry (the exact public text).
The owner reviews the Draft entry, not the note, and sets its status in "Owner
review". The public entry is the approved draft.

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

## Refresher
A two-minute read before a call. Condensed from the answers below and any walkthrough records beside this note; it adds nothing they don't support. Study material, not something you have to check.

- **In my words:** (optional) your own one or two sentences, added after a walkthrough.
- **One line:** what it is and why it exists.
- **The parts / how:** the pieces and how data or control moves between them.
- **Why this way:** the decision, with the alternative that lost.
- **Weak points:** misuse, failure and trade-offs, and what limits them.
- **Open / don't claim:** unresolved questions and claims to avoid.
- **Status then:** planned, built, tested or available.

**Stories** (one to three, each a few sentences: what went wrong, what we found, what we did)
- **<short title>:** <the arc>

## Draft entry
The exact public text and image, and the part you approve. Under 120 words, first
person, why first. Show visual things with an annotated image instead of describing
them. Credit technical choices an AI made to it ("Claude Code chose...").

**<title>** · <date>
> <entry text>

Image: `images/<file>` (<what it shows>)

## Visual aids
Images in `images/` that explain the work before the questions: screenshots from the
time (demo data), design studies, before and after, and a labeled diagram of how
the parts connect. One line each on what it shows and where it came from.

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
- Draft entry: verified | corrected
- Whiteboard defense: ready | not yet (shipped tier) · not applicable (exploration tier)
- Publish: yes | hold | no
```

"Whiteboard defense" readiness is your own call: `ready` means "I'm comfortable
talking about why this exists and the direction I set". No test sits behind it, and
it never requires recalling choices the draft credits to an AI.

## Walkthrough record (`walkthrough-<date>.md`)

```markdown
---
entry: <entry-id>
date: YYYY-MM-DD
trigger: readiness not yet | owner request
---

## What we walked through
The diagram used, and the path followed (a request, a frame, a deploy), in order.

## Stories told
The stories from the Refresher, and any the owner added.

## Questions the owner asked
Each question and the answer, with links to the evidence.

## In my words (optional)
The owner's own summary, as given, and the tidied line added to the Refresher.
```

Nothing in a walkthrough is scored. The owner alone decides whether readiness
changes.

## Grill session record (`defense-<date>.md`, only when the owner asks)

```markdown
---
entry: <entry-id>
date: YYYY-MM-DD
trigger: readiness not yet | owner request
---

### Q1. <question, e.g. walk me through what happens from request to page>
**Answer (owner, as given):** <verbatim>
**Evidence check:** confirmed / contradicted / missed, with links
**Revisit:** <gap to study, or none>

### Q2. ...

## Summary
Strong areas, gaps to revisit, and the evidence to reread. The owner alone decides
whether readiness changes.
```

## Release note (music)

Sound videos and music releases use this shorter note instead. Tiers and
whiteboard-defense readiness do not apply to it.

```markdown
---
entry: <entry-id>
kind: release
work_dates: YYYY-MM-DD
sources: [release page, distribution links, license or agreement reference]
drafted: YYYY-MM-DD by publicist
reviewed: null
---

## 1. What it is
Title, format, and what the video or post will show.  · status: unverified
## 2. Credits
Every contributor and role, as publicly credited.  · status: unverified
## 3. Rights to publish
Beat or sample licenses, collaborator consent, and whether this upload is allowed.  · status: unverified
## 4. Distribution and Content ID
Where it is already released, and whether automatic copyright matching may claim it.  · status: unverified
## 5. Unresolved
## Owner review
- Corrections: <text or none>
- Publish: yes | hold | no
```

Rules:
- "Owner review" holds only the owner's decisions. The owner writes them, or gives
  them in conversation and the publicist records them exactly as given, with the
  source and date (`- Publish: yes (owner, in conversation, 2026-09-23)`). The
  publicist never infers a decision, never marks an answer verified on its own, and
  never writes the "In my words" line except by tidying what the owner said.
- The Refresher is five to eight bullets plus one to three stories, drawn only from
  the note's answers and walkthrough records. Anything uncertain goes under "Open /
  don't claim", never into a plain statement. After a walkthrough, fold in the
  corrections and the owner's words. Then run `node scripts/build-refreshers.mjs`
  in the private repository so `refreshers/<project>.md` matches, in the same PR.
- "No evidence found" is a valid answer. It stays `unverified`, and the Refresher
  lists it as open.
- A note can be verified with a `hold` decision; the entry then stays unpublished.
- A `shipped` note clears the gate only with readiness `ready`; `not yet` holds it.
  An `exploration` note needs `not applicable`. Any other combination holds it.
- A release note clears the gate only when credits and rights to publish are
  `verified` or `corrected` and the decision is `publish: yes`.
