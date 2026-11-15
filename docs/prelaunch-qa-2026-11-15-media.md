# Effect stack, media routes: the music file, the audio file and the link preview video (release gate)

Three branches are gated: the corpus branch (a golden corpus for each route, with no change to `src/`), branch A (behavior fixes, cut from the corpus branch) and branch B (the conversion of the three routes to rules, flows and services, cut from A). Branch B copies the pilot's shape (`docs/prelaunch-qa-2026-11-14-music-area.md`) and this record mirrors `docs/prelaunch-qa-2026-11-14-agreement-access.md`.

Date: November 15, 2026
Repository: the personal website repository
Routes: `GET` and `HEAD /music/file/[id]/[version]` (the public player and the lyric video stream a recording's audio or video from the audio bucket), `GET /audio/file/[slug]` (a portfolio track's mp3, with its own byte range handling), `GET` and `HEAD /og/[name].mp4` (the looping silent video behind a link preview, sliced into byte ranges from the static assets).
Branches: the corpus branch is `claude/effect-14-media-corpus`; A is `claude/effect-14-media-fixes`; B is `claude/effect-14-media`. Each is cut from the one before. Nothing is pushed.
AI assistance: the code on all three branches was written with AI assistance (Claude Code), tests first. The owner reviews the pull request.
Rollback revision: the corpus branch's parent on `origin/main` was `14cce493`; after the review the branches took `origin/main` at `2f7add57`.

## Design note

The plan asks for an area's design before its conversion code: XState diagrams for an entity with named states, and a Quint model for a read followed by a write. This area has neither, so there is no diagram and no model:

- No entity has states. A request names a file, and the answer is one of a fixed set (the bytes, a part of them, a refusal, an outage). Nothing is stored between requests.
- No route writes anything: no database, no KV, no R2 put, and no log line other than a failure's one line. There is therefore no read followed by a write to guard, and nothing for a compare-and-set to protect.
- The only two reads that depend on each other are the bucket's size read and its bytes read (the music file route and a range read of the audio file route). They are two reads, not a decision followed by a write. An object that disappears between them answers the same 404 as one that was never there, which is a recorded case in each corpus ("the object vanishes between head and get").

The decisions are therefore pure rules and the sequences are flows, as in the pilot, with the corpus as the check that nothing moved.

## Findings on the corpus branch (reported, then fixed on A)

The corpus records every answer each route can give (88 cases for the music file route, 85 for the audio file route and 83 for the link preview video route, 256 in all), including every outage and every Range header the routes read differently. Reading it showed these behaviors, each fixed on A below:

- A failing bucket read (head or get throwing), a failing assets fetch, and a catalog that cannot be read rejected out of the handler, so Astro answered its own bare 500 with nothing logged by the route.
- A missing audio bucket (music file and audio file routes) rejected the same way, and so did a production link preview route with no assets binding, which instead fetched the site's own address through the global fetch.
- The link preview route answered every assets answer that was not a success, a 403 or a 500 included, as 404 "Not found".
- The audio file route answered 416 for a range whose last byte lay past the end of the file (`bytes=0-1000` on a 64 byte file), where the music file route and the link preview route answered 206 with the end taken as the end of the file. RFC 9110, 14.1.2 says the last byte past the end means "to the end".

Seen on the corpus and not changed, with the reason:

- `mediaRange` (`src/lib/music-media.ts`) answers 416 for a Range header it cannot read as one range (another unit, two ranges, capitals), where RFC 9110 lets a server ignore such a header. It is shared with the studio file route, whose own corpus records those answers, so changing it is another area's decision.
- The audio file route reads a suffix range (`bytes=-8`), two ranges and another unit as "no range" and answers the whole file with 200. The standard allows that; it is not the same as the other two routes, which serve a suffix range.
- The `audio-tracks` collection holds no files in this repository (`src/content/audio-tracks` is empty), so on this site the audio file route answers 404 for every slug. The route is kept as it is: removing it is a product decision.
- The link preview route reads the whole video into memory to slice it (the static assets answer every request with the whole file). The files are about 1 MB or less.
- `X-Content-Type-Options` is set by the music file route itself and is absent from the audio file and link preview routes' own responses, which the corpus records, because `src/middleware.ts` adds the security headers to every response. It is not a defect.
- The private findings list for the work so far has no item about these routes.

## Scope

Corpus branch (no change to `src/`): `tests/golden/music-file.test.ts`, `audio-file.test.ts` and `og-video.test.ts`, with their fixtures and the shared builders in `tests/golden/areas/media.ts`. The three corpora cover:

