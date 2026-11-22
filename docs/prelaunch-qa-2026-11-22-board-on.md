# Living brief board: model, limits and switch-on release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/eager-brown-sadmx4`
Revision: the pull request's head when it is merged, which the merge commit names.
Target: production `https://thesuperhuman.us`, the project brief at `/software/start` and `POST /api/software/brief/board`.
Authorization: Kazon Wilson, in conversation on November 16, 2026, delegated the open decisions on the website work and
authorized merging it; on November 22 he gave the Cloudflare token Workers AI permission, and after the measurements below
approved the plan to switch the board to a faster model, give it a longer limit, settle the stored-size limit and turn it
on. The implementation, the measurements and independent review passes were done with Claude Code.
Rollback revision: `origin/main` when this merges (the merge message names it). Turning the board off needs no rollback:
set `SOFTWARE_BOARD_ENABLED` to `"false"` in `wrangler.jsonc` and deploy.

Earlier record for the board itself (design, rules, accessibility, privacy, tests): `docs/prelaunch-qa-2026-11-15-living-brief.md`.

## Scope

- `src/server/brief-board-model.ts`: the board asks `@cf/zai-org/glm-4.7-flash` with `chat_template_kwargs:
  { enable_thinking: false }`, sends its JSON schema in the chat-completion form (`json_schema: { name, schema }`), and
  reads either a `response` or a chat-completion reply (`choices[0].message.content`). The route waits 20 s for the model
  (it waited 8 s).
- `src/scripts/brief-board.ts`: the page waits 25 s for the route (it waited 12 s), so the route's own limit answers first.
- `src/server/intake-store.ts`: a stored request's details may hold 32,000 characters of JSON (it was 16,000). The largest
  brief the form allows is about 14,300; the fullest outline adds about 6,500, or about 12,000 when every field is made of
  characters that double in JSON. A route test stores the largest brief with that outline; it fails at the old limit.
- `wrangler.jsonc`: `SOFTWARE_BOARD_ENABLED` is `"true"`.
- No migration, binding or secret change. The privacy page already describes what the board sends (`/privacy#software-briefs`).

## Measurements (Workers AI REST API from a cloud container, November 22, 2026)

The board's own request from `src/server/brief-board-model.ts` and `src/lib/brief-board.ts` (instructions, JSON schema,
temperature 0.2, 700 tokens), three fictional briefs (website, web app, workflow) and a follow-up that carries open,
visitor-owned and set-aside cards. Cards counted as kept are those the site's own reader (`readReply`) accepts.

| Model | Runs | Median | Slowest | Within 8 s | Valid JSON | Cards kept |
|---|---|---|---|---|---|---|
| `llama-3.3-70b-instruct-fp8-fast` (the first model) | 9 | 8.7 s | 10.3 s | 3 | 9 | 63 of 80 |
| `glm-4.7-flash`, thinking off, schema as sent now | 20 | 6.8 s | 17.4 s (90th percentile 14.3 s) | 16 | 20 | 130 of 143 |
| `gemma-4-26b-a4b-it`, thinking off | 9 | 8.6 s | 46.2 s | 3 | 9 | 53 of 80 |
| `mistral-small-3.1-24b-instruct` | 9 | 12.1 s | 18.3 s | 0 | 9 | 91 of 93 |
| `llama-4-scout-17b-16e-instruct` | 9 | 34.8 s | 47.2 s | 0 | 9 | 62 of 80 |
| `gpt-oss-20b`, `gpt-oss-120b`, `gemma-4-26b-a4b-it` and `glm-4.7-flash` with thinking on | 9 each | | | | 0 | |

With thinking on, a model spends the 700 tokens thinking and no JSON comes back. Workers AI does not stream JSON Mode, so
the whole reply is awaited; at these speeds a reply takes about 5 to 18 seconds whichever model answers it. The board asks
while the visitor keeps writing and shows "Reading your answers…", so a reply that takes that long does not block them.

Cost: `glm-4.7-flash` is $0.0605 per million input tokens and $0.40 per million output. The measured requests used 467 to
611 input tokens (median 475) and 314 output tokens at the median, about $0.00016 a request; at the site's limit of 150 a
day, about $0.03 a day. The first model
cost about five times as much per request.

## Checklist

### 1. Purpose and content
- Project, branch, instructions, authorization: PASS (above).
- Truthful claims and explanatory copy: PASS. No copy change; the board's copy and origin labels were checked in the
  earlier record.

### 2. Search and sharing
- N/A. No head, route or metadata change.

### 3. Accessibility and responsive behavior
- PASS by the earlier record's checks (axe at 1280, 390 and 320 px, keyboard, 200% text, reduced motion), which ran with
  the board on in the screenshot preview; this change touches no markup or style.
- Another browser and a real device: UNVERIFIED (Chromium only).

### 4. Performance and resilience
- Model latency: PASS by measurement above (REST, not the binding). A reply that takes longer than 20 s is answered as the
  route's existing busy answer, and the page shows its existing line ("The outline couldn’t update just now. Trying again
  shortly.") and backs off before asking again.
- Measured Web Vitals: UNVERIFIED. The board was already on the page in the preview; no lab measurement.

### 5. Forms and sensitive flows
- Server validation, Turnstile pass, rate limits and daily reservation: PASS. Unchanged and covered by
  `tests/api/brief-board.test.ts` (38 tests, including the chat-completion reply and the 20 s timeout).
- Stored size: PASS. `tests/api/software-inquiry.test.ts` stores the largest brief with the fullest outline.
- Live board in production: UNVERIFIED until after deploy. It needs a real browser with Turnstile.

### 6. Privacy, legal and measurement
- Processors: PASS. Still Cloudflare Workers AI; what is sent is unchanged and described on the privacy page.

### 7. Release and final QA
- Type, test, lint, format and build checks: PASS at the head that carries this record (Node 26); the pull request lists
  the counts.
- Production bindings: PASS. The same `AI` binding, rate limits and budget table; no migration.
- Deploy and live verification: UNVERIFIED until after merge.
