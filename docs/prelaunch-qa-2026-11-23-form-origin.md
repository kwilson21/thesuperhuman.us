# Same-origin form posts from no-referrer pages: release gate

Date: November 23, 2026
Repository: `kwilson21/thesuperhuman.us`
Pull request: opened after this record; its number and the merge facts are recorded in the next pull request.
Target: production `https://thesuperhuman.us`
Decisions: Kazon Wilson's standing instruction to fix verified defects and merge once reviews pass and CI is green
(CLAUDE.md). This is a bug fix to the middleware's cross-site checks; no answer a visitor is meant to get changes. The
work was done with Claude Code.
Rollback revision: the revision of `main` before the merge, or `git revert -m 1` of the merge commit. No migration, no
binding.

## The defect

The agreement pages (`AgreementLayout`, both emailed-link verify pages), the offer page and the studio pages send
`Referrer-Policy: no-referrer`, so a link's key never reaches a Referer header. Under that policy a browser sends a
native form post with `Origin: null` (the Fetch standard's "append a request Origin header": a request whose method
is not GET or HEAD and whose mode is not `cors` gets `null` when the referrer policy is `no-referrer`). The middleware
refused a form-like post (and any state-changing request to the owner and studio actions) whose `Origin` was not the
site's own, so it answered such a post 403 "Cross-site POST form submissions are forbidden" before the page ran. The
agreement routes' form reader (`agreementRequest`, `src/lib/agreement-request.ts`) had the same rule and answered 403
"Forbidden" to the no-script fallbacks of the link, draft, review and sign forms, whose scripted path sends JSON
through `fetch` with the real origin. The
verify pages' Continue form is a plain form with no script, so on production a client who opened an emailed signing or
archive link and pressed Continue got the 403. Scripted `fetch` posts from the same pages send the real origin and were
not affected.

Found while making the verify pages' fix (#385); no golden corpus runs middleware and no screenshot scenario pressed
Continue, so nothing had caught it.

Checked before the fix:

- Chromium (the preinstalled Playwright build), a same-origin native form post from a local page: `Origin: null` and
  `Sec-Fetch-Site: same-origin` under `no-referrer`; the real origin under `strict-origin` and `same-origin`.
- Production, 2026-11-23: a form POST to `/agreements/verify` with `Origin: null` answered 403 "Cross-site POST form
  submissions are forbidden"; the same POST with the site's origin reached the page (401, the expired page, for an
  unknown key).

## The fix

`src/lib/same-origin.ts` holds the one rule, `fromThisSite(request, siteOrigin)`: a request is this site's when its
`Origin` is the site's origin, or when its `Origin` is `null` and its `Sec-Fetch-Site` is `same-origin`. A page cannot
set `Sec-Fetch-Site`; a post from another site carries `cross-site` (or `same-site` from a sibling host such as the
audio host), and a request without `Sec-Fetch-Site` is refused as before. The middleware's three checks use it (owner
actions, studio actions and every other form-like post), and so does `agreementRequest`. The OAuth token exchange's own
rule is unchanged.

The alternative, changing those pages to `strict-origin`, would also fix the post but changes each page's header one by
one; `no-referrer` stays.

## Evidence and limits

- `tests/middleware.test.ts`: a new test posts to both verify pages, and to the studio's session action and an owner
  action (as JSON and as a form), with `Origin: null` and `Sec-Fetch-Site: same-origin` (each reaches the route), and
  with `Origin: null` alone, `cross-site`, `same-site`, `none`, another site's origin with `same-origin`, and no
  `Origin` with `same-origin` (each 403, never reaching the route). It fails on the old middleware and passes on the
  new one; the existing tests pass unchanged.
- `tests/lib/same-origin.test.ts`: the rule itself, and `agreementRequest` reading a no-referrer page's form post and
  refusing the rest; the second test fails on the old reader.
- An independent security review traced the Fetch and Fetch Metadata rules (`Sec-Fetch-Site` is `same-origin` only
  when every URL of the request, across redirects, matches its origin; an opaque origin never matches) and probed
  Chromium: only this site's own pages produced `Origin: null` with `same-origin`; another site's forms, sandboxed and
  `data:` frames, `file:` pages, cross-site redirect chains, `blob:` documents and sibling hosts all sent `cross-site`
  or `same-site`. It found nothing blocking.
- Golden corpora: none runs middleware, and none of the corpora that go through `agreementRequest` sends
  `Sec-Fetch-Site`, so none changes (the seven agreement corpora rerun: 1,656 passed).
- Limit: a browser that sends neither the site's origin nor `Sec-Fetch-Site` (one older than Fetch Metadata support)
  is still refused on these pages, as it was.

## 1 to 6. Content, search, accessibility, performance, forms, privacy

- **PASS · Forms.** A same-origin native form post from a no-referrer page reaches its route: the verify pages'
  Continue forms and the agreement forms' no-script fallbacks.
- **PASS · Privacy.** The referrer policies are unchanged; link keys still never reach a Referer header.
- **N/A · Content, search, accessibility, performance.** No page changed.

## 7. Release and final QA

- **UNVERIFIED · Checks, reviews, production revision and live check.** Recorded after the merge.
- **N/A · Bindings, migrations.** None.

## 8. Private owner center

- **N/A.** No change.