- success: a whole read, every Range form (first, middle, open ended, suffix, one byte, last byte, an end past the size, a suffix longer than the file, leading zeros, numbers too large to be exact), HEAD with and without a Range header, conditional request headers (`If-None-Match`, `If-Modified-Since`, `If-Range`; none of the routes has an etag, so none answers 304), cookies and an owner session (ignored), the media type from the catalog and not from the bucket, and the headers (content type, content length, accept ranges, cache control, content disposition, content range);
- refusals: an unknown id, version, slug or name, capitals, prototype names, a path in a name, a version the recording lacks, a draft recording in production (served in development), a private object key, a name from an earlier render, the assets answering 404, and every unsatisfiable range with its `content-range: bytes */size`;
- failures: bucket head and get failing, a missing bucket, a catalog that does not validate, the assets fetch rejecting, the assets answering 403, 500 or 304, and production with no assets binding;
- effects: the routes make no database write, no KV write and no log line on success. Every case records the bucket calls (head, then get, with the range options) or the assets fetch in order. The link preview corpus marks a call made through the assets binding with a header, so a conversion that dropped the binding for the global fetch would show.

The link preview corpus pins the rendered names of two scenes so that a re-render never changes it. It assigns the names into the imported `src/data/og-media.json` after import, so the converted code has to read that file when asked and not at module load, and likewise `import.meta.env.DEV`, which the music and link preview cases set around the call.

Branch A, behavior fixes (each with a failing test in `tests/api/media-failures.test.ts` first, then a fixture-only re-record of 26 cases, and of 28 changed and 2 added cases once item 5 was added):

1. A failing bucket read or catalog read answers 500 "Media unavailable" and is logged once through `logUnexpected` (6 music file cases, 4 for the bucket and 2 for the catalog, and 3 audio file cases). It rejected.
2. A missing audio bucket answers 503 "Media unavailable" for a request that names a file the catalog has (2 music file cases, 2 audio file cases). An unknown recording, slug or private key still answers 404 first, so a missing binding discloses nothing. It rejected.
3. The link preview route: the assets fetch rejecting answers 500 and is logged once (4 cases); an assets answer that is neither a success nor a 404 answers 500 and is logged once (4 cases); 404 stays 404; production with no assets binding answers 503 (2 cases), after the name has been judged. In a development server the global fetch is passed in by the route, so it still works there.
4. The audio file route clamps a last byte past the end to the end and answers 206 with `content-range: bytes first-last/size` (3 cases). A start at or past the end is still 416.

5. Both routes serve only keys under `music/` and `tracks/` (the allow list of judgment call (d)). Two audio corpus cases that were served, a key with `Studio/` in capitals and one with a leading slash, are now 404, and two cases with an `agreements/` key are added.

Branch B, the conversion:

