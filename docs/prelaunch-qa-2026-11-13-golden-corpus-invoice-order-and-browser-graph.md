# Effect stack, layers 4 and 5 and the invoice event order fix: release gate

Three things are gated: stack 250 (the golden corpus), pull request #251 (the invoice event order fix) and layer 5 (the browser import graph).

Date: November 13, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch for layer 5: `claude/effect-5-browser-graph`, cut from `origin/main` at `527e2c60` and merged with `origin/main` once more after #251 (the merge is clean; the golden fixtures are byte-identical to `origin/main`)
Pull requests: stack 250 (#248 and #249, tests only) is merged; the pull request for layer 5 does not exist when this record is written.
Target: production `https://thesuperhuman.us`
Reviewer: layer 5 was written by a Claude Haiku-class builder subagent working from a brief; no independent review has run on it (see Delivery status). This record does not certify the checks listed as UNVERIFIED.
Rollback revision: for stack 250, the parent of `527e2c60` (`git log --first-parent`); for layer 5, re-check `origin/main` with `git fetch` before merge. This record does not name a deployed revision.

## Scope

Three things are gated here.

1. Stack 250: pull requests #248 and #249, merged to main as `527e2c60` on 2026-11-13. They add the golden corpus (`tests/golden/`), the harness and its helpers, and one `vitest.config.ts` change, and nothing else. `git diff --name-only 527e2c60^1 527e2c60` lists no file under `src/` or `public/` (checked locally: 0 files).
2. Pull request #251, merged to main as `05b669ce` on 2026-11-13: "Apply a paid invoice event whatever order Stripe delivers it in". It changed `src/lib/software-invoices.ts` and `src/lib/audio-payments.ts`, added `src/lib/invoice-event-order.ts` and re-recorded three golden fixtures. This record gates its release evidence only; it does not review its diff.
3. Layer 5 (this branch): a pure restructuring of imports so that browser scripts reach only modules the browser needs. Before it, `src/scripts/agreement-access.ts` reached the `stripe` package through `agreement-fields` and `software-invoices`, and Zod v4 through `agreement-draft` and `agreement-access`; `src/scripts/software-composer.ts` reached `software-offers`, `software-inquiry` and `audio-intake` through `software-projects`. No logic, message, SQL, route or page markup changed. Validators are not converted here: Zod v3 through `astro/zod` stays in the three validators the browser runs (audio intake, software inquiry, agreement client details) until the Zod to Effect Schema pull request.

Module moves (names and behavior unchanged, imports updated in `src/` and `tests/`, no re-exports, no barrel files):

- `src/lib/agreement-fields.ts` to `src/lib/agreement-client-fields.ts`: `cleanText`, `required`, `email`, `clientAgreementSchema`, `ClientAgreement`, `consentText`, `intentText`.
- `src/lib/agreement-draft.ts` to `src/lib/agreement-draft-fields.ts`: `businessTypes`, `states`, `draftSchema`, `AgreementDraft`, `fieldMessages`, `draftFieldErrors`, `resolveClientDetails`. The load, save and prefill functions stay in `agreement-draft.ts`.
- `src/lib/software-projects.ts` to `src/lib/software-project-display.ts`: `evidenceTypes`, `softwareDate`.

Guards extended (tests written first and failing before the moves): `tests/helpers/client-graph.ts` and `tests/architecture/client-graph.test.ts` forbid `xstate`, `zod` (v4), `stripe`, `resend` and `pdf-lib` (and any package depending on them) in any browser entry's graph, with `astro/zod` the one named exception; the set of `src/lib` modules reachable from browser entries must equal a reviewed allowlist in the test; no package but `astro` may be reached; no reachable module may name `cloudflare:`, `node:`, `astro:env/server`, `D1Database`, `R2Bucket` or `KVNamespace`. `tests/architecture/client-bundle.test.ts` fails on built browser scripts that hold `api.stripe.com`, `Stripe-Version` or `$ZodType`.

Also in layer 5: two test fixes that are not part of the restructuring. `tests/architecture/effect-imports.test.ts` failed once in CI with `ENOENT` on a scratch file because it walks the whole repository while `tests/pages/og-tags.test.ts` made and removed a `.og-tags-render-*` directory in the repository root. The walk now skips a root-level dot-directory that holds no tracked file, and skips an untracked path that vanishes after it was listed; a tracked path that vanishes still fails. The og test now builds under `node_modules/.cache/`, where its bare imports still resolve and the walk never looks. A regression test removes scratch directories during the walk.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- Owner, 2026-10-12 (global instructions): Claude subagents may write code in this repository, tests first, with independent Claude review each round and Greptile and Codex review on the pull request.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the layer 5 worktree. No logs retained. Stack 250's CI and live results below are as reported to the builder by the owner's task; the builder did not re-observe them.

Stack 250:

- CI `validate` and Cloudflare Workers Builds succeeded on `527e2c60` (reported, not re-observed here).
- Live `/` and `/work` answered 200 after the merge (reported, not re-observed here).
- No file under `src/` or `public/` changed (observed locally with `git diff --name-only`).

Pull request #251 (as reported to the builder by the owner's task; not re-observed here):

- CI `validate` passed on re-run, after the `effect-imports` flake described above.
- Greptile passed on the final head.
- Three independent review rounds ran; the last was clean.
- Cloudflare Workers Builds succeeded on the merge commit `05b669ce`.
- Live `/`, `/audio` and `/work` answered 200.
- An unsigned POST to the Stripe webhook answered 400.
- A read-only production query for invoices with a recorded paid event but a status other than paid returned zero rows.
- NOT verified: no real payment was run through the new code on production.

Layer 5, local (after merging `origin/main` with #251):

- `pnpm exec biome format .`: no fixes applied.
- `pnpm run check`: 0 errors, 0 warnings, 17 hints.
- `pnpm test`: 257 test files passed; 11,762 tests passed, 1 skipped; run twice, `git status` unchanged by the runs.
- `tests/golden/fixtures/`: no file changed (`git status` shows no change under it); the golden corpus passes unchanged inside those runs.
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 3 tests passed.
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 64 findings, the same as on `origin/main`.

Client bundle, from `pnpm run build` on `527e2c60` and on this branch. Chunks each page loads: its own script chunk, the scripts of the `.astro` components it imports, and every chunk those import statically. Inline scripts have no file in `dist/_astro` and are not counted.

| Page | Before: chunks, raw, gzip | After: chunks, raw, gzip |
| --- | --- | --- |
| `/agreements` | 7, 367,344 B, 72,522 B | 4, 68,277 B, 17,664 B |
| `/offer/[token]/sign` | 7, 367,344 B, 72,522 B | 4, 68,277 B, 17,664 B |
| `/audio/start` | 5, 70,024 B, 19,012 B | 4, 69,860 B, 18,682 B |
| `/software/start` | 5, 80,605 B, 23,132 B | 4, 80,447 B, 22,634 B |
| `/owner/requests/[id]/update` | 5, 83,387 B, 23,621 B | 1, 14,922 B, 4,977 B |

`agreement-access` alone went from 295,962 B raw (52,608 B gzip) to 10,428 B (3,835 B). `ls dist/_astro | wc -l` went from 190 to 187 and `ls dist/_astro/*.js | wc -l` from 35 to 32. `Stripe-Version` appeared 3 times in 1 file before and 0 after; `$ZodType` 2 times in 1 file before and 0 after; `api.stripe.com` 0 after. The `types.*` chunk (Zod v3 from `astro/zod`, about 55 KB raw, 12.6 KB gzip) is still loaded by the audio, software and agreement pages: removing it is the Zod to Effect Schema pull request's job.

Inline scripts: for each of the five pages the set of scripts with no file in `dist/_astro` (for example the `SiteNav`, `Footer` and `SoftwareAgreedTerms` scripts) is the same before and after, and the page script chunks that were external are still external (the `/agreements` and `/offer/[token]/sign` page scripts shrank from 234 to 120 bytes). The comparison is by those five pages, not by every page.

Limits: no browser was run against the new bundles, no deployed response was observed for layer 5, and the size table measures the chunk graph and not a field metric.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: repository `kwilson21/thesuperhuman.us`, tests only for stack 250 and an import restructuring for layer 5. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed in any part.

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed in any part.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed in any part. `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site (layer 5): see the table above; the Stripe SDK and Zod v4 are gone from every browser chunk, and the bundle test now fails if they return. Stack 250 changed no client code: N/A.
- UNVERIFIED, 4.3 Behavior of the changed bundles in a browser: not run; the agreement signing form, the audio intake form, the software inquiry form and the owner update composer were not exercised in a real browser after the change. To be completed after merge.
- N/A, 4.1, 4.4, 4.5 and 4.6: no image changed and no new async path.

### 5. Forms and sensitive flows

- PASS, 5.1 to 5.5 for layer 5 locally: no server code, validator or message changed; the golden corpus (route status, headers, body and outside effects) passes unchanged, and `tests/golden/fixtures/` has no change.
- UNVERIFIED, 5.1 to 5.5 in a real environment for layer 5: the signing form's client-side validation (`resolveClientDetails`) was not observed in a browser. To be completed after merge.
- N/A, 5.1 to 5.6 for stack 250: no route changed.
- PASS, 5.4 and 5.5 for #251 as far as observed (as reported): an unsigned POST to the Stripe webhook answered 400, and a read-only production query for invoices with a recorded paid event but a non-paid status returned zero rows.
- UNVERIFIED, 5.3 and 5.4 for #251: no real payment was run through the new code on production, so the paid-event path was not observed live. To be completed with the first real invoice payment.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no cookie, analytics, legal text or processor changed in any part. #251 changes how a Stripe invoice event is applied to stored invoice rows, not what data is collected.

### 7. Release and final QA

- PASS, 7.1 Required checks (stack 250: reported CI and Workers Builds success on `527e2c60`; #251: reported CI `validate` pass on re-run and Workers Builds success on `05b669ce`; layer 5: local gates above).
- UNVERIFIED, 7.2 Exact diff review on the pull request head and independent code and security review for layer 5: no pull request yet; the review rounds, Greptile and Codex have not run. Stack 250's reviews are not recorded here. #251: Greptile passed on the final head and three independent review rounds ran with the last clean (as reported).
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers for layer 5: no binding, secret or migration changed; nothing deployed.
- PASS, 7.4 Rollback is the previous deployed revision; re-check `origin/main` with `git fetch` before merge.
- PASS, 7.5 for stack 250 (as reported): `/` and `/work` answered 200 after deployment. PASS for #251 (as reported): `/`, `/audio` and `/work` answered 200 and the webhook answered an unsigned POST with 400; UNVERIFIED for #251: a real payment through the new code. UNVERIFIED for layer 5: nothing deployed; to be completed after merge (production revision, `/agreements`, an offer signing page, `/audio/start`, `/software/start`, the owner update page, and the built chunks served from production).
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched; the owner update composer script now imports a smaller module and its page markup is unchanged.

## Delivery status and remaining gates

- UNVERIFIED: independent Claude review rounds, Greptile and Codex on the layer 5 pull request.
- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the layer 5 head.
- UNVERIFIED: live and browser verification of layer 5, to be completed after merge.

No deployment is authorized by this record.

Stack 250: implemented yes, verified locally yes, deployed yes (as reported), verified live partly (`/` and `/work` answered 200, as reported). #251: implemented yes, verified locally yes (as reported), deployed yes (as reported), verified live partly (200 answers, an unsigned webhook POST answered 400 and a zero-row read-only query, as reported; no real payment). Layer 5: implemented yes, verified locally yes, deployed no, verified live no.

Layer 5 was built by a Claude subagent. This record does not certify the checks listed as UNVERIFIED.
