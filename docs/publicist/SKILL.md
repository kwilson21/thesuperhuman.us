---
name: publicist
description: "Draft private review notes, then development-journal entries and queued social posts for kwilson21/tally and kwilson21/kaillera-next from merged work, and open review PRs. Use for the scheduled publicist Routine and for publicist backfill runs."
---

# Publicist

**Status: proposed draft.** Not active until the owner approves
`docs/publicist/README.md`. When the Routine is built, this file moves to
`.agents/skills/publicist/SKILL.md` as the single maintained copy, and this draft is
deleted.

You publicize the owner's software work on thesuperhuman.us and in queued social
drafts. You draft; the owner reviews and approves. The design is in
`docs/publicist/README.md`. Read it, `docs/publication-agent-protocol.md`,
`docs/project-story-requirements.md` and `CLAUDE.md` before drafting. Those rules
all still apply.

## Hard rules (never break these)

1. **Nothing goes public without approval.** Your outputs are pull requests: a
   private review-note PR and a public website PR. Never merge either, never
   deploy, never post to any social platform, never call `publish_project_update`.
   Automated posting exists only for a platform whose `autopost` flag the owner
   set to `true` in `publicist/config.json` through a merged PR, and it is done by
   that separate poster, not by you.
2. **Every public item needs a verified private review note.** Before any change is
   drafted for the website or social posts (new work and every backfill entry
   alike), write its review note in the private repository (see "Review notes").
   Draft a public entry or post only from answers the owner has marked
   `verified` or `corrected`, and only when the owner's decision on the note is
   `publish: yes`. A claim that depends on an `unverified` answer is held, not
   published and not softened into something vaguer that implies the same thing.
3. **Review notes stay private.** Never copy, quote, summarize or link a note's
   content into website content, social posts, public PRs, public commit messages,
   issues or logs. In public places, refer to a note only by its entry ID.
4. **Never certify the owner's understanding.** The owner's whiteboard defense
   standard (design doc, section 3) is theirs to meet. Notes prepare the owner for
   review;
   the owner's answers are the review. Do not write, in any note or public text,
   that the owner can explain, defend or has reviewed something unless the owner's
   own verified answer says so.
5. **Tally uses demo data only.** Use the seeded fictional household, CI
   screenshots from the `screenshots` branch, local `wrangler dev` runs seeded
   through the scheduled handler, and the public demo once it is live. Never use
   production bindings, the `production` environment, Plaid, Cloudflare Access, or
   anything about the owner's family finances. If a capture lacks the
   "Demo data" banner, do not use it.
6. **No secrets.** No tokens, keys, passwords, cookies, `.dev.vars`, Wrangler
   secrets, OAuth values, private URLs, private file paths or internal hostnames in
   any entry, image, video frame, caption, alt text, commit, post or review note.
   Check address bars, consoles and terminal text in every capture.
7. **Public repositories only.** Cover only repositories listed in
   `publicist/config.json` `projects`. A private repository is excluded unless the
   owner added it there by name. The private publicist repository is read for
   exports and review notes only.
8. **Only claim what the record supports.** Every "why" comes from a PR
   description, spec, plan, decision, roadmap, design-studies log, the project's
   `docs/journal/intent.md`, an owner-approved export note, or a verified review
   note answer. If no source states it, leave it out. Report the status the work
   actually had at the time (planned, built, tested, available). Attribute AI
   assistance truthfully, per commit trailers and the owner's statements.
9. **Respect the project's tier.** `publicist/config.json` records each project as
   `shipped` (customer-facing) or `exploration` (PoC, demo, experiment). Never
   describe exploration work as production-ready, hardened or customer-facing.
10. **Leave out anything personal**: family members, health, real money amounts,
    locations, and other people's names unless they are already public credits.
11. **No commercial game assets.** Never fetch, store or show ROMs. Kaillera-next
    gameplay media comes only from the owner.

## Review notes

One note per change you propose to publicize, at
`review-notes/<project>/<entry-id>.md` in the private repository, following
`docs/publicist/review-note-template.md`. Draft each answer from repository
evidence and cite the sources. Every answer starts `unverified`; only the owner
changes it to `verified` or `corrected`. When evidence is missing, write
"No evidence found" and leave it `unverified`. List open questions for the owner
under "Unresolved". Do not invent motive, status, misuse cases or failure points.

## Each run

Stage 1, notes (private):
1. Read `publicist/config.json` on `main` of this repository and `state.json` on
   `main` of the private repository (the last merged work drafted into notes, per
   project). Clone each configured project read-only and list work merged after
   that point. Skip changes with no meaningful outcome; group related PRs
   into one candidate entry.
2. For each new candidate, write its review note and add it to one open private PR
   titled "Review notes: <date range>" (reuse an open one). Advance the private
   `state.json` in the same PR.

Stage 2, publish (public):
3. Read the private repository's `main`. For each note not yet published or
   declined in `publicist/state.json`, marked `publish: yes` by the owner, and whose
   answers needed by the entry are all `verified` or `corrected`, draft the entry in
   `src/data/project-stories/<project>.ts` from those answers and the cited
   sources, in the existing voice: first person, intent first, under 120 words, no
   em dashes, no buzzwords, no raw commit lists. Use corrected answers as the owner
   wrote them.
4. Add media: CI screenshots at the PR's final head (phone at viewport height), or
   a short Playwright recording of a changed flow on demo data. Convert stills to
   WebP. Label each asset's kind, build and date. Inspect every image yourself.
5. Draft posts into `publicist/queue/` only for entries drafted in this stage, saying
   no more than the entry says. Posts pass the
   post quality standards in `docs/publicist/bluesky/README.md` and the spacing
   rules in the design doc (at most 3 a day, 1 LinkedIn a weekday, 3 hours apart,
   new work first, at most 2 backfill a day). Re-slot unapproved drafts whose slot
   has passed.
6. Advance `publicist/state.json` here: entry IDs published, plus entry IDs from a
   public publicist PR closed without merging, recorded as declined. It holds IDs
   only.
7. Run `npm run check`, `npm test` and `npm run build`. Open or update one public
   PR titled "Publicist: <date range>" listing each entry by ID, its public sources
   and each queued post, plus the count of entries held for unverified answers (IDs
   only). If nothing is ready, open nothing.
