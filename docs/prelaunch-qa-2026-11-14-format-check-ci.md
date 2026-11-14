# Format check in CI: release gate

Date: November 14, 2026
Repository: `kwilson21/thesuperhuman.us`
Target: production `https://thesuperhuman.us`
Reviewer: built with Claude Code and reviewed in independent AI review rounds; Greptile and Codex review on the pull request. Owner review: none yet. This record does not certify the checks listed as UNVERIFIED.
Branch: `claude/followup-fmt`, stacked on `claude/lint-zero-3-enforce` (pull request #258)
Rollback revision: the production revision at merge time; after merge, the merge commit's first parent. Reverting the merge commit undoes only this change.

## Scope

One step, `pnpm run format:check`, added to the Validate workflow after `pnpm run lint`, and one line each in `CLAUDE.md` and `README.md`. No source, test, dependency or configuration file changed. `pnpm run format:check` is `biome format .`. Biome checks `src`, `scripts`, `tests` and the root config files named in `biome.json` (including `.astro` and `.mjs` files there); it does not check CSS, Markdown, `package.json`, `.github` or `docs`.

## Owner decisions

- The owner approved adding the format check to CI as a follow-up to the lint stack (reported by the party coordinating this work, 2026-11-14). It changes no site behaviour.

## Evidence and limits

Local runs on macOS arm64, Node 26.13.1; no logs retained.

- `biome format .` on this branch: 767 files, no fixes applied, exit 0. A reviewer ran it on a copy of `origin/main` as well: clean.
- A throwaway badly formatted `.ts` file made `biome format .` exit 1; a reviewer saw the same for `.astro` and `.mjs` files and saw `.css` and `.md` files not reported. The files were deleted.
- `oxlint --deny-warnings`: exit 0.
- One independent review round for correctness and one for repository rules: no blocker or should-fix item; the wording of the two doc lines was corrected from a nit.
- UNVERIFIED: `validate` with this step in CI, Greptile and Codex on the pull request.
- Effect on other work: once merged, every open pull request must be format-clean under `src`, `scripts` and `tests`.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch and scope: see the header and Scope. Deployment authorization: see Owner decisions.
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
- UNVERIFIED, 7.2 Diff review: independent review done locally; Greptile and Codex not yet read.
- N/A, 7.3 Production bindings, secrets, migrations, routing, cache and headers: none changed.
- UNVERIFIED, 7.4 Rollback version: fixed at merge time.
- UNVERIFIED, 7.5 Post-deployment verification: not deployed.
- PASS, 7.6 Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

### 8. Private owner center

- N/A, 8.1 to 8.15: nothing in the owner center, payments, retention or studio changed.

## Delivery status

Not merged. Depends on pull request #258. This record authorizes neither merge nor deployment.

Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.
