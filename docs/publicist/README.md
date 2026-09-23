# Publicist agent: design proposal

Status: proposal for owner review, 2026-09-23. Nothing here is scheduled, deployed
or posted. The backfill and the Routine are built only after the owner approves
this design. Samples live in [samples/](samples/). The proposed agent instructions
live in [SKILL.md](SKILL.md), and every publicized change passes a private owner
review first ([section 3](#3-private-review-gate)).

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
- **Attribution check needed.** Kaillera-next's commit trailers credit Claude on about 980 commits and Codex GPT-5.5 on 6 (April 27 spec reviews under `docs/team/`). The brief says it was built "partly with ChatGPT/Codex". Entries should say only what the record supports: if ChatGPT shaped direction in conversation, the exports will show it. **Owner question 3 below.**
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
code is not the standard. Proofs of concept, demos and experiments can put speed
first and are not held to that shipping standard, but they are never presented as
if they were. The standard is the owner's to meet: the publicist prepares material
for it, it cannot certify that the owner meets it, and nothing public claims so on
the publicist's word.

**Tiers.** `publicist/config.json` gives each project a default tier that the owner sets:
`shipped` (customer-facing) or `exploration` (PoC, demo, experiment). Each review
note can override it for one change. Proposed defaults: Kaillera-next `shipped`
(a public site people play on); Tally `shipped` (the family relies on it and the
demo is public). Explorations inside a shipped project, such as Kaillera-next's
N64Recomp work, are marked `exploration` on their note. **Owner question 7.**

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

The publicist drafts the answers from repository evidence, cites each source, and
marks every answer `unverified`. The owner reviews the answers, marks each one
`verified` or `corrected`, then decides `publish`, `hold` or `no`. For shipped work
the owner also records whiteboard-defense readiness: `ready` or `not yet`. For
exploration work it is `not applicable`. The publicist never fills in that part.

**Readiness blocks shipped work.** A `shipped`-tier entry clears the gate only
when readiness is `ready`. `not yet` holds the entry, even with every answer
verified and `publish: yes`, until the owner changes it. If the work was really a
proof of concept, the owner can re-tier the note to `exploration` (readiness
`not applicable`); its public copy then cannot present it as shipped. An
`exploration` entry needs readiness `not applicable`. Any other combination is
invalid and holds the entry. This is a conservative default: it keeps public
claims about customer-facing work behind the owner's own shipping standard. The
owner can relax it.

**The gate.** An entry clears the gate when its note has the required answers
`verified` or `corrected`, the decision `publish: yes`, and a readiness value that
fits its tier (above). Within an entry, a public claim may state only what rests on
`verified` or `corrected` answers. A claim that depends on an `unverified` answer is held: it is
left out rather than reworded into something vaguer that implies the same thing, and
if the entry's core claim depends on it, the whole entry waits. An entry whose
claims all rest on verified answers may carry the story contract's
`human-confirmed` basis. That confirms the facts; it says nothing about the
owner's understanding.

**Private storage.** One private GitHub repository, `kwilson21/publicist-private`,
holds the notes and the backfill raw material:

```text
publicist-private/
  review-notes/<project>/<entry-id>.md   one note per publicized change
  state.json                             last merged work drafted into notes
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
2. **Owner review.** In that PR the owner corrects answers, marks them, fills in
   "Owner review", and merges. Merging with some answers still unverified is fine;
   those entries stay held.
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
note answer it supports is verified. It never quotes, links or commits the exports
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

**Approval flow (to confirm).** Two merges, both by the owner. First the private
review-note PR (section 3), then the public PR in this repository with the entries,
media and queued posts that cleared the gate. The owner edits or deletes anything in
either and merges. Merging the public PR is publication approval; Cloudflare's Git
integration then deploys the entries. This matches how the curated
personal-website milestones are approved today. The MCP publication feed stays as
it is for owner-driven sessions. **Owner question 1.**

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
   answers, drafts posts into `publicist/queue/`, records the published entry IDs in
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

**Platforms (recommendation).** Keep two, not three.

- **LinkedIn** is where recruiters and hiring managers already are, the site's main
  professional audience. Posting to your own profile needs only the self-serve
  "Share on LinkedIn" product (`w_member_social`); tokens expire after about 60 days,
  so automated posting needs a re-sign-in roughly every two months.
- **X** already has the account. Since February 2026 its API is pay-per-use:
  about $0.015 per post and $0.20 per post containing a URL, so about 60 linked
  posts a month cost roughly $12.
- **Bluesky** is free to post to through its open API (an app password is enough;
  limits are far above what a person needs), chronological by default, and its
  users skew toward developers and writers who reply. But it is small and
  shrinking: about 10 million monthly app users in mid-2026, roughly half its
  late-2024 peak, and posts reach far fewer people than on X.

Recommendation: **two networks, not three. LinkedIn plus Bluesky as a reset,
with X going quiet.** A third platform works against the goal of doing less. Since
you are open to a reset and not fond of X, Bluesky is the better second network:
your domain becomes your handle (@thesuperhuman.us), it costs nothing to automate,
and its audience is developers who reply. The trade is reach, which LinkedIn
covers. The setup walkthrough, banner draft and profile copy are in
[bluesky/](bluesky/README.md). If you would rather keep X, the design works
unchanged with `platform: x`.

Sources checked 2026-09-23 through search results, because this environment blocks
docs.x.com, docs.bsky.app and learn.microsoft.com. Prices, limits and token rules
are rechecked against those official pages before any automated posting is proposed:
[X API pricing](https://docs.x.com/x-api/getting-started/pricing),
[Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin),
[Bluesky rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits),
[TechCrunch on Bluesky active users (2026-08-11)](https://techcrunch.com/2026/08/11/blueskys-active-user-base-is-shrinking-as-its-focus-expands-beyond-the-app/).

**Support (Ko-fi).** The owner's Ko-fi page, https://ko-fi.com/kazonwilson,
supports all of their work: software projects and audio. It gets a permanent place
rather than a spot in every post:
- **Website:** a "Support my work" link in the footer of every page and in the
  structured-data profile links, proposed as a separate website PR. Because every
  post links to a journal page on the site, readers who want to help can always
  find it. A later option, if wanted: a short support line on the Building project
  pages and the Old News release page.
- **Profiles:** in the pinned Bluesky post, in LinkedIn's contact info (it allows
  several website links) and in the X bio before it goes quiet.
- **Posts:** routine posts keep their one link, to the site. At most one explicit
  support post a month, drafted only when there is a concrete milestone to point to,
  and queued like any other post for the owner's approval.
- **Tone:** plain and specific ("If this work is useful to you, you can support it
  on Ko-fi"). Public copy does not mention employment status; that is the owner's
  to share.

**Quality standards.** Every queued post passes the checklist in
[bluesky/README.md](bluesky/README.md#post-quality-standards-all-platforms)
(one idea, point first, concrete, says why, honest status, plain voice, one real
visual, one link to the site, written for its platform).

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
     the note's required answers are not all `verified` or `corrected`, or its
     decision is not `publish: yes`, or its readiness does not fit its tier
     (`shipped` needs `ready`, `exploration` needs `not applicable`);
   - a post points to an entry that is neither in the PR nor already published;
   - text contains em dashes or matches a secret pattern, or a Tally capture lacks
     its demo-data label.

   It confirms that the approvals exist; it does not check what the copy says.
   It reads the private repository with a fine-grained, read-only token for that
   one repository, stored as an Actions secret and as a Cloudflare build secret
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
verified answers; no script can judge that. **Source fidelity is checked by the
owner reviewing the final public PR** against the notes, claim by claim, before
merging. That review is the claim-level check, and the gate does not replace it.

**Where the file lives.** When the Routine is built the draft moves to one
canonical file that both agents read, so Claude and Codex behave the same:
`.agents/skills/publicist/SKILL.md` (where Codex looks for repository skills) holds
the full instructions; `.claude/skills/publicist/SKILL.md` (where Claude Code looks)
is a stub with the same name and description whose only instruction is to follow the
canonical file. `.gitignore` changes from `.claude/` to `.claude/*` plus
`!.claude/skills/` so the stub can be committed, and `AGENTS.md` and `CLAUDE.md`
each gain one line naming the canonical file. The draft in `docs/publicist/` is
deleted in the same change, so only one maintained copy exists, and the Routine
prompt (appendix) loads that canonical file first. In short:
- Tally content comes only from demo data (seeded fictional household, CI
  screenshots, the public demo). Never production bindings, the family's data, or
  Plaid anything.
- No secrets, tokens, credentials, `.dev.vars`, private URLs or private paths in any
  entry, image, video frame, caption or post.
- Private repositories are excluded unless the owner opts one in by name in
  `publicist/config.json`. `kwilson21/publicist-private` holds review notes and
  exports and is never a publication source in its own right.
- Every publicized change, including every backfill entry, has a private review
  note; public claims rest only on answers the owner verified (section 3). Notes
  never appear in public places, and the publicist never certifies the owner's
  understanding.
- Nothing is published without approval: entries by merge, posts by merge plus
  manual posting (or a separately approved autopost switch).
- Plus the existing publication policy, story requirements, image QA and
  CLAUDE.md rules (no rates, no clearance claims, no exclusivity, no em dashes).

## 10. Questions for the owner

1. **Approval:** is "merge the publicist PR" the right approval for both journal
   entries and post batches? Or should posts get their own PR?
2. **Platforms:** LinkedIn plus Bluesky, with X going quiet (recommended)? If yes,
   follow the [Bluesky setup](bluesky/README.md) and the sample X posts become
   Bluesky posts with the link moved into the link card.
3. **Kaillera-next attribution:** commits credit Claude almost throughout, with
   Codex on six. Where did ChatGPT or Codex shape the work, so entries can say so
   accurately?
4. **Cadence:** start at 2 posts a day and move to 3 once the queue proves it has
   enough good material?
5. **Checkpoint rule:** add the intent-note rule (section 5) to both project
   repositories?
6. **Private repository:** create `kwilson21/publicist-private` for review notes
   and exports, and attach it to the Routine's environment? Or prefer another
   private location that a fresh cloud session can read and write?
7. **Tiers:** Kaillera-next and Tally both `shipped` by default, with individual
   explorations marked on their notes?

8. **Enforcement:** add the `publicist-gate` build step and make `validate` a
   required check (section 9)? It needs one fine-grained, read-only token for the
   private repository, which you create and store as an Actions secret and a
   Cloudflare build secret.

9. **Readiness:** should a `shipped` entry marked `not yet` for the whiteboard
   defense stay held until you mark it `ready` (the proposed default, section 3)?

After approval, in order:
1. Move the skill to its canonical file and add the always-loaded layers, the
   `AGENTS.md` sync check and the `publicist-gate` build step (section 9), before
   any content is drafted.
2. Draft the backfill review notes for your review.
3. Build the two project pages and backfill PRs from the notes you verified.
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
