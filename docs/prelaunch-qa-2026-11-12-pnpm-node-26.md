# pnpm and Node 26 release gate

Date: November 12, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/website-library-additions-904120`
Pull request: [#230](https://github.com/kwilson21/thesuperhuman.us/pull/230)
Target: production `https://thesuperhuman.us`
Reviewer: Claude Haiku 5.5 subagent built; independent Claude Opus and Sonnet subagents reviewed; local evidence collection for owner Kazon Wilson. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: `1d745ba2497e76c60aee8404ab02fe6aa0264dea` (`origin/main` when this record was written)

## Scope

Package manager and Node version only: pnpm 12.20.0 with `pmOnFail: error`, and Node 26 from `.nvmrc`, plus one workflow hardening that follows from them: the Validate workflow now runs the third-party `pnpm/action-setup` action, so its checkout sets `persist-credentials: false` (the Screenshots workflow already did). No public copy, page, asset, route, migration, binding or secret change. No application source change. Scripts changed with the package manager: `scripts/upload-audio.mjs` and `scripts/build-services-pdf.sh` run wrangler through `pnpm exec`; `scripts/screenshots/cache.mjs` keys the screenshot cache on `pnpm-lock.yaml`, so the first Screenshots run recaptures every page; the publicist marker text in `scripts/publicist/lib.mjs` and `AGENTS.md` names `pnpm run publicist:sync` (the gate passes). Other script edits are message text only (`scripts/music-preview.mjs`, `scripts/prepare-music.mjs`, `scripts/publicist/gate.mjs`, `scripts/screenshots/preview.mjs`).

## Owner decisions

- Owner, in conversation, 2026-11-12: use pnpm on the website and Node on the current LTS, matching Tally (kwilson21/tally decisions 203 and 204).

## Evidence and limits

Verify run (local run on macOS arm64, Node 26.13.1, pnpm 12.20.0; no log retained):

- `pnpm install --frozen-lockfile`: `Done in 51ms using pnpm v12.20.0`; `Lockfile is up to date, resolution step is skipped`.
- `pnpm run check`: `Result (465 files)`, 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 143 test files passed; 1777 tests passed, 1 skipped. This includes the 10 tests in `tests/scripts/package-manager.test.ts`, which now assert the `pnpm/action-setup` full-SHA pin, that pnpm is installed before setup-node, and that no workflow runs `npm ci`, `npm run`, `npm test`, `npm install`, `npm i`, `npm exec` or `npx`.
- `pnpm run build`: `Complete!`
- `pnpm why vite`: `vite@6.4.4` (one version).
- `pnpm exec vitest run tests/scripts/package-manager.test.ts` passed. A warning that `astro/tsconfigs/strict` could not be found was observed once in a builder run against an existing `node_modules`. An independent clean-install run under pnpm and under npm did not reproduce it, the config resolves from the repo root, and `astro check` reports the same result as `main`. It is treated as local environment noise, not a repo defect.

- Review on the PR found that pnpm forwards a `--` separator to the script where npm strips it, which made the documented owner commands fail their argument check. The separator is removed from every documented `pnpm run` command, and a test now rejects it.

Earlier run (before this round, from a clean `node_modules`, not re-run here):

- `pnpm install --frozen-lockfile`: `Done in 1.7s using pnpm v12.20.0`. A repeat install printed no "awaiting approval" line.

Lockfile comparison, reported by the independent review, not re-counted here: the same 584 package names. Two resolved versions differ: `magic-string` 1.4.2 to 1.4.3 (dev only), and astro's nested `typescript` 5.9.3 replaced by the root 6.0.3, with generated `.astro/` output byte-identical. Every integrity hash present in both lockfiles for the same package version matches (757 compared). Three devDependencies are now declared because tests import them directly (`esbuild` 0.27.7, `parse5` 7.3.0, `@astrojs/compiler` 2.13.1), at the same versions as before. `allowBuilds`: esbuild, sharp, workerd. The vite override moved to `pnpm-workspace.yaml`. The agent-skills prompt for `@cloudflare/workers-oauth-provider` is denied (`skills: false`).

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: branch `claude/website-library-additions-904120`, tooling-only diff against `origin/main`. Deployment authorization: none. No deployment is authorized by this record.
- N/A, 1.2 Approved design and truthful claims: no page, copy or asset changed.
- N/A, 1.3 Explanatory copy and resume comparison: no explanatory copy, professional claim or stored resume changed.
- N/A, 1.4 First screen and CTA: no page changed.
- N/A, 1.5 Navigation, footer, contact route and external links: no page, link or route changed.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no rendered page, component or layout changed.

