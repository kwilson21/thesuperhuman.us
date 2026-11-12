# pnpm and Node 26 release gate

Date: November 12, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/website-library-additions-904120`
Pull request: not opened yet when this record was written
Target: production `https://thesuperhuman.us`
Reviewer: Claude Haiku 5.5 subagent built; independent Claude Opus and Sonnet subagents reviewed; local evidence collection for owner Kazon Wilson. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `1d745ba2497e76c60aee8404ab02fe6aa0264dea` (`origin/main` when this record was written)

## Scope

Package manager and Node version only: pnpm 12.20.0 with `pmOnFail: error`, and Node 26 from `.nvmrc`, plus one workflow hardening that follows from them: the Validate workflow now runs the third-party `pnpm/action-setup` action, so its checkout sets `persist-credentials: false` (the Screenshots workflow already did). No public copy, page, asset, route, migration, binding or secret change. No application source change.

## Owner decisions

- Owner, in conversation, 2026-11-12: use pnpm on the website and Node on the current LTS, matching Tally (kwilson21/tally decisions 203 and 204).

## Evidence and limits

Verify run (local run on macOS arm64, Node 26.13.1, pnpm 12.20.0; no log retained):

- `pnpm install --frozen-lockfile`: `Done in 51ms using pnpm v12.20.0`; `Lockfile is up to date, resolution step is skipped`.
- `pnpm run check`: `Result (465 files)`, 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 143 test files passed; 1777 tests passed, 1 skipped. This includes the 10 tests in `tests/scripts/package-manager.test.ts`, which now assert the `pnpm/action-setup` full-SHA pin, that pnpm is installed before setup-node, and that no workflow runs `npm ci`, `npm run`, `npm test`, `npm install`, `npm i`, `npm exec` or `npx`.
- `pnpm run build`: `Complete!`
- `pnpm why vite`: `vite@6.4.4` (one version).
- `pnpm exec vitest run tests/scripts/package-manager.test.ts` printed a warning that `astro/tsconfigs/strict` could not be found from the root `tsconfig.json`. It was not investigated in this run; the tests passed.

Earlier run (before this round, from a clean `node_modules`, not re-run here):

- `pnpm install --frozen-lockfile`: `Done in 1.7s using pnpm v12.20.0`. A repeat install printed no "awaiting approval" line.

Lockfile comparison, reported by the independent review, not re-counted here: the same 584 package names. Two resolved versions differ: `magic-string` 1.4.2 to 1.4.3 (dev only), and astro's nested `typescript` 5.9.3 replaced by the root 6.0.3, with generated `.astro/` output byte-identical. Every integrity hash present in both lockfiles for the same package version matches (757 compared). Three devDependencies are now declared because tests import them directly (`esbuild` 0.27.7, `parse5` 7.3.0, `@astrojs/compiler` 2.13.1), at the same versions as before. `allowBuilds`: esbuild, sharp, workerd. The vite override moved to `pnpm-workspace.yaml`. The agent-skills prompt for `@cloudflare/workers-oauth-provider` is denied (`skills: false`).

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes and scope confirmed: branch `claude/website-library-additions-904120`, tooling-only diff against `origin/main`.
- N/A, 1.2 Approved design and truthful claims: no page, copy or asset changed.
- N/A, 1.3 Explanatory copy and resume comparison: no explanatory copy, professional claim or stored resume changed.
- N/A, 1.4 First screen and CTA: no page changed.
- N/A, 1.5 Navigation, footer, contact route and external links: no page, link or route changed.
- N/A, deployment authorization (separate from 1.1): No deployment is authorized by this record.

### 2. Search and sharing

- N/A: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A: no rendered page, component or layout changed.

### 4. Performance and resilience

- N/A: no page, asset, image, client code or route changed; no performance measurement applies to a tooling-only change.

### 5. Forms and sensitive flows

- N/A: no form, verification, email or approval-gated flow changed.

### 6. Privacy, legal and measurement

- N/A: no stored data, cookie, analytics, legal text or external embed changed.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks: `pnpm run check` 0 errors and 0 warnings; `pnpm test` all test files passed; `pnpm run build` complete (see Evidence).
- UNVERIFIED, 7.2 Exact diff, dependency, generated-file and public-artifact review on the PR head: the PR is not open; the independent review of the final head is still required.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers (not deployed): no binding, secret or migration changed, but no deployed response was observed.
- PASS, 7.4 Rollback version preserved: revision recorded above.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, sitemap, robots, metadata, missing page, forms and monitoring (not deployed): nothing deployed.
- PASS, 7.6 Receipt and QA evidence, with the four states reported separately. Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

### 8. Private owner center

- N/A: no owner route, owner API, owner storage, payment or Access setting changed.

## Delivery status and remaining gates

- Push and pull request: not done when this record was written. No push, no PR, no merge.
- GitHub Validate and Screenshots workflows on Linux: UNVERIFIED. Not run in this session.
- Cloudflare Workers Builds on the PR head: UNVERIFIED. Must be green, with a log showing Node 26 and pnpm 12.20.0, before merge.
- Dependabot against a pnpm 12 lockfile: UNVERIFIED.
- Independent review of the final head: required before merge; not yet done for this round.

No deployment is authorized by this record.

Built by a Claude Haiku 5.5 subagent; reviewed by independent Claude Opus and Sonnet subagents. This record does not certify the checks listed as UNVERIFIED.
