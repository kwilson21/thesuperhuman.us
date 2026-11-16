# Effect stack, pull requests 255 and 254 and layer 7 (the validators the browser runs): release gate

Three things are gated: pull request #255 (the bundler manifest guard), pull request #254 (the Quint model, the LemmaScript contract and two audio payment fixes) and layer 7 (the validators that run in both the browser and the server, and the owner agreement schemas that composed their helpers, moved from Zod to Effect Schema).

Date: November 13, 2026
Repository: the personal website repository
Branch for layer 7: `claude/effect-7-validators`, cut from `origin/main` at `2f0969ac` (the merge of #254)
Pull requests: #255 is merged as `88551410`; #254 is merged as `2f0969ac`; layer 7 has no pull request number yet.
Target: production
Reviewer: layer 7 was written by a Claude builder subagent working from a brief (tests first). One independent Claude Opus correctness round ran (see Evidence and limits); a UI and copy review, Greptile and Codex on the pull request head are not recorded here and are in Delivery status as UNVERIFIED. This record does not certify the checks listed as UNVERIFIED.
Rollback revision: for #255, the parent of `88551410`; for #254, the parent of `2f0969ac` (`git log --first-parent`); for layer 7, re-check `origin/main` with `git fetch` before merge. No deployed revision was observed by the builder.

## Scope

1. Pull request #255, merged to main as `88551410`: the bundler manifest guard. The client build records every module it puts in each browser chunk, and `tests/architecture/client-bundle.test.ts` checks that list against reviewed lists. This record gates its release evidence only; it does not review its diff.
2. Pull request #254, merged to main as `2f0969ac`: a Quint model of invoice event handling, a LemmaScript contract for a pure money rule and two audio payment fixes. This record gates its release evidence only; it does not review its diff.
3. Layer 7 (this branch). It converts the three validators below, and then every schema that composed their text helpers, from Zod 3 (`astro/zod`) to Effect Schema, and changes nothing else about what a visitor or the owner sees (owner decision, 2026-11-13: convert them all in the same pull request):
   - `validateIntake` in `src/lib/audio-intake.ts` (browser caller `src/scripts/audio-intake.ts`, server `src/pages/api/audio-intake.ts`);
   - `validateSoftwareInquiry` in `src/lib/software-inquiry.ts` (browser caller `src/scripts/software-inquiry.ts`, server `src/pages/api/software-inquiry.ts`);
   - `resolveClientDetails` in `src/lib/agreement-draft-fields.ts` with the draft and client readers in it and in `src/lib/agreement-client-fields.ts` (browser caller `src/scripts/agreement-access.ts`; server callers `src/pages/api/offer/[token]/draft.ts` and `review.ts`, `src/lib/agreement-draft.ts`, `src/lib/software-agreements.ts`).

   The field helpers that `src/server/edge.ts` already had (`readFields`, `readVariants`, `textField`, `stringField`, `choiceField`, `fieldOf`) moved to `src/lib/fields.ts`, outside `src/server/**`, because a browser bundle may not import from there; `src/server/edge.ts` re-exports them and keeps the readers that run an Effect. They no longer need `effect/Effect`, so browser source imports five effect modules and no more: `effect/Schema`, `effect/SchemaGetter`, `effect/SchemaIssue`, `effect/Result` and `effect/Predicate`. The server-only schemas that composed `cleanText`, `required` and `email` were converted in a second step, so no Zod copy of those helpers remains: `agreementDetailsSchema`, `contractorSchema`, `validateAgreementDetails` and the `AgreementDetails` type in `src/lib/agreement-fields.ts` (now `parseAgreementDetails`, `readAgreementDetails`, `parseContractor`, `readContractor` and `parseAgreementAttachments`), the owner's agreement action union and the attachment upload's query (now `src/lib/agreement-owner-input.ts`, used by `src/pages/api/owner/requests/[id]/agreement.ts` and `agreement-attachments.ts`), and the contractor details inside the owner agreements config action (`src/pages/api/owner/agreements.ts`, which keeps its Zod body schema and reads the contractor with `readContractor` inside it). The new readers (`src/lib/readers.ts`) report failures as a list of issues with a path and Zod 3's own sentence each, because the owner request route lists every failed field of a rejected agreement details payload word for word under `agreement.<path>`: `src/pages/api/owner/requests/[id]/software.ts` catches the new `FieldsRefused` error beside `z.ZodError` (other Zod schemas are still thrown there) and builds the same map from its `issues`. `src/server/agreement-zod-fields.ts` and its drift test are deleted. `AgreementDetails` and the contractor type keep the exact shape `z.infer` gave them (`pnpm run check` is 0 errors), and the key order of a read value is the schema's, as it is stored, hashed and rendered.

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

No behavior change, shown by differential tests. `tests/fixtures/legacy-validators/` keeps the four Zod 3 validator modules as frozen reference copies (no file under `src/` imports them; `tests/architecture/legacy-validators.test.ts` checks that). `tests/server/validators-differential.test.ts` runs the Zod copy and the Effect version on the same generated inputs and requires the same ok flag, the same values, the same error keys in the same order and the same message text, where a thrown error counts as an answer. For the client reader the comparison maps each failing field to "failed" and drops the `_form` entry, because its sentences are internal signals (Zod's default messages differ by design); the text a visitor reads for those fields is covered by the full `resolveClientDetails` comparison. For the intake, the inquiry, the draft reader and `resolveClientDetails` the message text itself is compared:

| Validator | Inputs | Differences |
| --- | --- | --- |
| `validateIntake` | 13,491 | 0 |
| `validateSoftwareInquiry` | 28,179 | 0 |
| `resolveClientDetails` | 17,211 | 0 |
| draft reader (`readDraft`) | 15,169 | 0 |
| client reader (`readClientAgreement`, `parseClientAgreement`) | 11,311 | 0 |
| owner agreement details (`readAgreementDetails`: values in order, the whole issue list with path and sentence in order) | 19,963 | 0 |
| attachments alone (`parseAgreementAttachments`) | 1,559 | 0 |
| `validateAgreementDetails` (same sentences, same plain errors, same `[` messages) | 7,499 | 0 |
| contractor details (`readContractor`, `parseContractor`) | 4,722 | 0 |
| owner agreement action union (every action, unknown actions, extra and missing keys; compared as `JSON.stringify`, so key order and which keys are present) | 9,912 | 0 |
| attachment upload query | 4,496 | 0 |

The inputs are seeded and per field cover: missing, `null`, every wrong type Zod names (number, `NaN`, boolean, array, object, bigint, symbol, function, date, map, set, promise), empty, blank, at the maximum and either side of it, far over it, padded, line breaks, tabs and other control characters, lone surrogates, text that normalises under NFC, characters outside the BMP, markup, emails of many shapes including the Zod 3 pattern's odd cases and lengths at 120 and 320, links of every scheme with credentials and spaces, every enum value and a non-member, extra keys, own `__proto__` and `constructor` keys, each `path` variant, the cross-field rules and bodies that are not objects. A deliberately broken validator (a maximum off by one) fails the test, so the harness can see a difference. The hand-picked lists in `tests/server/edge-equivalence.test.ts` (72 and 66 inputs) now compare the real validators with the frozen copies. Two rules are asserted about the Zod behavior the Effect version copies: a text that is too long is not read for control characters, and the email check and the 320 limit both run. Error key order is always compared. The key order of a successful value is compared too (as `JSON.stringify` writes it) for the intake, the draft and the client details, because the draft is stored with `JSON.stringify` and the signing step compares two `JSON.stringify` strings of the client details. The software inquiry's value is the one exception: its `path` key comes last, where Zod put it after the common fields, and the test compares that value with keys sorted. Nothing writes, stores or loops over a whole `SoftwareInput` or `IntakeInput` (`softwareRequest` and `ownerRequestForIntake` pick keys by name; `softwareRequest` reads a Map built from the entries), so the order is not observable; that was checked by reading the callers, not by a test.

Changes to existing tests and shared helpers, for the reviewer: `tests/server/edge.test.ts` renamed the `other` body kind to `bigint` (the body kinds now follow Zod's names: `nan`, `bigint`, `symbol`, `function`, `promise`, `map`, `set` and `date` replace `other`, and `receivedKind` names a promise, a map, a set and a date); `tests/api/software-inquiry.test.ts` lost two assertions on the Zod source text of the `updates` choice (the behavior below them, a plain "Choose one." sentence for a missing or unknown value, is still asserted); `tests/lib/software-agreements.test.ts` calls `parseClientAgreement` and `readClientAgreement` where it called `clientAgreementSchema`. `fieldOf` and `stringField` in `src/lib/fields.ts` no longer run an Effect (a filter then a synchronous decode), which also changes the already converted contact and resume paths (`src/server/contact-input.ts`), held there by `tests/server/edge-equivalence.test.ts` and the golden corpus, both passing. Parameters that took `unknown` now take `RawValue`, an alias of `unknown` that the repository's Oxlint rule accepts; it is a naming change, not a narrower type.

Round 2 of the independent review, on head `b629b4f2` (a Claude correctness round): 361 hand-built byte-for-byte comparisons of parsed values, error maps and types, with no difference in any response, status, stored value, hash or rendered value. It found that a value failing two checks gave only the last issue (the errors map was the same, since the last sentence per path wins); the readers now keep every issue in Zod's order and the differential compares the whole list. It also found that the owner action's parsed value differed from Zod's (a `expectedAttempt` key present as `undefined`, `action` last, two retry members); the value and the type now match, compared as `JSON.stringify` and by `expectTypeOf` against the frozen schemas for `AgreementDetails`, `Contractor`, `AttachmentQuery` and `OwnerAgreementAction`. The walker also refuses `toStandardSchemaV1`, `toStandardJSONSchemaV1`, `toEncoderXml` and any `["~standard"]` access, and `tests/architecture/lib-server-imports.test.ts` is back with no exception: no `src/lib` file imports a value from `src/server`. Greptile and Codex code review found nothing on head `b629b4f2`.

Real-browser comparison (done): production builds of commit `5041a615` against its base, at 1280x800 and 390x844. `/audio/start` 114 plus 36 cases, `/software/start` 163 plus 43, `/agreements` 9, offer and sign pages 163 plus 82. Every error text, field, step, focus and payload was identical. Scope: it predates the agreement details and owner action schemas (they are server-side and are covered by the differential tests and the golden corpus). Not covered: the server's responses after submitting the audio and software forms (stubbed), the signature submit, and real touch devices.

Failure paths of the owner agreement conversion: the golden corpus (`owner-request-agreement-*`, `owner-agreement-attachments-*`, `owner-request-software-offer-*`, `owner-agreements-*`, `offer-*`) passes with no fixture change. The cases where Zod's own sentences reach a response (the 400 "Complete and validate Agreement details before sending." branch lists each failed field with its Zod sentence) are reproduced exactly: the same paths (`agreement.milestones.0.target`), sentences ("String must contain at most 4000 character(s)", "Number must be less than or equal to 90", "Array must contain at most 3 element(s)", "Unrecognized key(s) in object: 'x'" and the rest), order and stopping rules (a value of the wrong type, a choice that is not one and a text that is too long stop the details, so the checks across fields do not run; other failures do not), and a malformed attachment still answers through the outer catch. The thrown error is a `FieldsRefused` whose message, like a Zod error's, is a JSON array of the issues; its issue list is Zod's, every issue (a value that fails two checks gives both) with its path and sentence in Zod's order, which the differential test compares for the agreement details, the attachments and the contractor's details; only the other fields of each Zod issue (its `code` and expected values) are not carried, and nothing shows that text (the review route hides any message that starts with `[`, and the others answer fixed sentences).

Zod that remains in `src/` after this layer (areas not converted yet): `src/lib/audio-client-access.ts`, `music-catalog.ts`, `music-demand.ts`, `publication/mcp.ts`, `software-offers.ts`, `software-project-messages.ts`, `software-projects.ts`; the routes `src/pages/api/agreements/link.ts`, `mcp-probe.ts`, `offer/[token]/link.ts`, `review.ts` and `sign.ts`, `owner/agreements.ts` (its body schema), `owner/projects/[id]/` (`access.ts`, `files/[fileId].ts`, `invitation.ts`, `messages.ts`, `updates.ts`, `uploads.ts`), `owner/requests/[id].ts` and `[id]/` (`brief-copy.ts`, `invoices.ts`, `messages.ts`, `payment.ts`, `project.ts`, `software.ts` (its action schemas), `updates.ts`), `software/brief/pass.ts` and `suggest.ts`, `studio/code.ts`, `session.ts`, `projects/[id]/messages.ts` and `software/[id]/messages.ts`. No Zod import remains in any browser-reachable module. Of the files this layer touched, none imports `zod`, `astro/zod` or `astro:schema` except `owner/agreements.ts` and `owner/requests/[id]/software.ts`, which keep their own Zod body schemas, and `agreement-fields.ts` and `software-agreements.ts` reach Zod only through `software-offers.ts`.

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

Independent review: one Claude Opus correctness round on commit `5041a615` found no behavior difference: 1,424 hand-written inputs agreed with the Zod validators, and a 448-input comparison of the contact and resume readers on the old and new helpers (`fieldOf` and `stringField` no longer run an Effect) agreed too. The real-browser comparison is recorded below.

Guards added after that round: the walker now also fails, from the syntax tree, on any Schema entry point named `decode*`, `encode*`, `validate*`, `asserts*` or `make*Effect` that is not on a short synchronous allowlist, so `decodeUnknownPromise` and its aliased, string-literal and re-exported forms fail (fixtures in `tests/architecture/client-graph.test.ts`); no `src/lib` file imports a value from `src/server` any more. The frozen validator copies list their live imports from `src` in a header, and the link checks and type guards they used were frozen into the software inquiry copy.

Limits: the browser comparison above is of `5041a615` and not of the final head, and it did not exercise the owner agreement schemas (server-side). The differential tests exercise the validators, not the pages, and the golden corpus covers the routes. No deployed response was observed for layer 7, and the size table measures the chunk graph and not a field metric. The exotic wrong types (bigint, symbol, function, date, map, set, promise, `NaN`) are matched, but no caller can send most of them.

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
- PASS, 4.3 Behavior of the four changed pages in a browser, production builds of `5041a615` against its base (scope and limits in Evidence). UNVERIFIED on the final head and for the server responses after submitting, the signature submit and real touch devices.
- N/A, 4.1, 4.4, 4.5 and 4.6: no image changed and no new async path.

### 5. Forms and sensitive flows

- PASS, 5.1 to 5.5 for layer 7 locally: the three validators answer every generated input as before (zero differences) and the golden corpus (route status, headers, body and outside effects) passes unchanged, with no change under `tests/golden/fixtures/`.
- UNVERIFIED, 5.1 and 5.2 for the audio intake, software inquiry and signing forms in a browser and against live services. To be completed after merge.
- PASS, 5.4 and 5.5 for #254 as far as observed (as reported): a read-only production query for parked paid events returned zero rows. UNVERIFIED, 5.3 and 5.4 for #254: no real payment was run through the new code.

### 6. Privacy, legal and measurement

- N/A, every item in this section: no cookie, analytics, legal text or processor changed in any part.

### 7. Release and final QA

- PASS, 7.1 Required checks: layer 7 local gates above (format, build, bundle test, `pnpm test` twice, Quint, publicist gate, oxlint, golden fixtures); #255 and #254 as reported. `pnpm run check`: 0 errors, 0 warnings, 19 hints (717 files). `verify:dafny` not run here (Dafny is not installed).
- UNVERIFIED, 7.2 Exact diff review on the pull request head and independent code and security review for layer 7: one Claude Opus correctness round ran on `5041a615` (no behavior difference, nothing blocking); a security and a UI and copy round have not been run. #254: Greptile passed on the final head and two independent review rounds ran (as reported).
- UNVERIFIED, 7.3 Production bindings, secrets, HTTPS, host routing and response headers for layer 7: no binding, secret or migration changed; nothing deployed.
- PASS, 7.4 Rollback is the previous deployed revision: the parents of `88551410` and `2f0969ac`; for layer 7 re-check `origin/main` with `git fetch` before merge.
- PASS, 7.5 for #255 (as reported): `/`, `/audio/start`, `/software/start`, `/agreements` and `/work` answered 200 after the merge. UNVERIFIED for #254: live verification of the merge commit, to be recorded in the next pull request. UNVERIFIED for layer 7: nothing deployed; to be completed after merge (production revision, `/audio/start`, `/software/start`, `/agreements`, an offer signing page, a real submission of each form, and the built chunks served from production).
- PASS, 7.6 Receipt and QA evidence for the local gates, with the four states reported separately (below).

### 8. Private owner center

- N/A, every item in this section: the owner center, Access, migrations and payment settings are untouched. The owner agreement routes read their input with the new readers, with the same statuses and bodies (the golden corpus passes with no fixture change).

## Delivery status and remaining gates

- Greptile and Codex code review found nothing on `b629b4f2` (as reported). UNVERIFIED: a security-focused review round on the final head.
- UNVERIFIED: CI (`validate`) and Cloudflare Workers Builds on the layer 7 head.
- UNVERIFIED: live and browser verification of layer 7, to be completed after merge.

No deployment is authorized by this record.

#255: implemented yes, deployed yes (Workers Builds on the merge commit, as reported), verified live partly (200 answers and 404 for the manifest, as reported); its local runs are not recorded here. #254: implemented yes; CI, Greptile and Workers Builds passed on the final head (as reported), the deployment of the merge commit was not observed (UNVERIFIED); verified live no (to be recorded in the next pull request; no real payment). Layer 7: implemented yes, verified locally yes, deployed no, verified live no.

Layer 7 was built by a Claude subagent. This record does not certify the checks listed as UNVERIFIED.
