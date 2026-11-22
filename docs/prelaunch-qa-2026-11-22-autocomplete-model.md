# Autocomplete model replacement release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/eager-brown-sadmx4`
Pull request: [#358](https://github.com/kwilson21/thesuperhuman.us/pull/358)
Revision: the pull request's head when it is merged, which the merge commit names. The code and the golden fixture are final
as of `7c61a71f`; later commits change only this record, code comments and a test file's header.
Target: production `https://thesuperhuman.us`, the project brief's suggestions (`POST /api/software/brief/suggest`).
Authorization: Kazon Wilson, in conversation on November 16, 2026, delegated the open decisions on the website work and
authorized merging it; on November 22 he gave the Cloudflare token Workers AI permission so models could be measured, which
found the retired model and led to this change. The implementation, the measurements and independent review passes were
done with Claude Code; Codex also reviewed the pull request.
Rollback revision: `0097b63f` (`origin/main` when this record was last updated; re-check at merge time). Rolling back restores
a model Cloudflare no longer serves, so a rollback leaves suggestions off as they are now.

## Why

Cloudflare retired `@cf/meta/llama-3.2-1b-instruct` on November 20, 2026. A call to it through the Workers AI REST API on
November 22 answered HTTP 410 ("Model has been deprecated"). The suggest route calls it through the `AI` binding, so every
suggestion since then has failed and visitors see none. That the live route fails is inferred, not observed: the route
needs a Turnstile pass, which a headless check from this environment cannot get.

## Scope

- `src/server/services.ts`: the autocomplete's model is `SUGGEST_MODEL`, `@cf/google/gemma-4-26b-a4b-it`, asked with
  `chat_template_kwargs: { enable_thinking: false }`. The prompt, the 12-token cap, temperature 0.1, the 1,200 ms race,
  the limits and the daily budget are unchanged.
- `src/server/flows/brief-suggest.ts`: the reply's text is its `response`, read exactly as before, or, when the reply has
  no `response`, `choices[0].message.content`. Gemma answers in the chat-completion form: a raw call on November 22 gave
  `{"object":"chat.completion","choices":[{"message":{"content":"be able to find music."}}],...}` with no `response`.
  Review caught this; without it every suggestion would have read as empty text.
- `tests/api/brief-suggest.test.ts`: the route test checks the model and that thinking is off (it fails on `main`:
  `expected '@cf/meta/llama-3.2-1b-instruct' to be '@cf/google/gemma-4-26b-a4b-it'`), and a route test answers a
  chat-completion reply.
- `tests/golden/fixtures/software-brief-suggest.json.gz`: re-recorded twice, each in its own commit (rule 1 of
  `tests/golden/README.md`). First the model call: 57 of 125 cases differ, only in each model call's `model` and the new
  `chat_template_kwargs`. Then four added cases for the chat-completion form (text, empty content, no choices, content
  that is not text); no existing case changed.
- No copy, page, migration, binding or secret change. The privacy page names Workers AI, not a model, and stays true.

## Measurements (Workers AI REST API from a cloud container, November 22, 2026)

The route's own system prompt, the JSON content the route sends (with no earlier answers), 12 tokens, temperature 0.1,
ten half-typed answers per model. Times include the trip from the container to Cloudflare, so calls through the binding
should be faster. "Empty" counts answers whose text, read from either reply form, was empty.

| Model | Median | Slowest | Within 1,200 ms | Empty | Price (input / output, per million tokens) |
|---|---|---|---|---|---|
| `gemma-4-26b-a4b-it`, thinking off | 491 ms | 579 ms | 10 of 10 | 0 | $0.10 / $0.30 |
| `mistral-small-3.1-24b-instruct` (two runs) | 712 ms, 608 ms | 1,925 ms, 1,454 ms | 7 and 9 of 10 | 0 | $0.351 / $0.555 |
| `granite-4.0-h-micro` (two runs) | 810 ms, 866 ms | 1,356 ms, 3,244 ms | 9 and 6 of 10 | 0 | not listed |
| `llama-4-scout-17b-16e-instruct` | 1,785 ms | 2,294 ms | 0 of 10 | 0 | $0.27 / $0.85 |
| `gemma-4-26b-a4b-it`, thinking on | 655 ms | 770 ms | 10 of 10 | 10 | $0.10 / $0.30 |
| `gpt-oss-20b` | 314 ms | 565 ms | 10 of 10 | 10 | $0.20 / $0.30 |
| `glm-4.7-flash`, thinking on | 545 ms | 7,383 ms | 8 of 10 | 10 | $0.0605 / $0.40 |

Thinking models spend the 12 tokens thinking and answer with empty text, so `enable_thinking: false` is required.
Gemma's answers with thinking off, for example: "be able to find music.", "the menu and order online.", "one master
file.".

Cost at the site-wide cap of 10,000 suggestions a day: one measured call with no earlier answers used 58 input tokens and 7 output tokens
(about $0.08 a day at the cap); a request that carries the most earlier answers the route accepts is about 600 input
tokens (`docs/plans/2026-11-living-brief.md`), about $0.62 a day at the cap.

## Checklist

### 1. Purpose and content
- Project, branch, instructions, authorization: PASS (above).
- Approved design and truthful claims: PASS. No copy change.
- Explanatory copy, resume parity, first screen, navigation: N/A. Unchanged.

### 2. Search and sharing
- N/A. No head, route or metadata change.

### 3. Accessibility and responsive behavior
- N/A. No markup or style change; suggestions appear in the existing ghost-text UI.

### 4. Performance and resilience
- Model latency: PASS by measurement above (REST, not the binding). The route's 1,200 ms race and its failure answer are
  unchanged, so a slow or failed call shows no suggestion, as before.
- Measured Web Vitals: N/A. No page change.

### 5. Forms and sensitive flows
- Server validation, Turnstile pass, rate limits and daily budget: PASS. Unchanged and covered by `tests/api/brief-suggest.test.ts` and the golden corpus.
- Live suggestion in production: UNVERIFIED until after deploy (needs a real browser with Turnstile).

### 6. Privacy, legal and measurement
- Processors: PASS. Still Cloudflare Workers AI; the same fields are sent. The privacy page names no model.

### 7. Release and final QA
- Type, test, lint, format and build checks: PASS at the head that carries this record (Node 26): `pnpm run lint` no findings,
  `pnpm run format:check` clean, `pnpm run check` 0 errors and 0 warnings, `pnpm test` all files passing, `pnpm run build`
  and `client-bundle.test.ts` with `REQUIRE_CLIENT_BUNDLE=1` passing. The pull request lists the counts.
- Production bindings: PASS. The same `AI` binding.
- Deploy and live verification: UNVERIFIED until after merge.
