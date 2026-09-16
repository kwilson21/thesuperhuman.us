# Adding music

## What is shared

A **recording** owns the audio/video versions, lyrics, duration and credits. A
**release** owns its address, artwork, type and ordered recording IDs. A
**portfolio example** points to a recording and identifies the before/after
versions and the precise service demonstrated. Each has its own draft/public
visibility. No new page component is needed for each release.

Titles may repeat. IDs and public slugs must remain unique. A single can use
`/music/old-news` and an album `/music/old-news-album`; both can reference the same
recording. Keep IDs stable after launch so analytics and requests stay attached.

## Prepare a release

Use Node 24 or newer for the publishing helpers. Copy
`templates/music/release-package.json` beside a release's source folders and fill
in accurate metadata and relative asset paths. Remove unavailable versions and
examples. MP3 is the streaming audio format, MP4 the hosted video format. Retain
WAV masters privately. Supply the actual audio duration in seconds.

```sh
node scripts/prepare-music.mjs /path/to/release/package.json
node scripts/music-preview.mjs
MUSIC_PREVIEW_CONFIG=.private/wrangler-music-preview.json npm run dev
```

The importer validates all shared references and route collisions, creates
versioned media keys and an optimized cover, and stages copies under
`.private/music-assets`. It does not change source files or upload anything.
Existing IDs require an intentional `--replace`. Review the complete metadata
before replacing: replacement is not a partial merge.

For an album, use `type: "album"`, a distinct ID/slug and an ordered `tracks`
array. Include only new recordings in `recordings`; existing recording IDs are
resolved from the catalog. EPs use `type: "ep"`. A mixing example uses `unmixed`
to `mix`; a mastering example uses `mix` to `master`. Omit examples when the
required before recording is unavailable.

Optional release fields `displayTitle`, `producer`, `hero`, `heroQuote` and
`lyricQuote` support the editorial presentation. `hero` names an approved WebP
asset in `src/assets/site` without its extension. Default pages use the cover.
New generated art requires the existing asset QA process. Exact quotes must come
from approved lyrics. Release metadata lives in the three content collections.

A recording may specify a YouTube `youtubeId` instead of hosting an MP4. When both
exist, YouTube is preferred. The iframe loads only when requested. Old News is
currently tested with its actual hosted lyric-video file; no published YouTube ID
has been supplied. Audio and video transfer the current position when switching and pause each other. Hosted video uses custom controls with a native fallback; YouTube loads on request. Real hosted video and simulated delayed YouTube readiness were checked; live YouTube playback still needs a supplied video ID.

## Preview and publish

Check the release, Releases listing and Portfolio at desktop and phone widths.
Check the actual sound, artwork, credits, lyric video, and interest form. Source
visibility stays `draft` until publication is approved. Draft content works in
development but is excluded from production pages, media and demand endpoints.

Publication uses the existing site deployment and review process. Before publishing a release, confirm the required permissions for direct website streaming and portfolio use.

Production setup requires a dedicated D1 `MUSIC_DB` binding initialized with
`db/music.sql`, the existing `AUDIO` R2 bucket, `RATE_LIMIT` KV and real Turnstile
keys. Never deploy the local preview configuration or test keys. Its bindings
and data are entirely local. The production configuration has not been changed.

```sh
node scripts/upload-music.mjs .private/music-assets/old-news-single-upload.json
# After publication approval, add --remote to perform the upload.
```

Upload approved media before deploying public catalog entries. Keep the bucket
private and serve only catalog-listed objects. Media responses support seeking
and byte ranges. The interface offers streaming, with no download or purchase
button. Browser playback cannot prevent a determined listener from saving media;
this is not DRM.

## Understand demand

```sh
node scripts/music-report.mjs
# Add --remote for production data once the binding exists.
# Add --contacts only when a private contact export is needed.
```

Open `.private/music-demand-report.html`. It reports audio and video separately:
playback starts, 30 seconds of audible playback, song interest and merchandise
interest. Seeking forward does not count as listening. One event per type,
recording, medium and tab session is retained. Browser reports, best-effort rate
limits and unverified email addresses make these directional demand signals,
not audited unique listeners or guaranteed buyers. The event endpoint allows
60 requests per event/recording/release/medium/IP over its five-minute KV window
before throttling; unusually crowded shared networks may still be undercounted. No automatic sales threshold
has been invented.

Interest choices are song, merchandise or both. Merchandise choices are shirts,
hoodies, stickers and digital art, with an optional suggestion. Consent starts
unchecked. Repeated submissions update the same release/email record. No email,
newsletter subscription, order or payment is created. Honor withdrawal requests
through the displayed contact address, using the private database. Keep reports
and contact exports out of public assets and version control.

## Portfolio methodologies and comparison audio

Use `two-track-vocals`, `full-mix`, or `mastering` to identify the work demonstrated. Recording service credits are separate from the comparison methodology: a track may credit both vocal mixing and mastering while only supplying a genuine mastering before/after pair. Never fabricate a missing unmixed source. Mix-only recordings are supported.

Run `node scripts/music-waveforms.mjs <example-id>` against the private local exports after preparing the catalog. This derives waveform samples and integrated loudness measurements; review timing offsets against the actual files. The stacked A/B player loads and decodes both exports on the first Play request, then schedules them on one Web Audio clock with their source offsets. Switching versions or matching loudness changes gain only, so neither action restarts or seeks playback. Seeking and resuming schedule the pair together. This adds an initial preparation wait and decoded-audio memory use; the regular release player remains a streaming media element. Native controls remain the fallback when Web Audio is unavailable. Audio files are not rewritten.
