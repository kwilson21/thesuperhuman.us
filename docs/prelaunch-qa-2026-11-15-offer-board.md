# The offer board: release gate

The owner's request page gains "Shape the offer" above the offer editor: Workers AI suggests an outcome, milestones
(with working days), what the client must provide, what is outside the offer, timing, questions and cost drivers, and
three prices sit side by side (the AI's days times the owner's day value, the owner's past offers, and a market range
from cited research). The owner uses, edits or sets aside each suggestion; Use fills the offer editor's own fields.
A private page, `/owner/pricing`, holds the owner's day value, contingency and market research. Design:
`docs/plans/2026-11-offer-board.md`.

Date: November 15, 2026, updated November 22, 2026 for the merge to `main`
Repository: the personal website repository
Pull request: [#308](https://github.com/kwilson21/thesuperhuman.us/pull/308)
Branch: `claude/offer-board`, first stacked on PR #290 (the living brief, whose board rules it reuses), which merged on
November 16, 2026; since then merged with `origin/main` (merge commits, never a rebase), last at `3966e189`, which
includes #362.
Revision: the pull request's head when it is merged (`d71d7bae` when this record was updated), which the merge commit
names.
Target: production. Owner pages only (Cloudflare Access); nothing here is shown to a client. The public change is one
paragraph on the privacy page.
Reviewer: built and independently reviewed with Claude Code over 33 review rounds; rounds 32 and 33 found nothing in the
four blocking areas (decision 6), and a final review limited to those areas ran on `d71d7bae` (below). The rounds'
non-blocking findings are in [issue #372](https://github.com/kwilson21/thesuperhuman.us/issues/372).
Rollback revision: `origin/main` when this merges (the merge message names it).

## Owner decisions

1. **Asked for (2026-11-15):** the owner page uses the AI; all three ways to price; the AI may read the written
   answers, outline, timing, budget note and existing-site notes, never the client's name, email or company; a pull
   request of its own stacked on #290.
2. **Spending:** owner-only, at most 40 suggestions a day (about $0.004 each, at most about $0.15 a day, inside the free
   daily allocation on most days). No switch: the owner asked for it and the amount is not material.
3. **To set after merge, on `/owner/pricing`:** the day value and contingency (left empty: they are the owner's), and
   the market research (the research file the research workflow produced, delivered privately in the session, not in
   the repository).
4. **Where the reference is stored:** KV (`RESUME_STORE`, key `owner:pricing`), not a new MUSIC_DB table, because a table
   changes every golden case's database digest.
5. **November 16, 2026:** the owner, in conversation, said "you decide everything, you're free to merge" about this
   work. On November 22 he told Claude Code, in this pull request's session, to decide its open items. Decided under
   that delegation, not the owner's own choices: the pricing reference stays in KV (item 4); the market research is a
   one-off import on `/owner/pricing`, rerun by hand, not a scheduled refresh; the board asks only when the owner
   presses Suggest; a price row keeps refusing when the fees exceed its low end, and Not this keeps a used card's text in
   the offer; the design choices stay as built. The alternatives, and the order to take them in, are in issue #372.
6. **November 22, 2026, the merge bar:** after 33 review rounds that each found something, the owner decided that this
   pull request stops open-ended review rounds. A finding blocks the merge only if it is a verified defect in privacy
   (the client's details reaching the AI, or the privacy paragraph saying something untrue), owner-only access, money
   arithmetic, or stored data; everything else goes into issue #372.

## Checks

| Check | Result | Evidence |
|---|---|---|
| 1. Purpose and content: truthful claims | PASS | The board says the AI drafts ideas and that nothing is saved or sent until the owner uses the offer editor; prices say they are estimates and the fee is the owner's. |
| 1. Professional claims or resume | N/A | None changed. |
| 2. Search and sharing | N/A | Owner pages only, `noindex`. |
| 3. Semantics, keyboard, focus | PASS | One labelled section with lanes as labelled sections and lists; card actions named with the card ("Use as outcome: …"); Undo and Ctrl or Cmd+Z; focus moves to a neighbour after Not this, or to the Set aside list when the card was its lane's only one; an editor left open on a card that is then used closes, and focus never falls to the page. axe (wcag2a/aa, 2.1, 2.2) finds nothing in the board at 1280 and 390 px. |
| 3. Bounded height, widths | PASS | The cards scroll in a box no taller than 36rem or 70% of the screen (560 px at 1280×800, 576 px at 390×844); no sideways scroll at either width. Prices sit below the cards, so filling them never moves a card, and a price row is redrawn only when it changes. "Show N updates" sits beside Undo in the header. Every board control and every pricing page control is at least 44 px; the pricing page and the owner nav fit at 320 px with no sideways scroll (the nav wraps; the research table scrolls in its own box with its headers). |
| 3. Another browser, a real device | UNVERIFIED | Chromium only. |
| 4. Client code | PASS | The page script reaches `src/lib/offer-board.ts`, `offer-pricing.ts` and `pricing-reference.ts`, all pure and read field by field (added to `BROWSER_MODULES`); the client bundle check passes. |
| 5. Server validation, access, limits | PASS | Owner only; Effect Schema input; the brief read from the database (the page cannot change what the model sees); a daily reservation guarded in one batch (40 a day); the reply read card by card, prices, costs and links dropped; every refusal mapped with `catchTags`. 11 route and store tests against the real schema, including what the model never sees and past offers counting each client's last sent version only. |
| 5. Pricing reference | PASS | Effect Schema input, a rule that refuses a save from a stale page (409), a KV store with a named failure (500 with a fixed sentence); 8 route tests; 11 reader tests (including research without a day rate read back after it is stored). The page saves without reloading over the other form's unsaved changes. |
| 5. Money rule | PASS | `src/lib/offer-pricing.ts` carries LemmaScript contracts that Dafny proves (19 obligations); planted bugs fail; 13 unit tests. |
| 5. Browser checks | PASS | 71 at the final head, in CI's capture job and locally. They began as 34 checks at two widths on the local dev server with a scripted stand-in model: Suggest, cards in every lane, Use and Undo restoring the field, a milestone with its fee, the three prices (the market figure held inside the research), the estimate range filled, asking again after the owner edits the offer, a stale reply never rewording a used card, the bounded box, axe, no page errors. 30 more for the first review's fixes: Undo keeping what the owner typed since, removing only its own line and the milestone row it added, focus staying in the board, Set its fee filling only the fee, Use on edited and brought-back cards, a held reply waiting in the header and announced once, a focused price button kept across a reply, a failure stopping automatic requests, 44 px targets, the pricing page saving twice without a reload, 320 px, axe. |
| 5. Approval-gated, nothing sent | PASS | The board saves and sends nothing; the offer editor's Save draft and Send offer are unchanged. |
| 6. Privacy notice | PASS | The software briefs section says the owner may use Workers AI to draft an offer from a brief, what it reads (the owner's draft included), that it is not given the client's name, email, company or site and that those are replaced wherever they appear as entered (a route test sends them in the draft and a card), and that nothing reaches the client unless the owner puts it in an offer. |
| 6. Secrets and figures in the repository | PASS | No day value, research figure or past offer in the repository; tests use made-up numbers; screenshots in CI show an empty pricing reference. |
| Final review, the four blocking areas | PASS | On `d71d7bae`, limited to decision 6's areas. Privacy: every free-text field the model reads passes through `withheldFrom` first, the fields sent as they are hold only fixed choices and dates, and the name, email, company, current site, approver and timing reason are never sent; the privacy paragraph matches the code. Access: the new page and both new routes sit under the middleware's owner check, and both routes also check `locals.owner`; no client page or route reads the pricing record, the notes or the board. Money: worked by hand ($800 a day, 15% contingency, milestones of 1 to 2 and 3 to 5 days: $3,200 to $6,450) and by an exhaustive check of `dayValueEstimate` against exact arithmetic over 18 day values, 10 contingencies and every half-day pair: each end is a whole $50, never below the exact amount and under $50 above it; Use writes the fee and the range as the offer editor reads them back. Data: no migration or new table; a store that cannot be read hides the forms rather than saving over it. Already disclosed and decided (decision 4): KV has no compare-and-set and may serve a read up to about a minute old, so a save from a second tab can put back research another tab just saved (`src/server/rules/pricing.ts`, `verification/pricing-save.qnt`). |
| 7. Type, test, lint, build | PASS | At `d71d7bae` (Node 26): format, lint and type check clean; 400 test files, 15,451 tests passing; the build with the copy check and the publicist gate; the client bundle test; the 71 browser checks. CI's 21 checks are green on the same head. |
| Model latency and JSON | PASS (REST) | November 22, 2026, through the Workers AI REST API with this board's own request (`src/server/offer-board-model.ts`) for a fictional website brief, first with an empty draft and then with a draft and two cards, five runs each: all 10 replies were valid JSON, 10.2 s at the median and 12.3 s at the slowest (the route waits 30 s), 255 to 417 output tokens of the 1,200 allowed, 7 to 10 cards each. Through the site's own binding: UNVERIFIED until after deploy. |
| Suggestion quality | UNVERIFIED | Whether the suggestions and the day estimates are realistic is the owner's judgment, on real briefs. |
| Production bindings | UNVERIFIED | Uses existing bindings (`AI`, `MUSIC_DB`, `RESUME_STORE`) and the existing `brief_suggestion_budget` table; no migration. |
| Deploy and live verification | UNVERIFIED | After merge: the owner pages load behind sign-in and `/owner/pricing` and `/api/owner/*` refuse without it; the owner then sets the day value and contingency, imports the research file and presses Suggest on a real request. |
