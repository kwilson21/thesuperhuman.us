# Private journal backup and recovery

The owner authorized local storage in `.private/` and Cloudflare D1 on September
10, 2026. Both contain private recovery material. The D1 database is separate from
the public project feed and has no binding in the website Worker. The website can
be offline while checkpoints and recovery archives are created.

`scripts/journal_backup.py` uses Python's standard library. It locks the journal
using the logger's existing lock, archives checkpoints, index and nominated
artifact snapshots, and checks the archive before preparing an upload. It does
not scan the rest of the repository, upload credentials, publish, or schedule work.

## Create a snapshot

Run `python3 scripts/journal_backup.py pack` after meaningful checkpoint batches.
The command returns an ignored `.private/backups/<sha256>/` directory containing
`journal.zip` and `upload.json`. The backup directory is outside the journal, so a
backup never contains older backups. Unnominated files elsewhere in `.private/`
are excluded; nominate needed evidence in a checkpoint first.

The local archive alone cannot survive loss of this computer. The separate
database is named `personal-website-private-journal`; connection identifiers are
stored privately in `.private/cloudflare-journal-backup.json`. Authentication is
through the owner's Cloudflare connection. No credential is stored in this repo.

## Upload and verify

Use the authenticated Cloudflare D1 query API against that separate database.
Never substitute the public publication database or add a public Worker binding.
The existing schema is:

```sql
CREATE TABLE journal_backups (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL, file_count INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL, verified_at TEXT
);
CREATE TABLE journal_backup_chunks (
  backup_id TEXT NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (backup_id, ordinal)
);
```

1. Read `upload.json` privately. Insert its base64 chunks with their zero-based
   ordinals using parameterized queries. The archive SHA-256 is the stable backup
   ID; `INSERT OR IGNORE` makes an interrupted upload safe to retry.
2. Insert the manifest after all chunks succeed. Map `createdAt`, `fileCount` and
   the length of `chunks` to the corresponding snake-case columns. Leave
   `verified_at` null until readback passes.
3. Read the manifest and all chunks back from D1, ordered by ordinal. Check that
   ordinals are contiguous and count matches the manifest. Reconstruct the same
   JSON shape privately as `roundtrip.json`.
4. Run `python3 scripts/journal_backup.py verify --file <roundtrip.json>`. It
   validates byte length, SHA-256, ZIP integrity, file count and safe paths. Compare
   the remote hash with the original local manifest as well.
5. Only after success, set `verified_at` and save a local receipt with backup ID,
   verification time and counts. Do not print private chunks or checkpoint text.

The connector may truncate large tool responses. For integrity verification, read
all chunks inside its execution context, check contiguous ordinals, decode with
`atob`, and compute SHA-256 with `crypto.subtle.digest`. Return only the digest,
counts and manifest. Compare these with the locally verified archive, then test
that byte-identical archive in an isolated restore directory. This verifies cloud
storage without passing private archive contents through the conversation.
For a recovery download, return smaller substrings of each chunk and assemble
them privately; never treat a truncated response as a complete archive.

The September 10 snapshot used full remote readback hashing plus local ZIP and
isolated restore checks: two checkpoints, nine artifact snapshots and 13 archive
files. Its exact hash and verification time are in the private receipt and D1
manifest. This records a completed snapshot, not an automatic backup schedule.

Backups are snapshots, not continuous replication. Check the latest verified
manifest before reporting how current cloud recovery is. An interrupted upload
does not erase earlier snapshots. No retention deletion or background job is
configured; review storage as history grows.

## Restore without overwriting current work

Read the newest verified manifest and chunks through the authenticated D1 API,
then repeat the readback checks above. Decode the joined base64 chunks to a ZIP
in a new ignored recovery directory. Extract only the verified archive there,
inspect the dated checkpoint JSON and artifact hashes, and compare against the
current journal before replacing anything. Keep the current directory as a
separate recovery copy. The dated JSON files are authoritative; the index is a
projection. Do not restore into public assets or upload raw records to the site.

Archive receipts live outside the journal to avoid a recursive requirement to
back up the receipt of the backup that contains that receipt.
