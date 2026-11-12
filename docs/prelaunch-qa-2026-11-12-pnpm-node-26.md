# pnpm and Node 26 release gate

Date: November 12, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/website-library-additions-904120`
Pull request: not opened yet when this record was written
Rollback revision: `1d745ba2497e76c60aee8404ab02fe6aa0264dea` (`origin/main` when this record was written)

## Scope

Package manager and Node version only: pnpm 12.20.0 with `pmOnFail: error`, and Node 26 from `.nvmrc`. No public copy, page, asset, route, migration, binding or secret change. No application source change.

## Owner decisions

- Owner, in conversation, 2026-11-12: use pnpm on the website and Node on the current LTS, matching Tally (kwilson21/tally decisions 203 and 204).

## Evidence and limits

Run on Node 26 from a clean `node_modules`:

- `pnpm install --frozen-lockfile`: `Done in 1.7s using pnpm v12.20.0`. A repeat install printed no "awaiting approval" line.
- `pnpm run check`: `Result (465 files)`, 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 143 test files passed; 1775 tests passed, 1 skipped.
- `pnpm run build`: `Complete!`
- `pnpm why vite`: `Found 1 version of vite` (6.4.4).

Lockfile comparison from review: the same 584 package names. Two resolved versions differ: `magic-string` 1.4.2 to 1.4.3 (dev only), and astro's nested `typescript` 5.9.3 replaced by the root 6.0.3, with generated `.astro/` output byte-identical. All 757 integrity hashes match. Three devDependencies are now declared because tests import them directly (`esbuild` 0.27.7, `parse5` 7.3.0, `@astrojs/compiler` 2.13.1), at the same versions as before. `allowBuilds`: esbuild, sharp, workerd. The vite override moved to `pnpm-workspace.yaml`. The agent-skills prompt for `@cloudflare/workers-oauth-provider` is denied (`skills: false`).

## Checklist

- [x] Section 1, project, branch and scope confirmed: PASS (branch and scope above).
- [x] Section 1, approved design and copy preserved: N/A (no page, copy or asset change).
- [x] Section 1, navigation, footer and links: N/A (no page change).
- [x] Section 2 to 6, search, accessibility, performance, forms, privacy: N/A (no public page, form, data or measurement change).
- [x] Section 7, required type, test, asset and build checks: PASS (evidence above).
- [ ] Section 7, exact diff and dependency review on the PR head: UNVERIFIED until the PR is opened and its diff is reviewed.
- [x] Section 7, rollback version preserved: PASS (revision above).
- [x] Section 7, production bindings, secrets, headers and live verification: N/A (not deployed; no binding or secret change).
- [ ] Cloudflare Workers Builds check on the PR head: UNVERIFIED. Its Node version, pnpm version and install command are set in the Cloudflare dashboard, outside the repository. `pmOnFail: error` makes the install fail if that image's pnpm is not 12.20.0.
- [ ] GitHub Validate and Screenshots workflows on Linux: UNVERIFIED. Not run in this session.
- [ ] Dependabot against a pnpm 12 lockfile: UNVERIFIED.

The PR must not merge until the Workers Builds check on the PR head is green and its log shows Node 26 and pnpm 12.20.0.

Built by a Claude Haiku 5.5 subagent; reviewed by independent Claude Opus and Sonnet subagents. This record does not certify the checks listed as UNVERIFIED.
