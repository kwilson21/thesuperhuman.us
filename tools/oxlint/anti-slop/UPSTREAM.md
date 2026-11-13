# Where these rules came from

- Source: https://github.com/dmmulroy/anti-slop (MIT, see `LICENSE`)
- Commit: `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13)
- Copied from: `skills/install-anti-slop/assets/anti-slop/` (the same files as upstream `src/`, without its tests)
- Installed at: `tools/oxlint/anti-slop/`, registered in `oxlint.config.ts`
- Changes made here: none. `effect/` is copied but not registered (Tally's decision 191 in kwilson21/tally `docs/decisions.md`).
- `vendor/eslint-stylistic/UPSTREAM.md` is upstream's own maintenance note, copied as is and kept byte for byte identical to Tally's copy. Its commands and test files refer to the upstream anti-slop repository and do not exist here. Updates in this repository are made by re-copying from kwilson21/tally, as described under "Updating and verification" below.
- Upstream tests against Oxlint 1.78.0; Tally pins `oxlint` and `@oxlint/plugins` at 1.93.0 (Tally's decision 201 in kwilson21/tally `docs/decisions.md`).
