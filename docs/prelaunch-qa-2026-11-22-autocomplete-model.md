# Autocomplete model replacement release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/eager-brown-sadmx4`
Target: production `https://thesuperhuman.us`, the project brief's suggestions (`POST /api/software/brief/suggest`).
Decisions and merge authorization: Kazon Wilson, in conversation, asked Claude Code on November 16, 2026 to decide and merge
the open website work, and on November 22, 2026 gave the Cloudflare token Workers AI permission so the models could be
measured. Built and measured by Claude Code; reviewed by independent Claude subagents.
Rollback revision: `2f93a646` (`origin/main` when this record was written; re-check at merge time). Rolling back restores
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
- `tests/api/brief-suggest.test.ts`: the route test checks the model and that thinking is off (it fails on `main`:
  `expected '@cf/meta/llama-3.2-1b-instruct' to be '@cf/google/gemma-4-26b-a4b-it'`).
- No copy, page, migration, binding or secret change. The privacy page names Workers AI, not a model, and stays true.

## Measurements (Workers AI REST API from a cloud container, November 22, 2026)

The route's own system prompt, the JSON content the route sends, 12 tokens, temperature 0.1, ten half-typed answers per
model. Times include the trip from the container to Cloudflare, so calls through the binding should be faster.

| Model | Median | Slowest | Within 1,200 ms | Empty answers | Price (input / output, per million tokens) |
|---|---|---|---|---|---|
| `gemma-4-26b-a4b-it`, thinking off | 491 ms | 579 ms | 10 of 10 | 0 | $0.10 / $0.30 |
| `mistral-small-3.1-24b-instruct` | 608 ms | 1,454 ms | 9 of 10 | 0 | $0.351 / $0.555 |
| `granite-4.0-h-micro` | 866 ms | 3,244 ms | 6 of 10 | 0 | not listed |
| `llama-4-scout-17b-16e-instruct` | 1,785 ms | 2,294 ms | 0 of 10 | 0 | $0.27 / $0.85 |
| `gemma-4-26b-a4b-it`, `gpt-oss-20b`, `glm-4.7-flash` with thinking on | under 1,200 ms | | | 10 of 10 | |

Thinking models spend the 12 tokens thinking and answer with empty text, so `enable_thinking: false` is required.
Gemma's answers, for example: "be able to find music.", "the menu and order online.", "one master file."

Cost at the site-wide cap (10,000 suggestions a day, about 150 input and 8 output tokens each): about $0.17 a day.

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
- Server validation, Turnstile pass, rate limits and daily budget: PASS. Unchanged and covered by `tests/api/brief-suggest.test.ts`.
- Live suggestion in production: UNVERIFIED until after deploy (needs a real browser with Turnstile).

### 6. Privacy, legal and measurement
- Processors: PASS. Still Cloudflare Workers AI; the same fields are sent. The privacy page names no model.

### 7. Release and final QA
- Type, test, lint, format and build checks: see the pull request; recorded there at its head.
- Production bindings: PASS. The same `AI` binding.
- Deploy and live verification: UNVERIFIED until after merge.
