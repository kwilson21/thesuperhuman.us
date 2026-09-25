# Publicist agent: design proposal

Status: approved by the owner, 2026-09-23. The rules are active: the agent
instructions live in
[.agents/skills/publicist/SKILL.md](../../.agents/skills/publicist/SKILL.md), and
every publicized change passes a private owner review first
([section 3](#3-private-review-gate)). Samples live in [samples/](samples/). The
daily Routine is created paused and turned on after the owner reviews a dry run.

The publicist covers `kwilson21/tally` and `kwilson21/kaillera-next` on
thesuperhuman.us and on social media. It extends the existing development journal;
it does not add a second one.

## 1. What already exists (findings)

The existing journal has three layers. Only the middle one fits an unattended agent.

| Layer | Where it lives | How it is approved | Fit for the publicist |
| --- | --- | --- | --- |
| Private checkpoints | `scripts/development_journal.py` writes JSON checkpoints and a Markdown index under `.private/` in the working checkout ([project-journal.md](../project-journal.md)); backed up to D1 by hand ([journal-backup.md](../journal-backup.md)) | Private; never published directly | Not reachable. `.private/` is gitignored and cloud sessions are thrown away, so a fresh Routine session cannot read it. |
| Curated milestones | `src/data/project-stories/personal-website.ts` (and `the-engineers-daily.json`): `Milestone` objects with `id`, `day`, `title`, `status`, `summary`, optional `detail`, `artifacts` and before/after `visualProof` ([project-story.ts](../../src/lib/project-story.ts)) | A PR is merged; Cloudflare's Git integration deploys `main` ([README](../../README.md#deployment)) | **Yes.** Supports screenshots and dated backfill, and approval is a merge. |
| Publication feed | `publish_project_update` over the owner-authenticated MCP at `/api/publication/mcp`, stored in D1 and rendered by `ProjectUpdates` ([publication-mcp.md](../publication-mcp.md)) | The owner's GitHub OAuth grant, per project scope | Not for this. Text only (no media), needs the owner's interactive sign-in, and the `personal-website` scope was still waiting on renewed consent as of 2026-09-21. |

Rules the publicist inherits unchanged:
- [Publication policy](../publication-agent-protocol.md): outcomes over mechanics, no private operating recipes, and a clear split between proposed, implemented, tested and available.
- [Story requirements](../project-story-requirements.md): plain headline, what changed, why it matters, what remains; label concepts, captures and illustrations; do not invent intent; backfill keeps the original date.
- [Image QA](../generated-image-qa.md) for any generated image; real captures are labeled with their build and date.
- Existing voice: first person, short, intent first ("I wanted..."), then what changed, then an optional "What changed" or "Why" detail.

Other findings that shape the design:
- **Tally** is two days old (24 commits, PRs #37, #38, #40, #41, 2026-09-22 to 09-23) with strong intent sources: the spec, 24 numbered decisions, four phase plans, the roadmap and a design-studies log. Its visual direction deliberately shares this site's foundations (decision 20), which is a good cross-link. CI screenshots are on `screenshots` under `pr-<N>/<sha7>/`, taken from the seeded "Rivera family" demo with a "Demo data. Nothing here is real." banner.
- **Kaillera-next** has 1,036 commits from 2026-03-18 to 2026-04-30 (v0.1.0 to v0.49.1), 55 dated design specs and 46 plans. It has a `CLAUDE.md` but no `AGENTS.md`.
- **Attribution check needed.** Kaillera-next's commit trailers credit Claude on about 980 commits and Codex GPT-5.5 on 6 (April 27 spec reviews under `docs/team/`). The brief says it was built "partly with ChatGPT/Codex". Entries should say only what the record supports: if ChatGPT shaped direction in conversation, the exports will show it. **Owner question 7 below.**
- The phone-size CI screenshot is a full-page capture, so the fixed bottom tab bar covers part of the Budget list mid-page. The publicist should use viewport-height captures for phones (or crop above the tab bar) rather than publish that artifact as-is.

## 2. Journal entries

**Placement.** One project page per project, using the existing template:
`/building/tally` and `/building/kaillera-next`, each with `ProjectLayout` and
`ProjectUpdates`, and curated data in `src/data/project-stories/tally.ts` and
`kaillera-next.ts`. On the Building index, the Superhuman Finance row is removed
and replaced by Tally (owner direction, 2026-09-23): Tally is the rebuild of that
app, so the site presents one project, not two. The link to
`finance.thesuperhuman.us` goes away with the row; the old app itself and its DNS
stay untouched until Tally replaces it (Tally decision 16). The Kaillera Next row
gets a "Development journal" link beside its existing external link. This is the same shape as the personal
website page, so there is no new renderer.

**Format.** A `Milestone` object, the same as `personal-website.ts`, plus one small
addition: an optional `links: { label, href }[]` field so each entry can link its
PR, release or demo. That is a two-line type change and a few lines in
`ProjectTimeline.astro`, made in the backfill PR.

Each entry answers four things in under 120 words: what was built, why (from a
cited intent source), what it looks like (one screenshot, recording or labeled
illustration) and where to look (PR, release, demo). `status` names the kind of
work ("Home screen", "Netcode"); the summary says the delivery state honestly
("built, not yet live" until the demo is up).

**Tone.** The existing journal's: first person, plain words, intent before mechanics,
no buzzwords, no em dashes, no raw commit lists. AI use is stated plainly and
positively at the project level ("Built with Claude Code; I set direction and
review every change") and in an entry only when it is the point of the entry.

**Media** stored in `src/assets/projects/<project>/` as WebP for stills and short
MP4 or WebM for video, each captioned with kind ("Browser capture · demo data",
"Concept study", "Illustration"), build (PR and commit) and date.

Samples: [Tally Home screen](samples/entry-tally-home-screen.md) (live-style entry
from PR #41) and [Kaillera-next C-level rollback](samples/entry-kaillera-next-rollback.md)
(backfill entry).

## 3. Private review gate

**Principle: the whiteboard defense** (the owner's standard for responsible AI use).
For customer-facing systems the owner ships, the owner should be able to explain at
a whiteboard how the system works at a high level, defend its key decisions, discuss
how it could be misused, and identify where it can fail. Line-level recall of the
code is not the standard. Nor is instant recall: rereading notes before a
conversation is how the standard is met, not a way around it. Proofs of concept, demos and experiments can put speed
first and are not held to that shipping standard, but they are never presented as
if they were. The standard is the owner's to meet: the publicist prepares material
for it, it cannot certify that the owner meets it, and nothing public claims so on
the publicist's word.

**Tiers.** `publicist/config.json` gives each project a default tier that the owner sets:
`shipped` (customer-facing) or `exploration` (PoC, demo, experiment). Each review
note can override it for one change. Owner decision (2026-09-23): Kaillera-next
`shipped` (a public site people play on) and Tally `shipped` (the family relies on it
and the demo is public). Explorations inside a shipped project, such as
Kaillera-next's N64Recomp work, are marked `exploration` on their note.

**A review note for every publicized change.** Every change the publicist proposes
to publicize, new work and every backfill entry alike, whatever its tier, gets a
private note following [review-note-template.md](review-note-template.md):

1. What changed.
2. How it works, at a high level.
3. Why this approach, including what was rejected.
4. Misuse and failure cases (for exploration work, the shortcuts taken for speed).
5. The work's actual status at the time: planned, built, tested or available.
6. Supporting sources.
7. Unresolved uncertainty, and which public claims wait on it.

**Visual aids in every note.** Each note is a folder with the note and the images
that help the owner re-understand the work before answering: screenshots from the
time (demo data only), the design studies that led to it, a before and after where
there is one, and a simple labeled diagram of how the parts connect. Owner decision
(2026-09-23): the owner may need to relearn what was built before reviewing it, so
the note explains with pictures first. Images follow the same rules as text (no
secrets, no real household data) and stay private; a public entry chooses its own
reviewed media.

The publicist drafts the answers from repository evidence, cites each source, and
marks every answer `unverified`, then condenses them into the note's Refresher
(below) and writes the note's **Draft entry**: the exact public text, with its
image, as it would appear on the site. **The owner reviews the draft, not the note**
(owner decision, 2026-09-23): the publicist presents each draft with at most a few
yes/no questions, and the owner answers in the PR or in conversation ("1-6 ok,
change 3"). The owner marks each draft `verified` or `corrected`, decides
`publish`, `hold` or `no`, and records readiness under the "Whiteboard defense"
label (`ready` or `not yet`; `not applicable` for exploration work). When the owner
gives these decisions in conversation, the publicist records them in "Owner review"
exactly as given, with the source and date, for example
`- Publish: yes (owner, in conversation, 2026-09-23)`; it never infers a decision
the owner did not state. Merging the private PR remains the owner's approval. The
Refresher and detailed answers are study material and evidence, not something the
owner has to check.

**Drafts show, and credit truthfully.** A draft entry leads with why the work
exists, in the owner's voice. When it is about something visual, it shows it: an
annotated screenshot with numbered pointers instead of a paragraph describing the
screen. Technical choices that Claude Code or Codex made are credited to them
("Claude Code chose..."), and the owner is not expected to recall those details
(owner decision, 2026-09-23).

**Readiness blocks shipped work.** Readiness is the owner's own call: "I'm
comfortable talking about why this exists and the direction I set". No test sits
behind it, and it does not require recalling technical choices the draft credits to
an AI. A `shipped`-tier entry clears the gate only when readiness is `ready`.
`not yet` holds the entry, even with a verified draft and `publish: yes`, until the
owner changes it. If the work was really a
proof of concept, the owner can re-tier the note to `exploration` (readiness
`not applicable`); its public copy then cannot present it as shipped. An
`exploration` entry needs readiness `not applicable`. Any other combination is
invalid and holds the entry. Owner decision (2026-09-23): hold.

**Walkthroughs, not exams.** Owner decision (2026-09-23): reinforcement should
never feel like a technical interview. When a shipped entry is held at `not yet`,
or whenever the owner asks, the publicist offers a walkthrough: it leads, like a
colleague showing someone around, starting from the diagram and following one
request or frame through the parts, then telling the note's stories (below). The
owner interrupts and asks anything; nothing is asked of the owner and nothing is
scored. At the end the owner may, if they like, say in a sentence or two how they
would describe the work to a friend; the publicist tidies that into the Refresher's
"In my words" line without judging it. The session is saved as
`walkthrough-<date>.md` in the note's folder. The owner alone then decides whether
readiness becomes `ready`. A question-and-answer grill session is available only
when the owner explicitly asks for one (for example before a big interview); its
record is saved as `defense-<date>.md`.

**Refreshers and stories.** Every note opens with a Refresher: five to eight
bullets the owner can read in two minutes before a call or interview, covering what
it is, how the parts connect, why this approach, the weak points and what is still
open, followed by one to three stories. A story is a short "what went wrong, what we
found, what we did" arc (for example, a player drifting out of sync, the compiler
flag behind it, and the fix); stories are easier to remember than lists and are what
the owner would tell someone on a call. The Refresher is condensed from the note's
answers and any walkthrough records and adds no claim they do not support. After a
walkthrough, the publicist folds any corrections and the
owner's "In my words" line into it. A script in the private repository
(`scripts/build-refreshers.mjs`) collects every refresher into one page per project,
`refreshers/<project>.md`, linked from that repository's README, so the owner has a
single place to read before a conversation. Refreshers are private like the rest of
the note.

**The gate.** An entry clears the gate when its note has a Draft entry marked
`verified` or `corrected`, the decision `publish: yes`, and a readiness value that
fits its tier (above). **The public entry is the approved draft**, changed only for
formatting; any other change goes back to the owner. A claim the owner struck, or
that appears only in the detailed answers, is held: it is left out rather than
reworded into something vaguer that implies the same thing, and if the entry's core
claim depends on it, the whole entry waits. An entry published from an approved
draft may carry the story contract's
`human-confirmed` basis. That confirms the facts; it says nothing about the
owner's understanding.

**Private storage.** One private GitHub repository, `kwilson21/publicist-private`,
holds the notes and the backfill raw material:

```text
publicist-private/
  review-notes/<project>/<entry-id>/
    note.md                              the review note, opening with its Refresher
    images/                              screenshots, studies and diagrams for the owner
    walkthrough-<date>.md                walkthrough records, if any
    defense-<date>.md                    grill records, only when the owner asked for one
  refreshers/<project>.md                every refresher for a project on one page (generated)
  scripts/build-refreshers.mjs           builds those pages; --check reports stale ones
  state.json                             last merged work drafted into notes
  videos/<entry-id>/                     unreleased video scripts, captions, metadata
  exports/claude/  exports/chatgpt/      conversation exports, backfill only
```

This is the practical option that works everywhere: the daily Routine and backfill
sessions both run in fresh cloud containers, which can clone a private repository
and open PRs on it once it is attached to the environment, but cannot reach the
existing `.private/` journal on the owner's machine. It needs no new service, and each review
is a normal PR with history. A private repository is access control, not
encryption, so notes never contain secrets, and misuse answers stay at the level of
"what could go wrong and what limits it", never working attack steps.

**Handoff (the same for backfill and the daily Routine).**

1. **Notes stage.** The publicist drafts notes for new candidates and opens (or adds
   to) one private PR, "Review notes: <date range>". Backfill runs batch about five
   notes per PR, grouped by milestone.
2. **Owner review.** The publicist presents the drafts (in the PR description and
   in conversation) with a few yes/no questions. The owner answers, the publicist
   records the answers in "Owner review" with their source, and the owner merges.
   Merging with some drafts still unapproved is fine; those entries stay held.
3. **Publish stage.** A run reads notes only from the private repository's `main`,
   so an unmerged note can never unlock anything. For each note that clears the
   gate, it drafts the public entry and posts and opens the public PR here.
4. **Approval.** The owner reads the public PR against the notes, claim by claim,
   then merges it. That merge approves the entries and post batch, and the site
   deploys, exactly as before. This review is the source-fidelity check; the build
   gate (section 9) only confirms the approvals exist.

The public PR refers to notes only by entry ID and says how many entries are held.
No note text, summary or link to a private PR appears in this repository, the
website, posts, commit messages or public PR discussion. New work therefore reaches
a public PR one Routine cycle after its notes are merged; the owner can fire the
Routine by hand to skip the wait.

## 4. Backfill plan

Grouped into milestones, dated to when the work happened, marked `backfilled`.
Roughly 5 Tally entries and 12 to 14 Kaillera-next entries. Each claim is checked
against the repository before it is written ("designed" is not "built").

**Tally**

| Day | Milestone | Intent source | Media |
| --- | --- | --- | --- |
| 09-22 | Phase 0: why a new, smaller app (replace the Django app; one family plus a public demo; "explainable in one sentence") | spec §1 to §2, decisions 1, 2, 7 | none or a simple diagram |
| 09-22 | Finding the look: Quiet ledger, then Illustrated ledger | `docs/design-concepts/README.md` rounds 1 to 4 | concept studies, labeled "Concept" |
| 09-22 | 1a design system foundations (#37) | Phase 1a plan, decision 22 | CI capture |
| 09-22 | 1b data and money (#38): integer cents, fictional demo family, nightly reset | Phase 1b plan, decisions 13, 23 | illustration of the money rules |
| 09-23 | 1c-1: screenshots in every PR (#40), then the Home screen (#41) | Phase 1c-1 plan, decision 24 | CI captures; see sample |

**Kaillera-next** (dates from specs, plans and version tags)

| Days | Milestone |
| --- | --- |
| 03-18 to 03-19 | First playable netplay in the browser (v0.1.0) |
| 03-20 to 03-23 | Keeping two emulators identical: determinism patches, desync detection and resync |
| 03-21 to 03-24 | Easier to start a game: P2P ROM sharing, invite links, reconnect and pause |
| 03-23 to 03-24 | Streaming mode and the on-screen gamepad for phones |
| 03-24 to 03-28 | Alpha launch preparation: security headers, self-hosted emulator for cross-origin isolation, error pages, share cards, automatic versioning (v0.8.0) |
| 03-26 to 03-31 | Controllers: settings UI, true analog, compact mobile gamepad |
| 03-29 to 04-02 | Seeing what goes wrong: session logging, feedback, ROM library |
| 04-04 to 04-06 | Smoother 3 and 4 player games, then rollback moved into C (v0.34.0); see sample |
| 04-07 | Launch readiness and reliability telemetry |
| 04-09 to 04-12 | Determinism deep dive: floating point, event queue, deadlock and state-integrity audits |
| 04-10 | Faster startup: core preload and boot-state cache |
| 04-14 | Recognizing the game, including Smash Remix |
| 04-25 to 04-27 | Desync detection and a simpler late join |
| 04-27 to 04-30 | Multi-model spec reviews and a repeatable release cadence (v0.49) |

Explorations such as the N64Recomp integration (04-12) are labeled "explored", not
built. Kaillera-next gameplay footage involves a commercial game, so media is
limited to the lobby and interface, owner-supplied captures, and labeled diagrams.
No ROM files are ever fetched or shown.

**Delivery.** Every backfill entry goes through the review gate first: private
notes in batches of about five, then one public backfill PR per project containing
only entries that cleared it. Its social posts enter the queue at no more than two
backfill posts a day, mixed with new work.

**Conversation exports (backfill only).** They go in the `exports/` folder of the
same private repository, `kwilson21/publicist-private`, under `claude/` and
`chatgpt/`.
The owner downloads each app's official data export (Claude: Settings, Privacy,
Export data; ChatGPT: Settings, Data controls, Export data; confirm the menu names
in the current apps) and commits only the conversation JSON. The publicist reads it
during backfill runs, keeps only threads about these two projects, and uses them
only as sources inside the private review notes, paraphrased and cited as
"conversation export (private)". Nothing from them reaches a public entry unless the
note's approved Draft entry states it. It never quotes, links or commits the exports
anywhere public, and it drops anything personal. If the full export is more than the
owner wants to share, copying the relevant threads into Markdown files in the same
folder works just as well. The owner can delete `exports/` after the backfill; the
review notes stay.

## 5. Checkpoint rule for the project repositories

Proposed text for `tally/CLAUDE.md`, `kaillera-next/CLAUDE.md` and a new
`kaillera-next/AGENTS.md` (so Codex reads it too). Not committed to those repos;
the owner decides.

```markdown
## Journal intent note
In every PR that will be merged, append an entry to `docs/journal/intent.md`
(create it if missing). Newest last, 3 to 5 lines, plain language:

### YYYY-MM-DD · #<PR or issue> · <short title>
- Goal: what someone using it gets.
- Why now: the reason, citing the spec, decision or issue.
- Decided: the choice made and what was rejected.
- Public: yes, or no with a one-word reason (the website skips "no").

This repository is public: no secrets, no real household or user data, no chat quotes.
```

Why a committed file and not the PR description alone: it is reviewed with the
code, survives squash merges, works for any agent with only Git, and a fresh
Routine session can read it from a plain clone. PR descriptions, specs, plans,
decisions and the roadmap stay the first sources; the note fills the gap when a PR
has none.

## 6. Automation

**Approval flow (owner decision, 2026-09-23).** Two merges, both by the owner. First the private
review-note PR (section 3), then the public PR in this repository with the entries,
media and queued posts that cleared the gate. The owner edits or deletes anything in
either and merges. Merging the public PR is publication approval; Cloudflare's Git
integration then deploys the entries. This matches how the curated
personal-website milestones are approved today. The MCP publication feed stays as
it is for owner-driven sessions.

**Routine.** A Claude Code Routine that creates a fresh session on each firing,
in this environment, once a day at 06:30 America/New_York (`30 10 * * *` UTC while
daylight time is in effect; it drifts to 05:30 in winter, which is harmless).
Each run:

1. Reads two state files: `state.json` in the private repository (the last merged
   work drafted into notes, per project) and `publicist/state.json` here (entry IDs
   published or declined, nothing else).
2. Clones both project repos read-only and lists PRs merged since then (merge
   commits on `main`, plus the GitHub API when the repo is attached).
3. For each merged PR, gathers intent from the PR description, linked spec, plan
   and decision entries, and `docs/journal/intent.md`. Skips PRs with no user-visible
   outcome (dependency bumps, formatting) and groups related PRs into one candidate.
4. **Notes stage:** drafts a review note per new candidate and opens or updates the
   private "Review notes" PR in `kwilson21/publicist-private`, advancing the private
   state file in the same PR.
5. **Publish stage:** reads notes from the private repository's `main` and, for
   each one that clears the gate, continues below. Everything else waits.
6. Picks media: the CI screenshot at the PR's final head for Tally; a recording
   when a flow changed (section 7). Converts to WebP.
7. Writes entries into `src/data/project-stories/<project>.ts` from verified
   Draft entries, drafts posts into `publicist/queue/`, records the published entry IDs in
   `publicist/state.json`,
   runs `npm run check`, `npm test` and `npm run build`, and opens one public PR
   titled "Publicist: <date range>", listing entries by ID and the number held.
8. If a publicist PR (private or public) is already open, it adds to that branch
   instead of opening a second one. If the last public publicist PR was closed
   without merging, its entry IDs are recorded as declined so they are not
   redrafted.

State only advances when the owner merges, so nothing is lost or published twice.
Days with nothing new produce no PR.

**Optional trigger on merge.** Not recommended at first. Posts are paced by the
queue, so publishing within minutes of a merge gains little. If wanted later, use
the Routine's own GitHub or API trigger (checked at setup), or a small Action in
each project repo that calls it on `pull_request: closed` with `merged == true`.

## 7. Media

- **Tally screenshots:** reuse CI output from `screenshots:pr-<N>/<sha7>/` at the
  PR's last head (1280×800 desktop; 390×844 phone at viewport height). Always demo data.
- **Tally recordings:** a script in this repo (`scripts/publicist/record.mjs`)
  clones Tally, runs `wrangler dev`, seeds through the scheduled handler as Tally's
  CI does, and runs a short scripted Playwright flow with `recordVideo`
  (for example: open Home, tap the "needs a category" band, categorize one
  transaction). 10 to 20 seconds, no audio, under about 2 MB, with reduced motion
  respected elsewhere. Recorded only when a flow changed. Uses the preinstalled
  Chromium. After Phase 1, flows run against `demo.thesuperhuman.us` instead.
- **Kaillera-next:** lobby and room screenshots from a local server, labeled
  diagrams for netcode ideas, owner-supplied gameplay captures only.
- Every capture is checked visually before it goes in a PR: no real data, no
  secrets or tokens in the address bar or console, no clipped fixed elements.

## 8. Social posts

**Platforms.** LinkedIn plus one short-form network (Bluesky or X). The queue and
the rules below work with any `platform` value, so development updates do not wait
on that choice. The platform comparison and the channel plans (Bluesky, YouTube,
GitHub, Ko-fi) are in [channels/](channels/README.md): one publicist with a playbook
per channel. Channels without an API are handled by the owner from a prepared
checklist, not by a GUI-driving agent.

**Quality standards.** A post goes in the queue only if it passes every check:

1. **One idea.** One outcome, decision or lesson per post. If it needs "and also",
   it is two posts or a journal entry.
2. **Leads with the point.** The first line makes sense on its own in a feed:
   the outcome, the problem, or a concrete detail. No "Excited to share", no
   "Thread", no rhetorical questions.
3. **Concrete.** Names the real thing: the screen, the number, the bug, the rule.
   Every factual claim traces to the journal entry, and a post never says more
   than its entry, which is an approved review-note draft.
4. **Says why.** Includes the reason or the decision, not only what shipped.
5. **Honest status.** "Built, not live yet" when that is true. No implied launches,
   users or results that are not recorded.
6. **Plain voice.** The site's voice: first person, direct, no buzzwords
   (passionate, innovative, game-changer), no em dashes, no hype emoji, at most one
   emoji and usually none. Hashtags: at most two, and only where the platform uses them.
7. **One visual when it helps.** A real capture labeled as demo data, a labeled
   concept or a clean diagram, with alt text that describes what is on screen.
   Never a screenshot containing real data, secrets, notifications or browser
   chrome with private tabs.
8. **One link, to the site.** The journal entry on thesuperhuman.us, not the repo,
   unless the post is about the code itself.
9. **Fits the platform.** LinkedIn: 80 to 180 words, short paragraphs, the story
   version. Short-form networks: within the character limit, one idea,
   conversational. Never the same text pasted to both.
10. **AI stated plainly** when it is relevant ("Built with Claude Code"), as a
    fact about how you work, not a disclaimer or a boast.
11. **Would you reply to comments on it?** If a post would invite a conversation
    you do not want to have, it does not go out.
12. **Read aloud once.** If it sounds like marketing, rewrite it or drop it.

**Queue.** One Markdown file per post in `publicist/queue/`, named
`<slot date>-<platform>-<slug>.md`, with front matter:

```yaml
id: tally-home-screen-li        # stable; never reused
source: tally-home-screen       # the journal entry it promotes
platform: linkedin              # linkedin | x | bluesky
slot: 2026-09-24T09:30-04:00
kind: new                       # new | backfill
link: https://thesuperhuman.us/building/tally#tally-home-screen
media: src/assets/projects/tally/home-desktop.webp
status: draft                   # draft | approved (merged) | posted | skipped
```

**Choosing and spacing.**
- At most 3 posts a day across platforms, and 2 on days without strong material.
  At most 1 LinkedIn post a day, weekdays only. At least 3 hours between posts.
- Priority: a finished milestone with a visual, then a clear "why" story, then
  backfill. New work takes the first slot of the day when any is waiting; backfill
  fills the rest, at most two a day. Within a day, no two posts in a row about
  the same project.
- One journal entry yields at most one post per platform. Small fixes are not posted.
- When a lot lands in one day, the extra posts wait for later slots. The queue
  keeps about a week of approved posts at most; beyond that the weakest are
  dropped, not crammed in.
- Slots: 09:30, 13:00 and 17:30 Eastern on weekdays; 11:00 and 16:00 on weekends.

**Approving a batch.** The drafts are in the same review PR as the journal entries.
Edit or delete files in the PR, then merge; merged files are the approved batch.
Unmerged drafts whose slot has passed are moved to the next open slot by the next run.

**Posting.** Manual at first: each morning, post that day's approved files and set
`status: skipped` on any you pass on (the next PR can include that edit). After a
few batches, if you want, the next step is a proposal (not a switch) for an
automated poster: a scheduled GitHub Action in this repo that posts approved files
from `main` at their slot and records `posted` with the post URL, one platform at
a time, each enabled by a separate PR that sets
`publicist/config.json` `autopost.<platform>: true`. Credentials live only in
GitHub Actions secrets. Nothing is ever posted automatically without that explicit,
per-platform approval.

A sample 3-day queue is in [samples/queue/](samples/queue/).

## 9. Safety rules

**Making the rules non-optional.** A skill alone is not enough. Claude Code and
Codex both load a skill only when the model decides a task matches its description,
so a skill can be skipped. The existing Codex journal works differently: its
protocol is in `AGENTS.md`, which Codex loads into every session. Even that
guarantees the agent *sees* the rules, not that it follows them; `AGENTS.md` itself
says a prompt cannot guarantee durable writes. So the publicist's rules are
enforced in four layers, plus the owner's review of the final public PR:

1. **Always loaded, for both tools.** The rules live in one canonical file (below).
   `CLAUDE.md` pulls it in with Claude Code's `@` import, so every Claude session in
   this repository has it in context from the start, not just when a skill
   matches. `AGENTS.md` has no import mechanism, so a small script copies the
   hard-rules section into a marked block in `AGENTS.md`, and CI fails if the two
   copies differ. That is the same always-loaded mechanism the Codex journal
   protocol uses today.
2. **Explicit entry point.** The Routine prompt (appendix) tells every scheduled
   run to read the canonical file before anything else, so scheduled runs never
   depend on skill matching.
3. **Harness hooks.** A committed Claude Code `SessionStart` hook re-injects the
   hard rules at session start and after context compaction, so a long session
   cannot lose them. Codex supports hooks too (linked from
   [project-journal.md](../project-journal.md)); a matching hook is proposed only
   after checking Codex's current hook docs, and like the existing hook pilot it
   needs the owner's trust to activate.
4. **A mechanical safeguard that does not depend on the model.** A gate script,
   `publicist-gate`, runs as a `prebuild` step, the same way `assets:check` already
   does. Every `npm run build` therefore runs it: the existing `validate` workflow on
   each PR, and Cloudflare's own Workers Build on each PR preview and each
   production deploy. It checks Tally and Kaillera-next journal data, their assets
   and `publicist/queue/`, and fails the build when:
   - an entry or queued post has no note on the private repository's `main`, or
     the note has no Draft entry or it is not `verified` or `corrected`, or its
     decision is not `publish: yes`, or its readiness does not fit its tier
     (`shipped` needs `ready`, `exploration` needs `not applicable`);
   - a post points to an entry that is neither in the PR nor already published;
   - text contains em dashes or matches a secret pattern, or a Tally capture lacks
     its demo-data label.

   It confirms that the approvals exist; it does not check what the copy says.
   It reads the private repository with a fine-grained, read-only token for that
   one repository (Contents: read), named `PUBLICIST_PRIVATE_TOKEN` and stored as an
   Actions secret and as a Cloudflare build secret
   (GitHub does not expose secrets to pull requests from forks). Its log prints only
   entry IDs and pass or fail, never note content. Local builds without the token
   skip the private lookup and say so; CI and deploy builds without it fail. Branch
   protection makes `validate` required, and only the owner merges. It covers only
   the projects in `publicist/config.json`, so the existing personal-website
   journal flow is unchanged.

   **Cost and availability.** This repository is public, and GitHub-hosted
   runners are free for public repositories, including after GitHub's 2026 pricing
   changes, so the gate does not use the included minutes that private repositories
   consume. The private repository runs no workflows at all. And because the same
   gate runs inside Cloudflare's build, an ungated entry cannot deploy even if
   GitHub Actions is down or disabled.

**What each layer can and cannot establish.** Layers 1 to 3 make the agent likely
to get it right the first time. Layer 4 reliably stops the mechanical failures it
checks: a missing or unapproved note, a shipped entry not marked `ready`, a post
without its entry, an em dash, a secret-shaped string, an unlabeled capture. It
cannot tell whether each sentence of the public copy actually follows from the
approved draft; no script can judge that. **Source fidelity is checked by the
owner reviewing the final public PR** against the notes, claim by claim, before
merging. That review is the claim-level check, and the gate does not replace it.

**Where the file lives.** One canonical file that both agents read, so Claude and
Codex behave the same:
`.agents/skills/publicist/SKILL.md` (where Codex looks for repository skills) holds
the full instructions; `.claude/skills/publicist/SKILL.md` (where Claude Code looks)
is a stub with the same name and description whose only instruction is to follow the
canonical file. `.gitignore` changes from `.claude/` to `.claude/*` plus
`!.claude/skills/` so the stub can be committed. `CLAUDE.md` imports the canonical
file, and `AGENTS.md` carries its hard rules in a marked block that
`npm run publicist:sync` writes and the build checks. The Routine prompt (appendix)
loads that canonical file first. In short:
- Tally content comes only from demo data (seeded fictional household, CI
  screenshots, the public demo). Never production bindings, the family's data, or
  Plaid anything.
- No secrets, tokens, credentials, `.dev.vars`, private URLs or private paths in any
  entry, image, video frame, caption or post.
- Private repositories are excluded unless the owner opts one in by name in
  `publicist/config.json`. `kwilson21/publicist-private` holds review notes and
  exports and is never a publication source in its own right.
- Every publicized change, including every backfill entry, has a private review
  note; public entries are drafts the owner approved (section 3). Notes
  never appear in public places, and the publicist never certifies the owner's
  understanding.
- Nothing is published without approval: entries by merge, posts by merge plus
  manual posting (or a separately approved autopost switch).
- Plus the existing publication policy, story requirements, image QA and
  CLAUDE.md rules (no rates, no clearance claims, no exclusivity, no em dashes).

## 10. Questions for the owner

**Decided by the owner (2026-09-23):**

1. **Approval:** two merges. The private review-note PR first, then the public PR
   with journal entries and queued posts. Notes include visual aids (section 3).
2. **Private repository:** the publicist creates `kwilson21/publicist-private`;
   the owner attaches it to the Routine's environment.
3. **Tiers:** Tally and Kaillera-next are both `shipped`; experiments inside them
   are marked `exploration` on their own notes.
4. **Enforcement:** add the `publicist-gate` build step and make `validate` a
   required check. The owner creates the read-only token for the private
   repository and stores it as an Actions secret and a Cloudflare build secret.
5. **Readiness:** `not yet` holds a shipped entry. Readiness is the owner's own
   call, and `not yet` leads to an offered walkthrough, not a grill session
   (section 3, revised 2026-09-23).
5a. **Review level:** the owner approves each note's Draft entry (the exact public
   text and image), not the note; decisions given in conversation are recorded with
   their source; the public entry is the approved draft; technical choices an AI made
   are credited to it (2026-09-23).

**Still open (not blocking):**

6. **Platforms:** LinkedIn plus Bluesky or X. The comparison is in
   [channels/](channels/README.md#feed-platforms) and the Bluesky setup in
   [bluesky/](bluesky/README.md); the queue works with either.
7. **Kaillera-next attribution:** resolved 2026-09-23 from commit trailers, as the
   owner asked: Claude co-authors almost every commit; Codex appears only on six
   spec-review commits on 2026-04-27.
8. **Cadence:** start at 2 posts a day and move to 3 once the queue proves it has
   enough good material?
9. **Checkpoint rule:** add the intent-note rule (section 5) to both project
   repositories?
10. **YouTube:** the open questions are in
    [channels/youtube.md](channels/youtube.md) (style, Old News rights, voice,
    display name, existing videos). Ko-fi's plan was decided 2026-09-25
    ([channels/ko-fi.md](channels/ko-fi.md)).

After approval, in order:
1. Move the skill to its canonical file and add the always-loaded layers, the
   `AGENTS.md` sync check and the `publicist-gate` build step (section 9), before
   any content is drafted.
2. Draft the backfill review notes for your review.
3. Build the two project pages and backfill PRs from the drafts you approved.
4. Create the Routine, paused until you confirm its first dry run.

## Appendix: draft Routine prompt

Written for the built state, after the skill has moved to its canonical location
(section 9). It names only the canonical file, so there is one maintained source of
instructions.

```text
You are the publicist for Kazon Wilson's software projects. Work in the
kwilson21/thesuperhuman.us repository. Load and follow the skill at
.agents/skills/publicist/SKILL.md, which points to the design in
docs/publicist/README.md. First draft private review notes for work merged since
the private repository's state.json and open or update the review-notes PR in
kwilson21/publicist-private. Then, only for notes on that repository's main that
clear the review gate, draft journal entries, media and queued posts and open or
update one public review PR. Never merge, deploy or post anything, and never copy
review-note content into public places. If nothing qualifies, open no PR.
```
