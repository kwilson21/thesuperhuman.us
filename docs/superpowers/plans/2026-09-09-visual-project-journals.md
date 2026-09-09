# Visual project journals implementation plan

Goal: apply the owner's reviewed visual vocabulary to The Engineer's Daily and
Threadline, and demonstrate a connected work story using the existing Lyft account.

Reuse Astro, the existing paper/ink tokens, reviewed TED manifest, publication feed,
and professional case-study claims. No new framework, storage, publisher, dependencies,
private operational content, or invented company source code. Preserve the portfolio.

- [x] Add a shared progressively enhanced horizontal milestone component. Server-render
  all entries, select latest initially in JavaScript, support previous/next, direct
  selection, keyboard navigation and a vertical all-entries fallback. Keep stable IDs.
- [x] Add one reusable motion flow and one simple impact comparison. Use them for TED's
  intended lesson rhythm and the already documented Lyft batch-tool outcome.
- [x] Reshape TED's project page around the current prototype and the reviewed visual
  milestones. Preserve all curated assets and access to fuller context.
- [x] Add /building/threadline using the current publication feed and shared timeline.
  Never copy dynamic feed history into a static source. Keep publication status and
  prototype limits truthful; expose evidence basis as optional context.
- [x] Link both project pages from existing site entry points. Preserve existing feeds.
- [x] Verify UI behavior on desktop/mobile, reduced motion, empty/unavailable feeds,
  latest selection, histories and links. Run Astro check, Vitest and production build.
- [ ] Review public wording and diff, commit/push a focused PR, deploy through the
  existing main-branch Cloudflare integration and verify public rendering.

For the new project-history polling surface, do not replace a reader's selection when
new items arrive. Offer a reload control. Corrections, withdrawals or a removed project
must clear stale content immediately, then allow reload. Use no-store responses.

The Lyft account is the existing owner-authored /about and /work content: 5k to 100k+
rows and self-serve monitoring. These are reported outcomes, not newly rerun benchmarks.
Avoid turning the capacity comparison into a speed, revenue or time-saved claim.

Verification: 185 Vitest tests pass using Node 26.8.1 (default 22.12 lacks the required SQLite runtime). Astro check: zero errors/warnings; six existing hints. Production build passes. Visible Brave checks passed desktop/mobile, latest selection, keyboard controls, all-entry/no-JavaScript fallback, playback/reduced motion, new-update notification, and withdrawal removal. Independent review findings resolved: fetch timeout, publication/backfill metadata, and evidence access on short entries.