### 4. Performance and resilience

- N/A, every item in this section: no page, asset, image, client code or route changed; no performance measurement applies to a tooling-only change.
- N/A, 4.4 and 4.5 (async UI recovery; missing audio, video and external resources), and 4.6 (404 and server-error pages): runtime unchanged; build and CI resilience is covered by the UNVERIFIED Workers Builds and workflow gates below.

### 5. Forms and sensitive flows

- N/A, every item in this section: no form, verification, email or approval-gated flow changed.

### 6. Privacy, legal and measurement

- PASS, 6.1: one new third-party CI action, `pnpm/action-setup`, pinned to a full commit SHA in both workflows; it runs only in GitHub Actions, not on the site. The Validate checkout sets `persist-credentials: false`. No site storage, processor or script changed.
- N/A, every other item in this section: no stored data, cookie, analytics, legal text or external embed changed.
- N/A, 6.6 (error logs and monitoring): runtime unchanged; build and CI resilience is covered by the UNVERIFIED Workers Builds and workflow gates below.

### 7. Release and final QA

- PASS, 7.1 Required type, test and build checks (local runs by the builder and, separately, by an independent reviewer on a clean copy; no log retained; CI rerun pending): `pnpm run check` 0 errors and 0 warnings; `pnpm test` all test files passed; `pnpm run build` complete (see Evidence). Build warnings inspected by the reviewer: the `SESSION` binding note, two empty content folders, two zod comment warnings and one CSS optimization warning, all identical on `origin/main` under npm. Vitest prints a Node `localStorage` ExperimentalWarning, also present before the change.
- UNVERIFIED, 7.2 Exact diff, dependency, generated-file and public-artifact review on the PR head: Pushed and opened as #230 after this record's checks were run; the independent review of the final head is still required.
- UNVERIFIED, 7.3 Production bindings, secrets, migrations, HTTPS, host routing, cache behavior and response headers (not deployed): no binding, secret or migration changed, but no deployed response was observed.
- PASS, 7.4 Rollback version preserved: revision `1d745ba2497e76c60aee8404ab02fe6aa0264dea` is local `origin/main` when this record was written; re-check with `git fetch` before merge.
- UNVERIFIED, 7.5 After authorized deployment, production revision, journeys, sitemap, robots, metadata, missing page, forms and monitoring (not deployed): nothing deployed.
- UNVERIFIED, 7.6 Receipt and QA evidence (UNVERIFIED until the PR head is reviewed and CI and Workers Builds have run; this record is the receipt so far), with the four states reported separately. Implemented: yes. Verified locally: yes. Deployed: no. Verified live: no.

### 8. Private owner center

- N/A, every item in this section: no owner route, owner API, owner storage, payment or Access setting changed.

## Delivery status and remaining gates

- Pushed and opened as #230 after this record's checks were run.
- GitHub Validate and Screenshots workflows on Linux: UNVERIFIED. Not run in this session.
- Cloudflare Workers Builds on the PR head: UNVERIFIED. Must be green, with a log showing Node 26 and pnpm 12.20.0, before merge.
- Dependabot against a pnpm 12 lockfile: UNVERIFIED.
- Independent review of the final head: required before merge; not yet done for this round.

No deployment is authorized by this record.

Built by a Claude Haiku 5.5 subagent; reviewed by independent Claude Opus and Sonnet subagents. This record does not certify the checks listed as UNVERIFIED.
