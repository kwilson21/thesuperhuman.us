# Living brief board: model, limits and switch-on release gate

Date: November 22, 2026
Repository: `kwilson21/thesuperhuman.us`
Branch: `claude/eager-brown-sadmx4`
Pull request: [#362](https://github.com/kwilson21/thesuperhuman.us/pull/362)
Revision: the pull request's head when it is merged, which the merge commit names.
Target: production `https://thesuperhuman.us`, the project brief at `/software/start` and `POST /api/software/brief/board`.
Reviewer: built, measured and independently reviewed with Claude Code; Codex reviewed the pull request. This record does
not certify the checks listed as UNVERIFIED.
Rollback revision: `origin/main` when this merges (the merge message names it). Turning the board off needs no rollback:
set `SOFTWARE_BOARD_ENABLED` to `"false"` in `wrangler.jsonc` and deploy.

Earlier record for the board itself (design, rules, accessibility, privacy, tests): `docs/prelaunch-qa-2026-11-15-living-brief.md`.

## Authorization

Kazon Wilson, in conversation:

- November 16, 2026: delegated the open decisions on the living brief stack (PRs #286, #290 and #308) and authorized
  merging it. The board went to `main` switched off, to be turned on once its model was measured (earlier record).
- November 22, 2026: told Claude Code again to decide everything on that stack and that it was free to merge; gave the
  Cloudflare token Workers AI permission so the models could be measured; and, after the first measurements, answered
  "Yes" to this plan: switch the board to GLM 4.7 Flash with thinking off (put to him as "about a fifth of the 70B's"
  cost), raise its time limit from 8 seconds to "about 15 seconds", handle the stored-size limit, measure again, then
  switch it on.

Decisions taken under that delegation, not the owner's own:

- **The time limit is 30 s, not about 15 s.** Measured again on long briefs, 3 of 22 replies took over 20 s and the
  slowest 33.1 s. A reply the route gives up on is lost and the page waits 20 s before asking again, and three failures
  in a row stop the board for that page, so a later limit brings a slow outline sooner. The page waits 35 s.
- **The spending envelope.** At GLM 4.7 Flash's prices the board costs at most about $0.07 a day at the site's limit
  (about $2.20 a month, or $3 in scripts that double the input), before the free daily allocation. That is below the
  envelope first put to the owner for the 70B on November 15 ($0.38 a day, $12 a month, $16 at most). The owner was told
  the cost only as "about a fifth of the 70B's" and did not approve a figure separately.
- **"Measure again, then switch it on."** It was measured again through the REST API (42 requests, short and long
  briefs, below). The live route answers 503 while the switch is off, so the check through the site's own binding comes
  after deploy, in a real browser; if live replies fail or are slow, the switch goes back to `"false"`.
- **Lone surrogates.** Review found that the outline reader, which runs only while the board is on, let lone
  surrogates through. They are now refused like control characters, as the brief's own fields already refuse them.

## Scope

- `src/server/brief-board-model.ts`: the board asks `@cf/zai-org/glm-4.7-flash` with `chat_template_kwargs:
  { enable_thinking: false }`, sends its JSON schema in the chat-completion form (`json_schema: { name, schema }`), and
  reads either a `response` or a chat-completion reply (`choices[0].message.content`). The route waits 30 s for the model
  (it waited 8 s).
- `src/scripts/brief-board.ts`: the page waits 35 s for the route (it waited 12 s), so the route's own limit answers first.
- `src/lib/brief-board.ts`: the shared control-character check also covers lone surrogates, so the outline sent with a
  brief cannot carry one in its text, passages or answers, and `oneLine` turns one into a space wherever it cleans text.
- `src/server/intake-store.ts`: a stored request's details may hold 32,000 characters of JSON (it was 16,000). The
  largest brief the form allows is about 14,300. With the fullest outline the board can send (17 cards, each with its
  longest passage, every question answered, every field made of characters that double in JSON) it is about 25,700.
  Without the change, the visitor would be told to shorten a brief the form had accepted.
- `wrangler.jsonc`: `SOFTWARE_BOARD_ENABLED` is `"true"`.
- `docs/plans/2026-11-living-brief.md`: the status, the model and the cost section now describe GLM 4.7 Flash.
- No migration, binding or secret change. The privacy page already describes what the board sends (`/privacy#software-briefs`).

## Measurements (Workers AI REST API from a cloud container, November 22, 2026)

The board's own request from `src/server/brief-board-model.ts` and `src/lib/brief-board.ts` (instructions, JSON schema,
temperature 0.2, 700 tokens), with fictional briefs. Times include the trip from the container to Cloudflare. Cards
counted as kept are those the site's own reader (`readReply`) accepts.

GLM 4.7 Flash, thinking off, the schema as sent now:

| Briefs | Input tokens | Runs | Median | Slowest | Within 20 s | Within 30 s | Valid JSON | Cards kept |
|---|---|---|---|---|---|---|---|---|
| Short: three briefs and a follow-up carrying open, visitor-owned and set-aside cards | 467 to 611 | 20 | 6.8 s | 17.4 s | 20 | 20 | 20 | 130 of 143 |
| Long web app brief, answers of 1,255 and 1,203 characters (longer than the form allows), 15 cards (2,993 characters as the route counts them) | 1,262 | 10 | 11.9 s | 33.1 s | 8 | 9 | 10 | 98 of 120 |
| Long web app brief, both answers at the form's 1,000 characters, 39 cards (4,590 characters as the route counts them) | 1,981 | 12 | 9.7 s | 21.9 s | 11 | 12 | 12 | 110 of 143 |

Output was about 314 tokens on the short briefs and about 560 on the long ones (the cap is 700), and the time follows
the output: Workers AI does not stream JSON Mode, so the whole reply is awaited. The route allows 7,000 characters; the
largest request measured was 4,590, so a request at the limit is not measured. The board asks while the visitor keeps
writing and shows "Reading your answers…", so a slow reply does not block them.

The first comparison, before the schema's chat-completion form was found: three briefs, no follow-up, three runs each,
the schema sent in the 70B's form (`json_schema: <schema>`).

| Model | Runs | Median | Slowest | Within 8 s | Valid JSON | Cards kept |
|---|---|---|---|---|---|---|
| `llama-3.3-70b-instruct-fp8-fast` (the first model) | 9 | 8.7 s | 10.3 s | 3 | 9 | 63 of 80 |
| `glm-4.7-flash`, thinking off | 9 | 6.7 s | 14.7 s | 5 | 9 | 53 of 57 |
| `gemma-4-26b-a4b-it`, thinking off | 9 | 8.6 s | 46.2 s | 3 | 9 | 53 of 80 |
| `mistral-small-3.1-24b-instruct` | 9 | 12.1 s | 18.3 s | 0 | 9 | 91 of 93 |
| `llama-4-scout-17b-16e-instruct` | 9 | 34.8 s | 47.2 s | 0 | 9 | 62 of 80 |
| `gpt-oss-20b`, `gpt-oss-120b`, `gemma-4-26b-a4b-it` and `glm-4.7-flash` with thinking on | 9 each | | | | 0 | |

With thinking on, a model spends the 700 tokens thinking and no JSON comes back.

Cost, from Cloudflare's model catalogue (read through its API on November 22): `glm-4.7-flash` is $0.0605 per million
input tokens and $0.40 per million output. A measured short brief costs about $0.00015 a request and a measured long one
about $0.00035. The largest call the plan allows (about 3,300 input tokens, 700 output) is about $0.00048, so at the
site's limit of 150 a day the board costs at most about $0.07 a day (about $0.10 in scripts that double the input),
before the free daily allocation. The first model cost about five times as much per request.

## Checklist

### 1. Purpose and content
- Project, branch, instructions, authorization: PASS (above).
- Truthful claims and explanatory copy: PASS. No copy change; the board's copy and origin labels were checked in the
  earlier record, and no page names a model, a time or an "off" state that this change makes untrue.
- Professional claims or resume: N/A. None changed.

### 2. Search and sharing
- N/A. No head, route or metadata change.

### 3. Accessibility and responsive behavior
- PASS by the earlier record's checks (axe at 1280, 390 and 320 px, keyboard, 200% text, reduced motion), which ran with
  the board on in the screenshot preview, answered by a scripted stand-in model (`scripts/screenshots/brief-board-script.mjs`),
  not Workers AI. This change touches no markup or style.
- Another browser and a real device: UNVERIFIED (Chromium only).

### 4. Performance and resilience
- Model latency: PASS by measurement above (REST, not the binding), with the limit that a request at the full 7,000
  characters was not measured. A reply that takes longer than 30 s is answered as the route's existing busy answer; the
  page shows its existing line ("The outline couldn’t update just now. Trying again shortly.") and backs off before
  asking again.
- A call the route gives up on is not aborted (`askWorkersAi` does not pass the abort signal, as before this change).
  Whether Workers AI keeps running and charges for it is not known; each such call is still counted against the daily
  limits, and its output is capped at 700 tokens.
- Measured Web Vitals: UNVERIFIED. No lab measurement of the page with the board on.

### 5. Forms and sensitive flows
- Server validation, Turnstile pass, rate limits and daily reservation: PASS. Unchanged and covered by
  `tests/api/brief-board.test.ts` (38 tests, including the chat-completion reply and that the route waits 30 s and then
  gives up).
- Stored size: PASS. `tests/api/software-inquiry.test.ts` stores the largest brief with the fullest outline (about 25,700
  characters); the test fails at the old limit.
- Lone surrogates in the outline: PASS. `tests/lib/brief-board.test.ts` refuses one in a card's text, passage and answer,
  and accepts an emoji; the test fails without the change.
- Delivery of the outline in the owner's notice and the visitor's copy: UNVERIFIED. Covered by tests only; no real email
  with an outline has been sent. This goes live with the switch.
- Live board in production: UNVERIFIED until after deploy. It needs a real browser with Turnstile.

### 6. Privacy, legal and measurement
- Processors: PASS. Still Cloudflare Workers AI; what is sent is unchanged and described on the privacy page.
- New paid service or account: N/A. Workers AI is already used; the envelope is above.

### 7. Release and final QA
- Type, test, lint, format and build checks: PASS at the head that carries this record (Node 26); the pull request lists
  the counts.
- Production bindings: UNVERIFIED. The same `AI` binding, the two rate limits and the `brief_suggestion_budget` table as
  before, no migration; not checked against production.
- Deploy and live verification: UNVERIFIED until after merge.

## Remaining

- After deploy: open `/software/start` in a real browser, write a brief and watch the board answer; send one brief with
  an outline and check the owner's notice and the visitor's copy.
- For the owner: the board's copy says the outline comes from "Cloudflare's AI" (`src/components/BriefBoard.astro` and
  `src/pages/software/start.astro`). The model is Z.ai's GLM 4.7 Flash, run on Cloudflare's Workers AI, which the copy
  already allows for; a more exact wording would be a copy decision, so it is left as it is.
