# Personal Website Journal Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Personal Website journal checkpoints across managed worktrees and present reviewed visual proof beside curated public milestones.

**Architecture:** The journal script resolves a canonical private storage checkout while retaining the invoking worktree as the evidence source. The existing Personal Website `ProjectUpdates` feed remains the only public feed; a small optional visual-proof shape extends repository-owned milestones because the publication envelope does not carry media.

**Tech Stack:** Python 3.9+, Astro 5, TypeScript, Vitest, existing Playwright browser-check convention.

**Spec:** `docs/superpowers/specs/2026-09-21-website-journal-projection-design.md`

## Global Constraints

- Keep checkpoints append-only and never copy raw conversations into the journal or public feed.
- Use actual reviewed captures for visual proof; GIFs are optional and cannot be the only accessible evidence.
- Do not publish until `get_project_progress` for `personal-website` is authorized and returns a revision.
- Do not claim local or PR checks are a production readback.
- Add no dependencies.

---

### Task 1: Canonical private journal storage

**Files:**
- Modify: `scripts/development_journal.py`
- Create: `tests/scripts/test_development_journal.py`

**Interfaces:**
- Produces: `journal_root(invoking_root: Path) -> Path`, returning the primary checkout when the invocation is from a linked worktree and the invoking root otherwise.
- Consumes: the existing `--root` CLI argument and checkpoint artifact paths.

- [ ] **Step 1: Write failing resolution tests**

```python
def test_uses_primary_checkout_for_linked_worktree(tmp_path, monkeypatch):
    primary = tmp_path / 'primary'
    worktree = tmp_path / 'worktree'
    monkeypatch.setattr(journal, 'git_worktrees', lambda _: [(primary, 'refs/heads/main'), (worktree, 'HEAD')])
    assert journal.journal_root(worktree) == primary

def test_keeps_standalone_checkout_local(tmp_path, monkeypatch):
    monkeypatch.setattr(journal, 'git_worktrees', lambda _: [])
    assert journal.journal_root(tmp_path) == tmp_path
```

- [ ] **Step 2: Run the new tests and verify failure**

Run: `python3 -m unittest tests/scripts/test_development_journal.py`

Expected: FAIL because `journal_root` does not exist.

- [ ] **Step 3: Add minimal Git worktree resolution**

```python
def journal_root(invoking_root: Path) -> Path:
    worktrees = git_worktrees(invoking_root)
    for path, branch in worktrees:
        if branch == 'refs/heads/main':
            return path
    return invoking_root
```

Use `subprocess.run(['git', '-C', str(invoking_root), 'worktree', 'list', '--porcelain'], ...)` in `git_worktrees`; treat command failure or missing primary checkout as the local root. Continue to resolve artifact source files from `invoking_root` before storing them in the resolved journal directory.

- [ ] **Step 4: Run the journal tests and status command**

Run: `python3 -m unittest tests/scripts/test_development_journal.py && python3 scripts/development_journal.py status`

Expected: PASS; the status JSON identifies the canonical journal directory.

- [ ] **Step 5: Commit**

```bash
git add scripts/development_journal.py tests/scripts/test_development_journal.py
git commit -m "Centralize journal checkpoints across worktrees"
```

### Task 2: Visual-proof milestone contract and rendering

**Files:**
- Modify: `src/lib/project-story.ts`
- Modify: `src/components/ProjectTimeline.astro`
- Modify: `src/data/project-stories/personal-website.ts`
- Test: `tests/lib/project-story.test.ts`

**Interfaces:**
- Produces: optional `visualProof?: { before: ProjectArtifact; after: ProjectArtifact; label: string }` on `Milestone`.
- Consumes: the existing `ProjectArtifact` type and existing responsive project-journal styles.

- [ ] **Step 1: Write failing timeline data test**