- Input: `src/server/media-input.ts` reads the version and the slug with Effect Schema. The routes have no body and none of their own files has a Zod schema, so there is no frozen copy and no differential test. Zod still runs in the area: every music file request validates the catalog through the Astro collection (`validateCatalog`, and A's fixture logs a `ZodError` for an invalid catalog). That leaves our code with the plan's step 13, with the content collections. the Range header is read by `mediaRange` (shared, kept in `src/lib/music-media.ts`) and by `readAudioRange` (the audio route's own, now in its rule file).
- Rules (`src/server/rules/`): `music-file.ts` (which catalog file: its key must start with exactly `music/`, case and all, nothing normalised; any other key is refused), `media-range.ts` (which bytes, shared by the music and link preview routes), `audio-file.ts` (which track, its key must start with exactly `tracks/`; the audio Range header, which bytes), `og-video.ts` (which rendered video, and how to judge the assets' answer). Each is built with `alwaysWrites`; every refusal is a `Data.TaggedError` with a `say` sentence.
- Store: `src/server/media-store.ts` reads the music catalog and the audio-tracks collection (no SQL). Services added to `src/server/services.ts`: `MediaObjects` (the bucket's head and get) and `OgAssets` (the static assets fetch), each with a live constructor that fails with a named error (`MediaBucketNotBound`, `MediaObjectFailed`, `AssetsNotBound`, `AssetsFailed`) and uses `Effect.tryPromise`. They do not use `AudioBucket` and `bindingsOrUnavailable`, because an unknown recording must answer 404 whether or not the bucket is bound.
- Flows (`src/server/flows/`): `music-file.ts`, `audio-file.ts`, `og-video.ts` and the shared `media-range.ts`. They read, decide and read again in the order the old code did and build no response text. The rules' range refusal carries no facts, so the flow adds the size the route's 416 names (`RangeOutsideFile`, `AudioRangeOutsideFile`).
- Routes: thin, on `runRoute(services, program, { route, answer })`, with every refusal and failure mapped by `catchTags`. A failure is logged once through `logUnexpected` with its cause (and for an assets status, with the line it logged on A). The fixed answers are in `src/lib/media-answers.ts`.
- Deleted: `streamMusic` (`src/lib/music-media.ts`) and `serveOgVideo` (`src/lib/og-media.ts`) with their tests, and the audio route's range helpers (`parseRangeRequest`, `resolveRange`), which became rules. `mediaRange` stays: the studio file route (`src/lib/audio-project-files.ts`) calls it.
- Tests: `tests/server/media-rules.test.ts` (every rule branch), `tests/flows/media-stories.test.ts` (each flow against a bucket and an assets double that record what they were asked) and `tests/api/media-failures.test.ts` (the route answers on A and B).

## Review

An independent review of the three branches found nothing that had to be fixed and confirmed that B answers as A does beyond the corpus. Each finding it made is fixed:

- The deny list of two folders became an allow list (`music/`, `tracks/`) on A; the record now says exactly what is checked.
- The `failed` helper copied in each route, and in the agreement and intake routes, is one `loggedAnswer` in `src/server/answers.ts`; the file `src/server/agreement-answers.ts` is gone.
- Tests added for the audio collection failing to read and for the video's bytes failing to read after a success answer.
- B reads the bucket inside the program, so a request with no runtime answers the logged 500 A gives.
- `AssetsNotOk.say` is kept because the rule type requires it, with a comment saying the flow turns it into the failure that names the status; the audio route passes a slug that is not well formed into its rule.
- The record's case counts, the `nosniff` line, the Zod lines, the missing-file line and the stop item for `HEAD` are corrected.

## Owner decisions

- Owner, 2026-11-12: Effect for rules, Effect Schema for input; convert one area at a time; no behavior change in a conversion.
- Owner, 2026-11-14: an unexpected database or store error answers 500 with the route's fixed sentence; a real lost race stays 409; a deliberate 503 for a missing binding or a known unavailable dependency stays.
- Owner, 2026-11-15 (recorded in the plan): Effect Schema as the only validator, no Zod from our code. The three routes' own files import none; the catalog read still runs Zod through the Astro collection until step 13.
- Judgment calls made in this work, for the owner to confirm: (a) the 500 and 503 answers reuse the sentence the music file route already used for a missing object, "Media unavailable", on all three routes, so no new copy was written; the audio file and link preview routes had no sentence for an outage of their own, and their 404 sentences ("not found", "Not found") do not say it. A person never reads these bodies, since they are the answer to an audio or video request. (b) The audio file route clamps a last byte past the end, by RFC 9110 and as the other two routes do, instead of answering 416. (c) A missing binding answers 503 only after the request has been judged, so an unknown recording is a 404 with or without the bucket. (d) Both routes serve a key only when it starts with exactly the public folder (`music/` or `tracks/`), checked case-sensitively with nothing normalised, and refuse anything else with the route's existing not-found answer. This is an allow list: the bucket also holds studio files, software visuals, signed agreements and attachments, and a deny list of two of those folders would have served the rest. The catalog schema already holds every music key under `music/`, so no music corpus case reaches the check and the rule tests do; the audio corpus has cases for `studio/`, `software/`, `agreements/`, `Studio/` and `/studio/` keys.

## Stop items for the owner (not fixed)

- `mediaRange` answers 416 for a Range header with another unit, two ranges or capitals, which RFC 9110 lets a server ignore. Changing it changes the studio file route's recorded answers.
- The audio file route does not serve suffix ranges (`bytes=-8`), and serves 200 with the whole file instead. The other two routes serve them.
- The `audio-tracks` collection is empty in this repository, so the audio file route answers 404 for every slug. Whether to remove the route is a product decision.
- A `HEAD` request on the audio file route reads the whole object: the route exports only `GET`, Astro serves a `HEAD` from it, and the function reads the bytes before the body is dropped.
- The audio file route sends `immutable` and one year of caching under a name that is the track's slug, not a name with a hash. A track replaced under the same slug would be served stale by caches. This is a caching decision.

## Statement classes (the SQL of the three routes)

None. The three routes use no database: no statement is class (a), (b), (c) or (d). Their reads are the bucket's head and get, the static assets' fetch and the content collections.

## Verification

Oxlint reports no findings on any of the three branches (`oxlint --deny-warnings`, zero). Results are recorded under Evidence.

## Evidence and limits

All runs are local on macOS arm64, Node 26, pnpm 12.20.0, in one worktree. Logs are not retained. After the review each branch took `origin/main` (at `2f7add57`, which moves shared helpers into modules of their own) with a merge commit, corpus first, then A, then B; no fixture needed re-recording for the merge. The figures are from the three tips below, each measured in the order of the shared brief.

Corpus branch tip `848d99b6`:

- `format:check`: "Checked 866 files ... No fixes applied". `build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with `GOLDEN_VERIFY_DIGESTS=1 GOLDEN_VERIFY_COUNTS=1`: 335 files passed; 13708 tests passed, 1 skipped (13709), tree clean afterwards.
- `golden:neutral --all origin/main HEAD`: "compared 80 fixtures and 9073 cases; 3 of 80 fixtures differ" (audio file 85, music file 88 and link preview video 83 added cases, none compared) and "golden:neutral: NEUTRAL".
- `verify:quint:all`: exit 0. `publicist:gate`: "publicist-gate passed: 84 entries checked." `lint`: no findings. `check`: "Result (892 files)", 0 errors, 16 hints.

Branch A tip `21bbc5a7`:

- `format:check`: "Checked 868 files ... No fixes applied". `build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with the digest and count checks: 336 files passed; 13733 tests passed, 1 skipped (13734), tree clean afterwards.
- `golden:neutral --all claude/effect-14-media-corpus HEAD`: "compared 80 fixtures and 9329 cases; 3 of 80 fixtures differ" and "NOT NEUTRAL", as intended: audio file 10 changed and 2 added, music file 8 changed, link preview video 10 changed. These are the 28 changed cases of the Scope above (the allow list changed two of the audio cases) and two added.
- `verify:quint:all`: exit 0. `publicist:gate`: passed, 84 entries. `lint`: no findings. `check`: "Result (894 files)", 0 errors, 16 hints.

Branch B tip: the record's own commit follows `5c00a002`, the head the figures below were measured on (a merge of A):

- `format:check`: "Checked 880 files ... No fixes applied". `build`: complete. Client bundle test: 27 passed.
- Full `pnpm test` with the digest and count checks: 338 files passed; 13796 tests passed, 1 skipped (13797), tree clean afterwards.
- `golden:neutral --all refs/heads/claude/effect-14-media-fixes HEAD`: "compared 80 fixtures and 9331 cases; 0 of 80 fixtures differ" and "golden:neutral: identical, 9331 cases". The conversion did not touch the fixtures, so the same test files pass against A's recordings.
- `verify:quint:all`: exit 0 (no model changed). `publicist:gate`: "publicist-gate passed: 84 entries checked." `lint`: no findings. `check`: "Result (906 files)", 0 errors, 16 hints.
- SQL statements in the area: none.

The unmeasured parts: none of the three routes was run against a real R2 bucket, the platform's static assets or the deployed worker. The corpus uses an in-memory bucket and a scripted fetch, so a difference in how the platform's `R2Object.body` streams, or in how `ASSETS.fetch` answers a URL, is UNVERIFIED. The media routes' streams are passed to `Response` as before.

## Checklist

- Answers: the three corpora are identical before and after the conversion (`golden:neutral` against branch A compares every case and finds none changed).
- Errors: every unexpected failure is 500 with a fixed sentence, logged once without the request; the only 503s are the missing audio bucket and the missing assets binding.
- Non-disclosure: an unknown recording, slug or name answers 404 whether or not the bucket is bound. A known file missing from storage answers 404 with the bucket bound and 503 without it. A music key outside `music/` cannot occur (the catalog schema rejects it); if it did, A would answer 503 with no bucket and B 404.
- Rules: every decision of the three routes is a rule with a test per branch; no route decides a status from a condition.
- Services: the bucket and the assets are services with named failures; no module is mocked in the area's tests.

## Follow-up

- The studio file route still calls `mediaRange`; its range answers move with the studio area.
- The audio file route's range reading and the shared `mediaRange` could be one reader once the studio area converts, so the two routes' unsupported-range answers agree. That is a change of answers and needs its own decision.
