# Private playback retention review

Playback records become eligible for review after 90 days (the cutoff uses UTC
midnight, so every eligible record is at least 90 days old). There is no scheduled
delete. Contact requests are outside this cleanup and retain their existing
withdrawal process. Apply the versioned MUSIC_DB migrations with
`wrangler d1 migrations apply`; Wrangler rolls back a migration file when one of
its statements fails. `0003_audio_payments.sql` rebuilds the request audit table
to extend its action constraint, so `db/music.sql` is a fresh-database baseline,
not an additive production upgrade.

```sh
node scripts/music-retention.mjs
# For production, add --remote consistently to preview and apply.
```

Open `.private/music-retention-review.html` before removing anything. The matching
`.private/music-retention-review.json` is the exact apply manifest. It includes
daily counts by release, recording, audio/video, and start/30-second listen, plus
lifetime totals. Distill any important comparisons or observations into a private
note before cleanup. These are directional browser signals, not audited unique
listeners; a start-to-listen comparison is not proof of a completed listen.
The review contains no tab identifiers or contact exports. Keep it and any
operator insights private, outside version control and public assets.

Only after reviewing that exact report:

```sh
node scripts/music-retention.mjs --apply .private/music-retention-review.json
node scripts/music-report.mjs
```

Apply refuses a changed eligible source snapshot, a modified daily summary, or a
review from the other environment. Generate and review a fresh preview in those
cases. One explicit apply processes the reviewed snapshot in chunks of 100 records.
Each atomic statement preserves daily aggregates as it removes its records; an
archive insert failure rolls back that whole chunk. If a later chunk fails,
earlier chunks remain safely archived, and remaining records stay in place.
Generate and review a fresh preview before continuing; never automatically retry
a partial cleanup.
A second apply cannot count the same records again. Database daily totals retain
the date and all reporting dimensions without tab identifiers. The demand report
combines remaining raw records and these archived totals for lifetime and daily
counts. No automatic cleanup or backup is claimed. Production CLI operations
require working Cloudflare authentication; do not substitute local results for
production verification.
