# Effect stack, pull requests 255 and 254 and layer 7 (the validators the browser runs): release gate

Three things are gated: pull request #255 (the bundler manifest guard), pull request #254 (the Quint model, the LemmaScript contract and two audio payment fixes) and layer 7 (the three validators that run in both the browser and the server, moved from Zod to Effect Schema).

Date: November 13, 2026
Repository: the personal website repository
Branch for layer 7: `claude/effect-7-validators`, cut from `origin/main` at `2f0969ac` (the merge of #254)
Pull requests: #255 is merged as `88551410`; #254 is merged as `2f0969ac`; layer 7 has no pull request number yet.
Target: production
Reviewer: layer 7 was written by a Claude builder subagent working from a brief (tests first). Independent review rounds and Greptile and Codex on the pull request head are not recorded here; they are in Delivery status as UNVERIFIED. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: for #255, the parent of `88551410`; for #254, the parent of `2f0969ac` (`git log --first-parent`); for layer 7, re-check `origin/main` with `git fetch` before merge. No deployed revision was observed by the builder.

## Scope

1. Pull request #255, merged to main as `88551410`: the bundler manifest guard. The client build records every module it puts in each browser chunk, and `tests/architecture/client-bundle.test.ts` checks that list against reviewed lists. This record gates its release evidence only; it does not review its diff.
2. Pull request #254, merged to main as `2f0969ac`: a Quint model of invoice event handling, a LemmaScript contract for a pure money rule and two audio payment fixes. This record gates its release evidence only; it does not review its diff.
3. Layer 7 (this branch). It converts exactly three validators from Zod 3 (`astro/zod`) to Effect Schema, and changes nothing else about what a visitor sees:
   - `validateIntake` in `src/lib/audio-intake.ts` (browser caller `src/scripts/audio-intake.ts`, server `src/pages/api/audio-intake.ts`);
   - `validateSoftwareInquiry` in `src/lib/software-inquiry.ts` (browser caller `src/scripts/software-inquiry.ts`, server `src/pages/api/software-inquiry.ts`);
   - `resolveClientDetails` in `src/lib/agreement-draft-fields.ts` with the draft and client readers in it and in `src/lib/agreement-client-fields.ts` (browser caller `src/scripts/agreement-access.ts`; server callers `src/pages/api/offer/[token]/draft.ts` and `review.ts`, `src/lib/agreement-draft.ts`, `src/lib/software-agreements.ts`).

   The field helpers that `src/server/edge.ts` already had (`readFields`, `readVariants`, `textField`, `stringField`, `choiceField`, `fieldOf`) moved to `src/lib/fields.ts`, outside `src/server/**`, because a browser bundle may not import from there; `src/server/edge.ts` re-exports them and keeps the readers that run an Effect. They no longer need `effect/Effect`, so browser source imports five effect modules and no more: `effect/Schema`, `effect/SchemaGetter`, `effect/SchemaIssue`, `effect/Result` and `effect/Predicate`. The server-only Zod schemas that compose `cleanText`, `required` and `email` (the owner agreement routes and `agreementDetailsSchema` and `contractorSchema`) belong to areas not converted yet, so they keep a Zod copy of those three helpers in `src/server/agreement-zod-fields.ts` until those areas convert; a test holds the copies to the same answers.

Owner decision, 2026-11-13: validation moves from Zod to Effect Schema everywhere, including browser forms, and about 26 KB gzip per form page is accepted.

## Owner decisions

- Owner, in conversation, 2026-11-12: use Effect for rules, Effect Schema for input and XState with the bridge, matching Tally; convert one area at a time; no behavior change.
- Owner, in conversation, 2026-11-13: validation moves from Zod to Effect Schema everywhere, browser forms included; about 26 KB gzip per form page accepted.
- Owner, 2026-10-12 (global instructions): Claude subagents may write code in this repository, tests first, with independent Claude review each round and Greptile and Codex review on the pull request.

## Evidence and limits

All layer 7 runs are local on macOS arm64, Node 26, pnpm 12.20.0, in the layer 7 worktree. No logs retained. Results for #255 and #254 below are as reported to the builder by the owner's task; the builder did not re-observe them.

Pull request #255 (as reported, not re-observed here):

- Cloudflare Workers Builds succeeded on the merge commit `88551410`.
- Live `/`, `/audio/start`, `/software/start`, `/agreements` and `/work` answered 200.
- The manifest answered 404 at three guessed paths (it is written outside `dist/`, so it is not served).

Pull request #254 (as reported, not re-observed here):

- CI `validate`, Greptile and Workers Builds passed on the final head.
- Two independent review rounds ran.
- A read-only production query for parked paid events returned zero rows.
- Live verification of the merge commit `2f0969ac`: UNVERIFIED, to be recorded in the next pull request.
- NOT verified: no real payment was run through the new code.

Layer 7, local (on `origin/main` at `2f0969ac`, with the layer 7 commit):

- `pnpm exec biome format .`: no fixes applied.
- `pnpm run build`: `Complete!`
- `REQUIRE_CLIENT_BUNDLE=1 pnpm exec vitest run tests/architecture/client-bundle.test.ts`: 27 tests passed.
- `pnpm test`: 262 test files passed; 11,858 tests passed, 1 skipped; run twice, `git status` unchanged by the runs.
- `pnpm run verify:quint` and `pnpm run verify:quint:mutants`: every line `ok`. `pnpm run verify:dafny`: not run; `dafny` is not installed on this machine (the command stops with "dafny not found on PATH").
- `pnpm run publicist:gate`: `publicist-gate passed: 84 entries checked.`
- `pnpm exec oxlint`: 61 problems, not above the 64 on `origin/main`.
- `tests/golden/fixtures/`: `git diff origin/main --stat -- tests/golden/fixtures` is empty; the golden corpus passes unchanged inside the test runs.
- `pnpm run check`: `Result (717 files): 0 errors, 0 warnings, 19 hints`.

No behavior change, shown by differential tests. `tests/fixtures/legacy-validators/` keeps the four Zod 3 validator modules as frozen reference copies (no file under `src/` imports them; `tests/architecture/legacy-validators.test.ts` checks that). `tests/server/validators-differential.test.ts` runs the Zod copy and the Effect version on the same generated inputs and requires the same ok flag, the same values, the same error keys in the same order and the same message text, where a thrown error counts as an answer:

| Validator | Inputs | Differences |
| --- | --- | --- |
| `validateIntake` | 13,491 | 0 |
| `validateSoftwareInquiry` | 28,179 | 0 |
| `resolveClientDetails` | 17,211 | 0 |
| draft reader (`readDraft`) | 15,169 | 0 |
| client reader (`readClientAgreement`, `parseClientAgreement`) | 11,311 | 0 |

The inputs are seeded and per field cover: missing, `null`, every wrong type Zod names (number, `NaN`, boolean, array, object, bigint, symbol, function, date, map, set, promise), empty, blank, at the maximum and either side of it, far over it, padded, line breaks, tabs and other control characters, lone surrogates, text that normalises under NFC, characters outside the BMP, markup, emails of many shapes including the Zod 3 pattern's odd cases and lengths at 120 and 320, links of every scheme with credentials and spaces, every enum value and a non-member, extra keys, own `__proto__` and `constructor` keys, each `path` variant, the cross-field rules and bodies that are not objects. A deliberately broken validator (a maximum off by one) fails the test, so the harness can see a difference. The hand-picked lists in `tests/server/edge-equivalence.test.ts` (72 and 66 inputs) now compare the real validators with the frozen copies. Two rules are asserted about the Zod behavior the Effect version copies: a text that is too long is not read for control characters, and the email check and the 320 limit both run. Error key order is always compared. The key order of a successful value is compared too (as `JSON.stringify` writes it) for the intake, the draft and the client details, because the draft is stored with `JSON.stringify` and the signing step compares two `JSON.stringify` strings of the client details. The software inquiry's value is the one exception: its `path` key comes last, where Zod put it after the common fields, and the test compares that value with keys sorted. Nothing writes, stores or loops over a whole `SoftwareInput` or `IntakeInput` (`softwareRequest` and `ownerRequestForIntake` pick keys by name; `softwareRequest` reads a Map built from the entries), so the order is not observable; that was checked by reading the callers, not by a test.

Changes to existing tests and shared helpers, for the reviewer: `tests/server/edge.test.ts` renamed the `other` body kind to `bigint` (the body kinds now follow Zod's names: `nan`, `bigint`, `symbol`, `function`, `promise`, `map`, `set` and `date` replace `other`, and `receivedKind` names a promise, a map, a set and a date); `tests/api/software-inquiry.test.ts` lost two assertions on the Zod source text of the `updates` choice (the behavior below them, a plain "Choose one." sentence for a missing or unknown value, is still asserted); `tests/lib/software-agreements.test.ts` calls `parseClientAgreement` and `readClientAgreement` where it called `clientAgreementSchema`. `fieldOf` and `stringField` in `src/lib/fields.ts` no longer run an Effect (a filter then a synchronous decode), which also changes the already converted contact and resume paths (`src/server/contact-input.ts`), held there by `tests/server/edge-equivalence.test.ts` and the golden corpus, both passing. Parameters that took `unknown` now take `RawValue`, an alias of `unknown` that the repository's Oxlint rule accepts; it is a naming change, not a narrower type.

Client bundle, from `pnpm run build` on `2f0969ac` and on this branch. Chunks each page loads: its own script chunk and every chunk it imports statically.

| Page | Before: chunks, raw, gzip | After: chunks, raw, gzip |
| --- | --- | --- |
| `/audio/start` | 4, 69,860 B, 18,655 B | 4, 63,297 B, 22,603 B |
| `/software/start` | 4, 80,447 B, 22,591 B | 4, 72,488 B, 26,096 B |
| `/agreements` | 4, 68,277 B, 17,633 B | 4, 60,703 B, 21,350 B |
| `/offer/[token]/sign` | 4, 68,277 B, 17,633 B | 4, 60,703 B, 21,350 B |

The shared `types.*` chunk (Zod 3 from `astro/zod`, 55,190 B raw, 12,606 B gzip) is gone; the shared `fields.*` chunk (Effect Schema and the field helpers, 47,310 B raw, 16,120 B gzip) replaces it. Net, a form page is about 3.5 to 4 KB gzip heavier and lands at 21 to 26 KB gzip in total, `/software/start` being the largest at 26 KB. `ls dist/_astro | wc -l` is 187 before and after, and the `.js` count is 32 before and after. The scripts inlined into pages (the `SiteNav`, `Footer`, `SoftwareAgreedTerms`, owner and studio scripts, and the others listed by the server manifest) are the same set before and after; the four page scripts above were not inlined before (they import chunks) and are not inlined after. No browser chunk holds `eval(` or `new Function`. The Content Security Policy is `script-src 'self'`, report-only.

Guard experiments (each by editing a real browser script, running the walker and the bundle test, then reverting):

- A script importing `effect/Effect` and running `Effect.runSync`: the source walker failed (two tests); the bundle test passed, because the Schema bundle already holds the runtime parts `runSync` uses. The walker carries that rule, by design.
- A script importing `effect/Layer`: the source walker failed, and so did the bundle test (the `~effect/Layer` marker).
- A script importing `astro/zod`: the source walker failed (it reaches `zod`), and the bundle test failed twice (the `ZodString` and `ZodEffects` markers, and `zod` not on the reviewed package list).

Limits: no browser was run against the converted validators here. The differential tests exercise the validators, not the pages. The golden corpus covers the routes. No production build was exercised in a browser, no deployed response was observed for layer 7, and the size table measures the chunk graph and not a field metric. The thrown errors are not identical: `parseDraft` and `parseClientAgreement` throw a `FieldsRefused` whose message is a JSON array that starts with `[` as a Zod error's message did, but whose text and class name differ. Every throw site was read: `reviewAgreements` and `signAgreements` (`parseClientAgreement`) are inside `try` blocks whose catch either answers a fixed sentence (the sign route) or shows `error.message` only when it does not start with `[` (the review route), so the visitor sees the same sentence; `saveAgreementDraft` (`parseDraft`) is inside the draft route's catch-all (a fixed 409 sentence) and the review route's catch; `prefillAgreementDraft` and `loadAgreementDraft` are called in the `sign.astro` frontmatter with no catch, so a throw there is an unanswered 500 as before, and only a log line differs. No code reads `error.name`, and the `instanceof z.ZodError` check in `src/pages/api/owner/requests/[id]/software.ts` wraps only server-only Zod schemas and calls no converted function. The exotic wrong types (bigint, symbol, function, date, map, set, promise, `NaN`) are matched, but no caller can send most of them.

## Checklist

### 1. Purpose and content

- PASS, 1.1 Project, branch, local changes, scope and rollback confirmed: the website repository; #255 and #254 are merged; layer 7 changes validators, guards and instructions. No deployment is authorized by this record.
- N/A, 1.2 to 1.5: no page, copy, asset, link or navigation changed. Every message a visitor reads is unchanged (shown by the differential tests).

### 2. Search and sharing

- N/A, every item in this section: no page, metadata, sitemap, robots, icon or structured data changed in any part.

### 3. Accessibility and responsive behavior

- N/A, every item in this section: no markup or style changed in any part. `hallmark audit` not run because no page design changed.

### 4. Performance and resilience

- PASS, 4.2 Client code against the built site (layer 7): see the table above; Zod 3 is gone from every browser chunk and Effect Schema is the only Effect code in them, and the bundle test fails if Zod returns or the Layer runtime appears.
- PASS, 4.2 for #255 (as reported): live pages answered 200 and the manifest was not served (404 at three guessed paths).
- UNVERIFIED, 4.3 Behavior of the four changed pages in a browser: no browser run for layer 7. To be completed after merge.
- N/A, 4.1, 4.4, 4.5 and 4.6: no image changed and no new async path.

### 5. Forms and sensitive flows

- PASS, 5.1 to 5.5 for layer 7 locally: the three validators answer every generated input as before (zero differences) and the golden corpus (route status, headers, body and outside effects) passes unchanged, with no change under `tests/golden/fixtures/`.
- UNVERIFIED, 5.1 and 5.2 for the audio intake, software inquiry and signing forms in a browser and against live services. To be completed after merge.
- PASS, 5.4 and 5.5 for #254 as far as observed (as reported): a read-only production query for parked paid events returned zero rows. UNVERIFIED, 5.3 and 5.4 for #254: no real payment was run through the new code.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no cookie, analytics, legal text or processor changed in any part.

### 7. Release and final QA

- PASS, 7.1 Required checks: layer 7 local gates above (format, build, bundle test, `pnpm test` twice, Quint, publicist gate, oxlint, golden fixtures); #255 and #254 as reported. `pnpm run check`: 0 errors, 0 warnings, 19 hints (717 files). `verify:dafny` not run here (Dafny is not installed).
- UNVERIFIED, 7.2 Exact diff review on the pull request head and independent code and security review for layer 7: not yet run. #254: Greptile passed on the final head and two independent review rounds ran (as reported).
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers for layer 7: no binding, secret or migration changed; nothing deployed.
- PASS, 7.4 Rollback is the previous deployed revision: the parents of `88551410` and `2f0969ac`; for layer 7 re-check `origin/main` with `git fetch` before merge.
- PASS, 7.5 for #255 (as reported): `/`, `/audio/start`, `/software/start`, `/agreements` and `/work` answered 200 after the merge. UNVERIFIED for #254: live verification of the merge commit, to be recorded in the next pull request. UNVERIFIED for layer 7: nothing deployed; to be completed after merge (production revision, `/audio/start`, `/software/start`, `/agreements`, an offer signing page, a real submission of each form, and the built chunks served from production).
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched. The owner agreement routes import their text helpers from a new server-only module with the same behavior.

## Delivery status and remaining gates

- UNVERIFIED: Greptile, Codex and independent review rounds on the final head of the layer 7 pull request.
- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the layer 7 head.
- UNVERIFIED: live and browser verification of layer 7, to be completed after merge.

No deployment is authorized by this record.

#255: implemented yes, deployed yes (Workers Builds on the merge commit, as reported), verified live partly (200 answers and 404 for the manifest, as reported); its local runs are not recorded here. #254: implemented yes; CI, Greptile and Workers Builds passed on the final head (as reported), the deployment of the merge commit was not observed (UNVERIFIED); verified live no (to be recorded in the next pull request; no real payment). Layer 7: implemented yes, verified locally yes, deployed no, verified live no.

Layer 7 was built by a Claude subagent. This record does not certify the checks listed as UNVERIFIED.
