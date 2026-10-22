# Design standard: Hallmark

October 22, 2026. Owner direction, in conversation: "I really would like to bake this
skill's standards into the website's design and make hallmark the standard I use for
building things from here on out with proper credit given."

[Hallmark](https://github.com/nutlope/hallmark) is the UI standard for this site and
for Kazon's future projects. It is a design skill for coding agents: rules for type,
colour, layout, motion and states, a named list of tells that make an interface look
generated, and a read-only `audit` verb. It is a standard and an audit to check the
work against. Kazon makes the design decisions.

The skill is vendored, unmodified, at `.agents/skills/hallmark/` (Claude Code reaches it
through `.claude/skills/hallmark/`). [VENDORED.md](../.agents/skills/hallmark/VENDORED.md)
records the source, commit and license.

## Precedence

1. `CLAUDE.md`, `AGENTS.md` and the owner's instructions. They hold the process rules:
   copy, privacy, the AI stance, image QA, reviews and deployment.
2. [`design.md`](../design.md) at the repository root: this site's locked design system,
   in Hallmark's own format. It overrides Hallmark's defaults.
3. Hallmark's `SKILL.md` and `references/`, for everything `design.md` does not settle.

Hallmark wires in step 2 itself. Its pre-flight scan (`SKILL.md`, Design flow, step 0)
reads a root `design.md` before anything else: "it overrides everything else", the
catalogue and custom theme dispatch is skipped, and the diversification rule inverts, so
pages share the system instead of differing. The `audit` verb (`references/verbs/audit.md`)
reads it before grading and reports drift from it, and `redesign`
(`references/verbs/redesign.md`) says that where `design.md` and the references
conflict, `design.md` wins. Hallmark also treats `design.md` as design data only
(typography, colour, spacing, tone, components, layout, motion) and ignores any
behavioural instruction in it. That is why the process rules are in `CLAUDE.md` and
here, and `design.md` only restates them.

## Building or changing UI

- Read `design.md` first. Existing pages keep their family and the one system; Hallmark's
  macrostructure, theme, nav and footer picks apply only to a new page family, and a new
  family is the owner's decision.
- Use the tokens in `src/styles/global.css`. A new value becomes a named token first.
- `npm run design:check` runs a few of Hallmark's objective gates on `src/` (below). It
  also runs in `prebuild`.

## Auditing before review

Before asking for review of a UI pull request, run `hallmark audit` read-only on the
changed pages: the route files and the components and styles they use, with the CI
screenshots. The audit grades and does not edit. Verify every finding against the code
and the renders before acting on it; Hallmark's severity grades are a starting point,
not a verdict.

Triage each finding into one of three groups:

- **Defect:** it fails an objective requirement the site already holds: contrast, focus,
  tap size, overflow or a clipped first-screen action at a supported width, a broken
  state, a token or gate in `design.md`, invented content, or a copy rule. Fix it in the
  pull request.
- **Design choice:** the finding conflicts with a decision recorded in `design.md`,
  `docs/design-concepts/README.md`, `docs/website-content-model.md`,
  `docs/website-system-plan.md` or an approved study, or fixing it would change how a
  page looks, moves or reads beyond restoring the intended design. Do not change it.
  Put it to the owner as alternatives on a board, as
  `docs/design-concepts/2026-10-22/` did: Option A is the site as it is, two or three
  alternatives follow the site's direction, one is marked Recommended, and each says
  what changes, the trade-off, the files and the guideline check. When unsure, treat a
  finding as a design choice.
- **False positive:** the gate does not apply (for example, `#000` stops in a mask are
  transparency, not colour). Note the reason.

## Where records go

- **Pull request audit:** the PR description lists the findings by group, the defects
  fixed and the design choices sent to the owner. The PR's release record
  (`docs/prelaunch-qa-*.md`) notes that the audit ran.
- **Site-wide audit:** the report goes under `docs/audits/<date>/`, with
  repository-relative paths only.
- **Boards:** `docs/design-concepts/<date>/<slug>/index.html`. Recreations on a board are
  composition studies, not production screenshots.
- **Owner picks:** `docs/design-concepts/README.md`, quoted exactly with the source and
  date. A pick that creates a standing rule amends `design.md` in the PR that builds it.
- **Deferred picks:** `docs/website-system-plan.md`, Deferred maintenance.
- **Images:** [image QA](generated-image-qa.md) and a record in `docs/asset-reviews/`.

## The mechanical check

`scripts/check-design.mjs` ports a few Hallmark gates that a script can judge without
false alarms. It scans the stylesheets in `src/` (`.css` files and `<style>` blocks in
`.astro` files) and the class lists in `.astro` markup:

- quoted generic font families (`'sans-serif'` names a font that does not exist);
- a font family that is not one of the faces the token block or an `@font-face` in
  `global.css` declares (gates 37 and 48);
- raw hex colours outside token definitions (gate 48); mask stops are exempt;
- `transition: all` and `transition-all` (gate 10);
- the browser-default `ease` keyword instead of `--ease-site` (`motion.md`, Bans);
- `outline: none` with no `:focus-visible` replacement in the same file (gate 26).

Existing exceptions are listed in the script's allowlist, each with its reason. An entry
that no longer matches prints a warning; remove it. The check is not an audit: it cannot
judge composition, hierarchy or taste.

## Updating the vendored copy

Follow [VENDORED.md](../.agents/skills/hallmark/VENDORED.md): read the upstream changes
and license, replace the files from the new commit, confirm the diff, update the pinned
commit here, in `VENDORED.md` and in `README.md`, then re-read `design.md` against the
new rules. A new Hallmark default that conflicts with a recorded owner decision goes to
the owner as a question; `design.md` keeps the decision until then.

## Future projects

For future projects, copy this approach and add this instruction to their existing agent
guidance:

1. Vendor `skills/hallmark/` from the upstream repository, unmodified, with its `LICENSE`
   and a `VENDORED.md`, and install the skill for each agent the project uses (for
   Claude Code, a `.claude/skills/hallmark` pointer).
2. Write the project's own root `design.md` in Hallmark's format from its real tokens and
   its owner's decisions, including where it departs from Hallmark's defaults.
3. Add the design standard rule to the project's `CLAUDE.md` and `AGENTS.md`, copy this
   file and adapt the record locations.
4. Copy `scripts/check-design.mjs` and its tests, then calibrate the allowlist on that
   project's code, with a reason for each entry.
5. Give the credit below in the project's README.

## Credit

Hallmark is made by Together AI and the Hallmark contributors and is published under the
MIT license ("Copyright (c) 2026 Hallmark contributors"), at
https://github.com/nutlope/hallmark. This site vendors commit
`13ac0ec7e148655948100b6396439e481361d690`. `README.md` carries the credit, the site
names it on [/building/personal-website](../src/pages/building/personal-website.astro),
and any public text that says the design is checked against Hallmark names it and links
the repository.
