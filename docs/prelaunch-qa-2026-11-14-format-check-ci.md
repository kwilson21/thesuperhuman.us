# Format check in CI: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-fmt` (pull request #277), built on the lint stack (#256 to #258, merged as `440b28ef`)
Rollback revision: `6c30c5d7`, the first parent of the merge commit `a2bde456`. Reverting that merge commit undoes only this change.

## Scope

Updated after `main` moved: pull request #335 restructured the Validate workflow and added the `pnpm run format:check` step itself (in its `quality` job, after `pnpm run lint`), so this pull request no longer changes the workflow. What it still adds is documentation only: one line each in `CLAUDE.md` and `README.md` saying the check exists and what it covers, this record, and the lint record update described below. No source, test, dependency, configuration or workflow file changes.

This pull request also carries a documentation update for the lint stack that merged before it: `docs/prelaunch-qa-2026-11-13-lint-zero.md` gains a "Merge and deployment" section (merge commit, production build, the two pages checked, rollback), and its release statuses and closing lines are brought in line with that. No other part of that record's evidence changed. `pnpm run format:check` is `biome format .`. Biome checks `src`, `scripts`, `tests` and the root config files named in `biome.json` (including `.astro` and `.mjs` files there); it does not check CSS, Markdown, `package.json`, `.github`, `docs`, or the few generated files `biome.json` excludes.

## Owner decisions

- The owner approved adding the format check to CI as a follow-up to the lint stack (approval relayed to the pull request author, 2026-11-14; not recorded here in the owner's own words). It changes no site behaviour.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- `biome format .` on this branch: 767 files, no fixes applied, exit 0. A reviewer ran it on a copy of `origin/main` as well: clean.
- A throwaway badly formatted `.ts` file made `biome format .` exit 1; a reviewer saw the same for `.astro` and `.mjs` files and saw `.css` and `.md` files not reported. The files were deleted.
- `oxlint --deny-warnings`: exit 0.
- One independent review round for correctness and one for repository rules: no blocker or should-fix item; the wording of the two doc lines was corrected from a nit.
- The step runs on `main` since #335. This pull request's own `validate` run passed on its final head.
- Effect on other work: none from this pull request; the check already applies to every pull request through #335.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. PASS, deployment authorization: merged under the owner's standing rule for a complete pull request; it changes documentation only.
- N/A, 1.2 to 1.5: no page, copy, media, link or route changed.

### 2. Search and sharing

- N/A, 2.1 to 2.7: no page, metadata, asset, route or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, 3.1 to 3.7 and `hallmark audit`: no markup, style or browser script changed.

### 4. Performance and resilience

- N/A, 4.1 to 4.6: no image, client code, dependency or rendered path changed.

### 5. Forms and sensitive flows

- N/A, 5.1 to 5.6: no route, form or flow changed.

### 6. Privacy, legal and measurement

- N/A, 6.1 to 6.6: nothing collected, stored, logged or monitored changed.

### 7. Release and final QA

- PASS (local), 7.1 Required checks: see Evidence and limits. The full test suite and build were not re-run for this branch alone, since no code changed; they ran on the branch stacked above it.
- PASS, 7.2 Diff review: independent review locally, and Codex's code and security reviews of the final head found nothing; no review thread was open at merge. Greptile reviewed only the first head, because its reviews on this repository are paused.
- N/A, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed.
- PASS, 7.4 Rollback version: `6c30c5d7`, the first parent of the merge commit `a2bde456`.
- UNVERIFIED, 7.5 Post-deployment verification, apart from what "Merge and deployment" lists: no journey, form, owner center or payment action was exercised live.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: yes (`a2bde456`). Verified live: two pages answer 200; nothing else.

### Software agreement signing

- N/A: no agreement, signing, template or retention code changed.

### 8. Private owner center

- N/A, 8.1 to 8.15: nothing in the owner center, payments, retention or studio changed.

## Merge and deployment (added after the merge)

- Merged 2026-11-16 UTC as merge commit `a2bde456`, whose first parent is `6c30c5d7`.
- Before the merge, read on the final head: every check passed, including `validate`, and Codex's code and security reviews had no finding.
- Production build: this merge commit got no build check of its own, because another pull request merged to `main` straight after. The Workers Builds check on the next `main` commit, `9eecc5e2`, which contains this merge, completed with success, and `validate` passed on that commit.
- After the merges, `https://thesuperhuman.us/` and `https://audio.thesuperhuman.us/` each answered 200. No other live check was made.
- Rollback: revert the merge commit `a2bde456` to undo only this change.

## Delivery status

Current state: Implemented: yes. Verified locally: yes. Deployed: yes (`a2bde456`). Verified live: two pages answer 200; nothing else.
