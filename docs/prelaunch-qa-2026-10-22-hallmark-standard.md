# Hallmark design standard release gate

Date: October 22, 2026 (UTC)  
Repository: `kwilson21/thesuperhuman.us`  
Pull request: [#208](https://github.com/kwilson21/thesuperhuman.us/pull/208), "Make Hallmark the site's design standard, with credit", squash-merged to `main` as `362dac5f` on October 22, 2026, pinned to head `3c247304`  
Branch: `claude/hallmark-design-standard`, with `main` merged in after #209 (`ab5704f5`)  
Target: production `https://thesuperhuman.us` after merge  
Reviewer: Claude Code agents, collecting evidence for owner Kazon Wilson. This record is evidence collection, not owner certification.  
Scope: tooling and docs that make Hallmark the design standard, plus one public sentence. The PR adds:
- the vendored skill;
- `design.md` and `docs/design-standard.md`;
- the `CLAUDE.md` and `AGENTS.md` rules and the README credit;
- `npm run design:check` in `prebuild`, with its tests;
- the credit sentence on `/building/personal-website`.

Rollback revision: `4a0ef9b8` (#206), `main` immediately before this PR merged. No migration and no stored data.

## Owner decisions and authorization

- In conversation on October 22, 2026, the owner asked to "bake this skill's standards into the website's design and make hallmark the standard I use for building things from here on out with proper credit given."
- The public credit is the owner's wording: "I feel like "I hold this site to Hallmark, an open-source design standard from Together AI (MIT license)" is enough".
- On usage, the owner asked to keep work light ("I'm running low on usage so if you can achieve this without burning my remaining usage that'd be great"). After the first independent review, follow-up reviews were Codex's.

## Checks

- **PASS · Purpose, authorization and claims.**
  - The owner asked for this change and chose the credit wording.
  - The credit is accurate: MIT license, made by Together AI, upstream `13ac0ec`.
  - The only public copy change is that sentence.
- **PASS · Review.**
  - An independent review confirmed 12 issues across the design check, the docs and the credit; all were fixed.
  - Codex's first code review found 7 issues and its second found 5. Ten were fixed. Two were declined with reasons on their threads: media-query focus matching, and scanning TypeScript-built HTML. Both declines were reported to the owner.
  - Codex security reviews found nothing.
- **PASS · Required checks** on the merged branch:
  - `npm run design:check` passes;
  - `tests/scripts/design-check.test.ts` passes (34 tests);
  - `npm run copy:check` passes.
  - CI runs `npm test` and `npm run build` on the final head before merge.
- **PASS · Build gate.**
  - `prebuild` now also runs `design:check`, so a failing gate stops a deploy build.
  - The eight allowlist entries that #209 made stale are removed. They are the Newsreader and Times New Roman uses and one shadow colour.
  - 12 allowlisted exceptions remain, each with a reason and a count.
- **N/A · Search, accessibility, performance, forms, privacy, owner center and signing.**
  - Only one sentence changes on one page.
  - No route, metadata, form, data flow, header, binding or dependency changes. The vendored skill is not served.
- **PASS · Post-deployment verification.** Before the merge, `validate`, Screenshots `capture` and Workers Builds succeeded on `3c247304`. The production Workers Builds check on `362dac5f` succeeded at 17:18:20 UTC. At 17:18 UTC the coordinating Claude Code session loaded `/building/personal-website` on production with Playwright (Chromium) at 1280x800, 390x844 and 320x640: status 200, the credit sentence and its Hallmark link present, no horizontal overflow and no page errors.
- **PASS · Receipt.** Implemented: yes. Verified locally: yes. Deployed: yes (`362dac5f`, 17:18:20 UTC). Verified live: yes, for the check above.

Deployed and verified live on October 22, 2026.