```ts
it('keeps optional visual proof attached to its milestone', () => {
  const milestone = { id: 'mobile-fix', visualProof: { label: 'Mobile repair', before, after } } as Milestone;
  expect(normalizeMilestone(milestone).visualProof?.label).toBe('Mobile repair');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/lib/project-story.test.ts`

Expected: FAIL because `Milestone` does not support `visualProof`.

- [ ] **Step 3: Add the optional type and accessible comparison markup**

```astro
{entry.visualProof && <section class="timeline-visual-proof" aria-label={entry.visualProof.label}>
  <figure>...</figure>
  <figure>...</figure>
</section>}
```

Use the supplied artifact captions and alt text. Render still images by default; if a reviewed GIF is later added, present it as an enhancement with `prefers-reduced-motion` fallback to the stills.

- [ ] **Step 4: Run focused tests and a mobile browser capture**

Run: `npm test -- tests/lib/project-story.test.ts && PW_SKILL_DIR=... node tests/browser/personal-name.cjs`

Expected: PASS; no horizontal overflow at a 390px viewport.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-story.ts src/components/ProjectTimeline.astro src/data/project-stories/personal-website.ts tests/lib/project-story.test.ts
git commit -m "Add visual proof to website journal milestones"
```

### Task 3: Reconcile verified website outcomes and publication handoff

**Files:**
- Private: `.private/development/journal/*.json` (not committed)
- Private: `.private/publication/personal-website-pending.json` (not committed)

**Interfaces:**
- Consumes: verified merged PRs, review status, and stable Codex task IDs.
- Produces: append-only private checkpoints and a reviewed public backfill envelope for `personal-website`.

- [ ] **Step 1: Reconcile only verified outcomes**

Create separate checkpoints for the Old News lyrics repair, mobile A/B playback support, and mobile owner/player layout repairs. Record PR URL, merge commit, tests, and browser evidence; omit raw chat text and private dashboard screenshots.

- [ ] **Step 2: Read publication progress**

Call `get_project_progress({ projectId: 'personal-website' })`.

Expected: a feed revision, or `forbidden` with no publication attempted.

- [ ] **Step 3: Prepare the first public-safe backfill only after authorization**

```json
{
  "version": 1,
  "projectId": "personal-website",
  "eventId": "website-mobile-reliability-2026-09-21",
  "entryId": "website-mobile-reliability",
  "operation": "publish",
  "origin": "backfill",
  "occurredOn": "2026-09-21",
  "story": {
    "headline": "Small-screen listening became more reliable.",
    "summary": "The A/B player and its controls now behave more predictably on phones, with clearer playback markers and readable owner-side explanations.",
    "technicalDetail": null,
    "delivery": "tested",
    "basis": "repository-verified"
  }
}
```

Set `expectedRevision` to the value returned by the read. Persist the exact envelope before delivery and retain the returned receipt.

- [ ] **Step 4: Verify the public surface after receipt**

Run a browser readback of `/building/personal-website` and `/api/work-feed?project=personal-website`.

Expected: the headline appears once, with its original occurrence date and a truthful delivery label.

- [ ] **Step 5: Commit only tracked source changes**

```bash
git add docs/superpowers/specs/2026-09-21-website-journal-projection-design.md docs/superpowers/plans/2026-09-21-website-journal-projection.md
git commit -m "Document website journal projection"
```

### Task 4: Full verification and review

**Files:**
- Verify: changed source, tests, and public handoff receipt

- [ ] **Step 1: Run full checks**

Run: `npm test && npm run check && npm run build && python3 -m unittest tests/scripts/test_development_journal.py`

Expected: all pass; record existing hints separately from errors.

- [ ] **Step 2: Inspect diff and visual evidence**

Run: `git diff --check` and inspect desktop plus mobile captures for the Personal Website journal.

Expected: no whitespace errors and no clipping or reduced-motion-only visual dependency.

- [ ] **Step 3: Request the required review and merge only after approval**

Open a narrow PR. Wait for Greptile and all required checks. Merge only under the owner’s existing approval.
