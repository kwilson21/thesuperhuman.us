# Publicist agent: design proposal

Status: proposal for owner review, 2026-09-23. Nothing here is scheduled, deployed
or posted. The backfill and the Routine are built only after the owner approves
this design. Samples live in [samples/](samples/). The proposed agent instructions
live in [SKILL.md](SKILL.md).

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

## 3. Backfill plan

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

**Delivery.** One backfill PR per project, reviewed like any other. Its social posts
enter the queue at no more than two backfill posts a day, mixed with new work.

**Conversation exports (backfill only).** Simplest path: a **private** repository,
for example `kwilson21/publicist-sources`, with `claude/` and `chatgpt/` folders.
The owner downloads each app's official data export (Claude: Settings, Privacy,
Export data; ChatGPT: Settings, Data controls, Export data; confirm the menu names
in the current apps) and commits only the conversation JSON. The publicist reads it
with read-only access during backfill runs, keeps only threads about these two
projects, and writes paraphrased intent notes into the review PR with the source
recorded as "conversation export (private)". It never quotes, links or commits the
exports anywhere public, and it drops anything personal. If the full export is more
than the owner wants to share, copying the relevant threads into Markdown files in
the same repo works just as well. The owner can delete the repository after the
backfill.

## 4. Checkpoint rule for the project repositories

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

## 5. Automation

**Approval flow (to confirm).** The Routine opens a PR in this repository. The owner
reviews the entries, media and queued posts in that PR, edits or deletes anything,
and merges. Merging is approval; Cloudflare's Git integration then deploys the
entries. This matches how the curated personal-website milestones are approved
today. The MCP publication feed stays as it is for owner-driven sessions.
**Owner question 1.**

**Routine.** A Claude Code Routine that creates a fresh session on each firing,
in this environment, once a day at 06:30 America/New_York (`30 10 * * *` UTC while
daylight time is in effect; it drifts to 05:30 in winter, which is harmless).
Each run:

1. Reads `publicist/state.json` on `main`: the last processed PR and merge time per
   project, plus any declined source IDs.
2. Clones both project repos read-only and lists PRs merged since then (merge
   commits on `main`, plus the GitHub API when the repo is attached).
3. For each merged PR, gathers intent from the PR description, linked spec, plan
   and decision entries, and `docs/journal/intent.md`. Skips PRs with no user-visible
   outcome (dependency bumps, formatting) and groups related PRs into one entry.
4. Picks media: the CI screenshot at the PR's final head for Tally; a recording
   when a flow changed (section 6). Converts to WebP.
5. Writes entries into `src/data/project-stories/<project>.ts`, drafts posts into
   `publicist/queue/`, advances `publicist/state.json`, runs `npm run check`,
   `npm test` and `npm run build`, and opens one PR titled
   "Publicist: <date range>".
6. If a publicist PR is already open, it adds to that branch instead of opening a
   second one. If the last publicist PR was closed without merging, its source IDs
   are recorded as declined so they are not redrafted.

State only advances when the owner merges, so nothing is lost or published twice.
Days with nothing new produce no PR.

**Optional trigger on merge.** Not recommended at first. Posts are paced by the
queue, so publishing within minutes of a merge gains little. If wanted later, use
the Routine's own GitHub or API trigger (checked at setup), or a small Action in
each project repo that calls it on `pull_request: closed` with `merged == true`.

## 6. Media

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

## 7. Social posts

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

## 8. Safety rules

Drafted as [SKILL.md](SKILL.md) (the repo gitignores `.claude/`, so it moves to `.claude/skills/publicist/` with a narrow ignore exception when the Routine is built),
which the Routine prompt loads first. In short:
- Tally content comes only from demo data (seeded fictional household, CI
  screenshots, the public demo). Never production bindings, the family's data, or
  Plaid anything.
- No secrets, tokens, credentials, `.dev.vars`, private URLs or private paths in any
  entry, image, video frame, caption or post.
- Private repositories are excluded unless the owner opts one in by name in
  `publicist/config.json`. The conversation-export repo is read for intent only.
- Nothing is published without approval: entries by merge, posts by merge plus
  manual posting (or a separately approved autopost switch).
- Plus the existing publication policy, story requirements, image QA and
  CLAUDE.md rules (no rates, no clearance claims, no exclusivity, no em dashes).

## 9. Questions for the owner

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
5. **Checkpoint rule:** add the intent-note rule (section 4) to both project
   repositories?
6. **Exports:** willing to create the private sources repository, or prefer to
   paste the relevant threads?

After approval: build the two project pages and backfill PRs, then create the
Routine (paused until you confirm its first dry run).

## Appendix: draft Routine prompt

```text
You are the publicist for Kazon Wilson's software projects. Work in the
kwilson21/thesuperhuman.us repository. Load and follow the skill at
docs/publicist/SKILL.md and the design in docs/publicist/README.md.
Draft journal entries, media and queued posts for work merged since
publicist/state.json, then open or update one review PR. Never merge, deploy or
post anything. If nothing new qualifies, stop without opening a PR.
```
