# Vendored: Hallmark

This folder is a third-party copy, not this site's own writing. Do not edit it here.

- **What:** the Hallmark design skill (`skills/hallmark/`, version 1.1.0 in its `SKILL.md`).
- **Source:** https://github.com/nutlope/hallmark
- **Commit:** `13ac0ec7e148655948100b6396439e481361d690`, August 6, 2026. Upstream tree of `skills/hallmark` at that commit: `747c924c4767b4d5fa6f1c59985c87a21c918334`.
- **Vendored:** October 22, 2026.
- **License:** MIT, "Copyright (c) 2026 Hallmark contributors". The full text is in [LICENSE](LICENSE), copied from the repository root.
- **Credit:** Hallmark is made by Together AI and the Hallmark contributors.
- **Local additions:** this file and `LICENSE`. Every other file is byte for byte the upstream copy.

## How this repository uses it

- Claude Code reaches it through the `.claude/skills/hallmark/` pointer; Codex reads it here.
- The root [`design.md`](../../../design.md) is this site's locked design system. Hallmark reads it first and defers to it.
- [`docs/design-standard.md`](../../../docs/design-standard.md) says when to run it, how to triage what it finds and where the records go.
- Links in the skill to `../../site/` and `../../docs/` point at upstream folders that are not copied. The skill marks the `docs/` files as human-only; `site/css/tokens.css` only serves catalog theme picks, which `design.md` replaces here.
- Repository checks do not scan this folder. The em-dash and copy rules in `CLAUDE.md` cover the site's own text, not this upstream copy.

## Updating

1. Read the upstream changes since the pinned commit, including `LICENSE`. Stop and ask the owner if the license changes.
2. Clone the new commit and replace every upstream file here with `skills/hallmark/` from it. Keep this file and copy `LICENSE` from the new commit.
3. Confirm the copy: `diff -r <clone>/skills/hallmark .agents/skills/hallmark` lists only `LICENSE` and `VENDORED.md`.
4. Update the commit, its date, the tree hash (`git -C <clone> rev-parse <commit>:skills/hallmark`), the vendored date and the version above, and the pinned commit in `README.md` (Credits).
5. Re-read `design.md` against the new rules. Where a new default conflicts with a recorded owner decision, `design.md` keeps the decision; list the conflict for the owner instead of changing the site.
6. Run `npm run design:check` and its tests, then audit one changed page to confirm the skill still reads `design.md` first.
